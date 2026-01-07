/**
 * World SSE - Self-contained SSE connection management
 *
 * Effect-forward implementation that:
 * 1. Discovers servers via Discovery service (browser fetch proxy or Node.js lsof)
 * 2. Connects directly to server SSE endpoints
 * 3. Feeds events to effect-atom state atoms
 *
 * Uses Discovery Layer from config (defaults to empty implementation).
 * This enables testing with mock Discovery implementations.
 */

import { Effect, Stream, Schedule, Fiber, Scope, Layer, Exit, Either } from "effect"
import { createParser, type EventSourceParser } from "eventsource-parser"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import { normalizeBackendStatus, type BackendSessionStatus } from "../types/sessions.js"
import {
	Registry,
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	connectionStatusAtom,
	instancesAtom,
	projectsAtom,
	sessionToInstancePortAtom,
} from "./atoms.js"
import type { SSEEventInfo, Instance } from "./types.js"
import { WorldMetrics } from "./metrics.js"
import type { Project } from "../types/sdk.js"
import { parseSSEEvent } from "../sse/parse.js"
import type { SSEEvent as ParsedSSEEvent } from "../sse/schemas.js"
import {
	routeEvent,
	createSessionEvents,
	createStatusEvents,
	createMessageEvents,
	createPartEvents,
} from "./event-router.js"
import { Discovery, type DiscoveredServer } from "./discovery/index.js"

// Default empty Discovery layer for when no discoveryLayer is provided in config
const DiscoveryEmptyLive: Layer.Layer<Discovery> = Layer.succeed(Discovery, {
	_tag: "Discovery" as const,
	discover: () => Effect.succeed([]),
})

// ============================================================================
// Types
// ============================================================================

export interface SSEEvent {
	type: string
	properties: Record<string, unknown>
}

export interface WorldSSEConfig {
	/** Specific server URL to connect to (skips discovery) */
	serverUrl?: string
	/** Discovery interval in ms (default: 5000) */
	discoveryIntervalMs?: number
	/** Reconnect on disconnect (default: true) */
	autoReconnect?: boolean
	/** Max reconnect attempts (default: 10) */
	maxReconnectAttempts?: number
	/** Callback for raw SSE events (for logging/debugging) */
	onEvent?: (event: SSEEventInfo) => void
	/**
	 * Discovery Layer (default: empty implementation that returns [])
	 *
	 * Inject custom Discovery implementation for testing or Node.js environments.
	 * Node.js: DiscoveryNodeLive from @opencode-vibe/core/world/discovery/node (lsof process scanning)
	 * Testing: Use Layer.succeed(Discovery, { discover: () => Effect.succeed([...]) })
	 */
	discoveryLayer?: Layer.Layer<Discovery>
	/**
	 * Initial instances from SSR discovery
	 * Bypasses discovery loop and connects to these ports immediately
	 */
	initialInstances?: Instance[]
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Check if running in browser context
 */
function isBrowser(): boolean {
	return typeof window !== "undefined"
}

/**
 * Get SSE URL for a port
 * In browser: use proxy route /api/sse/{port}
 * In CLI/server: use direct connection http://127.0.0.1:{port}/global/event
 */
function getSSEUrl(port: number): string {
	if (isBrowser()) {
		return `/api/sse/${port}`
	}
	return `http://127.0.0.1:${port}/global/event`
}

/**
 * Get API base URL for a port
 * In browser: use proxy route /api/opencode/{port}
 * In CLI/server: use direct connection http://127.0.0.1:{port}
 */
function getApiBaseUrl(port: number): string {
	if (isBrowser()) {
		return `/api/opencode/${port}`
	}
	return `http://127.0.0.1:${port}`
}

// ============================================================================
// SSE Connection - Direct fetch-based streaming
// ============================================================================

/**
 * Connect to a server's SSE endpoint and stream events
 *
 * Uses fetch with ReadableStream (works in Node.js and browsers)
 * Parses SSE format with eventsource-parser
 *
 * In browser: uses /api/sse/{port} proxy route
 * In CLI/server: uses direct http://127.0.0.1:{port}/global/event
 */
export function connectToSSE(port: number): Stream.Stream<SSEEvent, Error> {
	return Stream.async<SSEEvent, Error>((emit) => {
		const url = getSSEUrl(port)
		let controller: AbortController | null = new AbortController()
		let parser: EventSourceParser | null = null

		// Create SSE parser
		parser = createParser({
			onEvent: (event) => {
				try {
					const data = JSON.parse(event.data)
					// Extract the actual event from the wrapper
					if (data.payload?.type && data.payload?.properties) {
						emit.single({
							type: data.payload.type,
							properties: data.payload.properties,
						})
					}
				} catch (error) {
					// Skip malformed events
				}
			},
		})

		// Start streaming
		;(async () => {
			try {
				const response = await fetch(url, {
					headers: {
						Accept: "text/event-stream",
						"Cache-Control": "no-cache",
					},
					signal: controller?.signal,
				})

				if (!response.ok) {
					emit.fail(new Error(`SSE connection failed: ${response.status}`))
					return
				}

				if (!response.body) {
					emit.fail(new Error("SSE response has no body"))
					return
				}

				const reader = response.body.getReader()
				const decoder = new TextDecoder()

				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					const chunk = decoder.decode(value, { stream: true })
					parser?.feed(chunk)
				}

				emit.end()
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					emit.end()
					return
				}
				emit.fail(error instanceof Error ? error : new Error(String(error)))
			}
		})()

		// Cleanup
		return Effect.sync(() => {
			controller?.abort()
			controller = null
			parser = null
		})
	})
}

// ============================================================================
// WorldSSE - Main orchestrator
// ============================================================================

/**
 * WorldSSE manages server discovery and SSE connections
 *
 * Feeds events directly to a Registry via atoms.
 * Self-contained - no dependencies on browser APIs or proxy routes.
 */
export class WorldSSE {
	private registry: Registry.Registry
	private config: Omit<Required<WorldSSEConfig>, "discoveryLayer" | "initialInstances"> & {
		discoveryLayer?: Layer.Layer<Discovery>
		initialInstances?: Instance[]
	}
	private running = false
	private discoveryFiber: Fiber.RuntimeFiber<void, Error> | null = null
	private connectionFibers = new Map<number, Fiber.RuntimeFiber<void, Error>>()
	private connectedPorts = new Set<number>()
	private scope: Scope.CloseableScope | null = null // Scope for auto-cleanup

	constructor(registry: Registry.Registry, config: WorldSSEConfig = {}) {
		this.registry = registry
		this.config = {
			serverUrl: config.serverUrl ?? "",
			discoveryIntervalMs: config.discoveryIntervalMs ?? 5000,
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
			onEvent: config.onEvent ?? (() => {}),
			discoveryLayer: config.discoveryLayer,
			initialInstances: config.initialInstances,
		}
	}

	/**
	 * Start discovery and SSE connections
	 * Creates a Scope for auto-cleanup of fibers
	 */
	start(): void {
		if (this.running) return
		this.running = true

		// Set discovering status for auto-discovery mode
		// Direct serverUrl connections skip discovery and use "connecting"
		if (this.config.serverUrl) {
			this.registry.set(connectionStatusAtom, "connecting")
		} else {
			this.registry.set(connectionStatusAtom, "discovering")
		}

		// Create scope for fiber lifecycle
		Effect.runPromise(Scope.make()).then((scope) => {
			this.scope = scope
		})

		// If serverUrl is provided, connect directly (skip discovery)
		if (this.config.serverUrl) {
			const url = new URL(this.config.serverUrl)
			const port = parseInt(url.port || "1999", 10)
			this.connectToServer(port)
			return
		}

		// If initialInstances provided (from SSR), connect immediately and skip discovery
		if (this.config.initialInstances && this.config.initialInstances.length > 0) {
			this.registry.set(connectionStatusAtom, "connecting")
			for (const instance of this.config.initialInstances) {
				this.connectToServer(instance.port)
			}
			return
		}

		// Start discovery loop
		this.startDiscoveryLoop()
	}

	/**
	 * Stop all connections
	 * Closes the Scope, auto-interrupting all fibers
	 */
	stop(): void {
		this.running = false

		// Close scope - this auto-interrupts all fibers created within it
		if (this.scope) {
			Effect.runPromise(Scope.close(this.scope, Exit.succeed(undefined as void))).catch(() => {
				// Ignore close errors
			})
			this.scope = null
		}

		// Cancel discovery (if not using scope-based management yet)
		if (this.discoveryFiber) {
			Effect.runFork(Fiber.interrupt(this.discoveryFiber))
			this.discoveryFiber = null
		}

		// Cancel all connections (manual cleanup still needed for fibers not in scope)
		for (const [port, fiber] of this.connectionFibers) {
			Effect.runFork(Fiber.interrupt(fiber))
		}
		this.connectionFibers.clear()
		this.connectedPorts.clear()

		this.registry.set(connectionStatusAtom, "disconnected")
	}

	/**
	 * Get list of connected ports
	 */
	getConnectedPorts(): number[] {
		return Array.from(this.connectedPorts)
	}

	/**
	 * Start the discovery loop using Discovery service
	 */
	private startDiscoveryLoop(): void {
		const discoverAndUpdate = Effect.gen(this, function* () {
			// Use Discovery service to discover servers
			const discovery = yield* Discovery
			const servers = yield* discovery.discover()

			// Convert DiscoveredServer[] to Instance[] and feed to Registry
			const instances = servers.map((server: DiscoveredServer) => ({
				port: server.port,
				pid: server.pid,
				directory: server.directory,
				status: this.connectedPorts.has(server.port)
					? ("connected" as const)
					: ("connecting" as const),
				baseUrl: isBrowser() ? `/api/opencode/${server.port}` : `http://127.0.0.1:${server.port}`,
				lastSeen: Date.now(),
			}))

			// Feed instances to Registry - convert array to Map keyed by port
			const instanceMap = new Map(instances.map((i: Instance) => [i.port, i]))
			this.registry.set(instancesAtom, instanceMap)

			// Connect to new servers
			const activePorts = new Set(servers.map((s: DiscoveredServer) => s.port))

			for (const server of servers) {
				if (!this.connectedPorts.has(server.port)) {
					this.connectToServer(server.port)
				}
			}

			// Disconnect from dead servers
			for (const port of this.connectedPorts) {
				if (!activePorts.has(port)) {
					this.disconnectFromServer(port)
				}
			}

			// Update connection status based on discovery results
			// Transition from "discovering" → "connected"/"disconnected"/"connecting"
			const currentStatus = this.registry.get(connectionStatusAtom)

			if (this.connectedPorts.size > 0) {
				// Successfully connected to at least one server
				this.registry.set(connectionStatusAtom, "connected")
			} else if (servers.length === 0) {
				// Discovery found no servers
				this.registry.set(connectionStatusAtom, "disconnected")
			} else if (currentStatus === "discovering") {
				// Discovery found servers but not connected yet
				this.registry.set(connectionStatusAtom, "connecting")
			}
		})

		const discoveryEffect = discoverAndUpdate.pipe(
			Effect.repeat(Schedule.fixed(this.config.discoveryIntervalMs)),
			Effect.asVoid,
			Effect.interruptible,
			// Provide Discovery layer from config (or use default empty implementation)
			Effect.provide(this.config.discoveryLayer ?? DiscoveryEmptyLive),
		)

		this.discoveryFiber = Effect.runFork(discoveryEffect)
	}

	/**
	 * Connect to a specific server
	 */
	private connectToServer(port: number): void {
		if (this.connectionFibers.has(port)) return

		const connectionEffect = Effect.gen(this, function* () {
			// Yield immediately to ensure async execution
			yield* Effect.yieldNow()

			let attempts = 0

			while (this.running && attempts < this.config.maxReconnectAttempts) {
				try {
					this.connectedPorts.add(port)

					// Bootstrap: fetch initial data
					yield* this.bootstrapFromServer(port)

					// Mark as connected after successful bootstrap
					// (Only for direct serverUrl connections - discovery loop handles multi-server status)
					if (this.config.serverUrl && this.connectedPorts.size > 0) {
						this.registry.set(connectionStatusAtom, "connected")
					}

					// Stream SSE events
					yield* Stream.runForEach(connectToSSE(port), (event) =>
						Effect.sync(() => this.handleEvent(event, port)),
					)

					// Stream ended normally
					break
				} catch (error) {
					this.connectedPorts.delete(port)
					attempts++

					if (!this.config.autoReconnect || attempts >= this.config.maxReconnectAttempts) {
						break
					}

					// Exponential backoff
					const delay = Math.min(1000 * Math.pow(2, attempts), 30000)
					yield* Effect.sleep(delay)
				}
			}

			this.connectedPorts.delete(port)
			this.connectionFibers.delete(port)
		})

		const fiber = Effect.runFork(connectionEffect)
		this.connectionFibers.set(port, fiber)
	}

	/**
	 * Disconnect from a server
	 */
	private disconnectFromServer(port: number): void {
		const fiber = this.connectionFibers.get(port)
		if (fiber) {
			Effect.runFork(Fiber.interrupt(fiber))
			this.connectionFibers.delete(port)
		}
		this.connectedPorts.delete(port)

		// Clean up stale session→port mappings for this server
		const mapping = this.registry.get(sessionToInstancePortAtom)
		const updatedMapping = new Map(mapping)
		for (const [sessionId, mappedPort] of mapping.entries()) {
			if (mappedPort === port) {
				updatedMapping.delete(sessionId)
			}
		}
		this.registry.set(sessionToInstancePortAtom, updatedMapping)
	}

	/**
	 * Bootstrap initial data from a server
	 *
	 * In browser: uses /api/opencode/{port} proxy route
	 * In CLI/server: uses direct http://127.0.0.1:{port}
	 */
	private bootstrapFromServer(port: number): Effect.Effect<void, Error> {
		return Effect.gen(this, function* () {
			const baseUrl = getApiBaseUrl(port)

			// Fetch sessions, status, and project in parallel
			const [sessionsRes, statusRes, projectRes] = yield* Effect.all([
				Effect.tryPromise({
					try: () => fetch(`${baseUrl}/session`).then((r) => r.json()),
					catch: (e) => new Error(`Failed to fetch sessions: ${e}`),
				}),
				Effect.tryPromise({
					try: () => fetch(`${baseUrl}/session/status`).then((r) => r.json()),
					catch: (e) => new Error(`Failed to fetch status: ${e}`),
				}),
				Effect.tryPromise({
					try: () => fetch(`${baseUrl}/project/current`).then((r) => r.json()),
					catch: (e) => new Error(`Failed to fetch project: ${e}`),
				}),
			])

			const sessions = (sessionsRes as Session[]) || []
			const backendStatusMap = (statusRes as Record<string, BackendSessionStatus>) || {}
			const project = projectRes as Project | null

			// Collect all data for synthetic event generation
			const allMessages: Message[] = []
			const allParts: Part[] = []

			// Fetch messages and parts for each session
			for (const session of sessions) {
				const messages = yield* Effect.tryPromise(() =>
					fetch(`${baseUrl}/session/${session.id}/message`).then(
						(r) => r.json() as Promise<Message[]>,
					),
				).pipe(Effect.catchAll(() => Effect.succeed([] as Message[])))

				allMessages.push(...messages)

				for (const message of messages) {
					// Skip messages without valid IDs
					if (!message.id) {
						continue
					}

					const parts = yield* Effect.tryPromise(() =>
						fetch(`${baseUrl}/session/${session.id}/message/${message.id}/part`).then(
							(r) => r.json() as Promise<Part[]>,
						),
					).pipe(Effect.catchAll(() => Effect.succeed([] as Part[])))

					allParts.push(...parts)
				}
			}

			// Generate synthetic events from bootstrap data
			const sessionEvents = createSessionEvents(sessions)
			const messageEvents = createMessageEvents(allMessages)
			const partEvents = createPartEvents(allParts)
			const statusEvents = createStatusEvents(backendStatusMap)

			// CRITICAL ORDER: Apply status events LAST
			// Message/part events set status to "running", so status events must come last
			// to reflect the true state from the backend
			const allEvents = [...sessionEvents, ...messageEvents, ...partEvents, ...statusEvents]

			// Route all synthetic events through the event router
			for (const event of allEvents) {
				routeEvent(event, this.registry, port)
			}

			// Update projects - merge with existing projects from other instances
			if (project) {
				const existingProjects = this.registry.get(projectsAtom)

				// Check if project already exists (by worktree)
				const updatedProjects = new Map(existingProjects)
				updatedProjects.set(project.worktree, project)

				this.registry.set(projectsAtom, updatedProjects)
			}
		})
	}

	/**
	 * Handle incoming SSE event
	 *
	 * Parses event through Effect Schema, then delegates to event-router.
	 * Event router handles all atom updates and session-to-instance mapping.
	 */
	private handleEvent(event: SSEEvent, sourcePort: number): void {
		// Parse event through Effect Schema
		const parseResult = parseSSEEvent(event)

		// Skip invalid events (malformed data from SSE stream)
		if (Either.isLeft(parseResult)) {
			// Silently skip unknown events for now (e.g., lsp.client.diagnostics)
			// TODO: Add schemas for these events and route them properly
			// The World Stream should eventually handle ALL SSE events
			return
		}

		const parsed = parseResult.right

		// Call the event callback for logging/debugging
		this.config.onEvent({
			source: "sse",
			type: parsed.type,
			properties: parsed.properties,
		})

		// Delegate to event router for atom updates
		routeEvent(parsed, this.registry, sourcePort)
	}
}
