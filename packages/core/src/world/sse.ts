/**
 * World SSE - Self-contained SSE connection management
 *
 * Effect-forward implementation that:
 * 1. Discovers servers via Discovery service (browser fetch proxy or Node.js lsof)
 * 2. Connects directly to server SSE endpoints
 * 3. Feeds events to WorldStore atoms
 *
 * Uses Discovery Layer from config (defaults to DiscoveryBrowserLive).
 * This enables testing with mock Discovery implementations.
 */

import {
	Effect,
	Stream,
	Schedule,
	Fiber,
	Ref,
	Queue,
	Scope,
	Metric,
	Duration,
	Context,
	Layer,
	Exit,
	Either,
} from "effect"
import { createParser, type EventSourceParser } from "eventsource-parser"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import { normalizeBackendStatus, type BackendSessionStatus } from "../types/sessions.js"
import {
	WorldStore,
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
import { routeEvent } from "./event-router.js"
import { Discovery, DiscoveryBrowserLive, type DiscoveredServer } from "../discovery/index.js"

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
	 * Discovery Layer (default: DiscoveryBrowserLive)
	 *
	 * Inject custom Discovery implementation for testing or Node.js environments.
	 * Browser: DiscoveryBrowserLive (fetch to /api/opencode/servers)
	 * Node.js: DiscoveryNodeLive (lsof process scanning)
	 * Testing: Use makeTestLayer from ../discovery
	 */
	discoveryLayer?: Layer.Layer<Discovery>
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
	private config: Required<WorldSSEConfig>
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
			discoveryLayer: config.discoveryLayer ?? DiscoveryBrowserLive,
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
			const instances = servers.map((server) => ({
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
			const instanceMap = new Map(instances.map((i) => [i.port, i]))
			this.registry.set(instancesAtom, instanceMap)

			// Connect to new servers
			const activePorts = new Set(servers.map((s) => s.port))

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
			// Provide Discovery layer from config
			Effect.provide(this.config.discoveryLayer),
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

			// Normalize status
			const statusMap = new Map<string, SessionStatus>()
			for (const [sessionId, backendStatus] of Object.entries(backendStatusMap)) {
				statusMap.set(sessionId, normalizeBackendStatus(backendStatus))
			}

			// Update Registry with sessions (convert array to Map keyed by id)
			const sessionMap = new Map(sessions.map((s) => [s.id, s]))
			this.registry.set(sessionsAtom, sessionMap)
			this.registry.set(statusAtom, statusMap)
			// Connection status is managed by startDiscoveryLoop() or when connectedPorts updates

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

/**
 * Create a WorldSSE instance connected to a Registry
 */
export function createWorldSSE(registry: Registry.Registry, config?: WorldSSEConfig): WorldSSE {
	return new WorldSSE(registry, config)
}

// ============================================================================
// SSEService - Effect.Service wrapper
// ============================================================================

/**
 * SSEService interface - Effect.Service wrapper around WorldSSE
 *
 * Provides scoped lifecycle management with Effect.Service pattern.
 * The WorldSSE instance is created on acquire and cleaned up on release.
 */
export interface SSEServiceInterface {
	/**
	 * Start SSE connections
	 */
	start: () => Effect.Effect<void, never, never>

	/**
	 * Stop SSE connections
	 */
	stop: () => Effect.Effect<void, never, never>

	/**
	 * Get connected ports
	 */
	getConnectedPorts: () => Effect.Effect<number[], never, never>
}

/**
 * SSEService tag for dependency injection
 */
export class SSEService extends Context.Tag("SSEService")<SSEService, SSEServiceInterface>() {}

/**
 * SSEService Layer with scoped lifecycle
 *
 * Pattern from cursor-store.ts: Layer.scoped wraps WorldSSE class,
 * providing Effect-native lifecycle management.
 *
 * Composes with Discovery layer from config (defaults to DiscoveryBrowserLive).
 * This enables testing with mock Discovery implementations.
 *
 * @param registry - Registry to feed events into
 * @param config - SSE configuration (optional discoveryLayer for testing)
 *
 * @example
 * ```typescript
 * // Default discovery (DiscoveryBrowserLive)
 * const program = Effect.gen(function* () {
 *   const sseService = yield* SSEService
 *   yield* sseService.start()
 *   // SSE active within scope
 *   yield* Effect.sleep(Duration.seconds(10))
 *   // Auto-cleanup when scope exits
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(SSEServiceLive(registry)))
 * )
 *
 * // Custom discovery for testing
 * const MockDiscoveryLive = Layer.succeed(Discovery, {
 *   discover: () => Effect.succeed([{ port: 3000, pid: 123, directory: "/test" }])
 * })
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(SSEServiceLive(registry, { discoveryLayer: MockDiscoveryLive }))
 *   )
 * )
 * ```
 */
export const SSEServiceLive = (
	registry: Registry.Registry,
	config?: WorldSSEConfig,
): Layer.Layer<SSEService, never, never> =>
	Layer.scoped(
		SSEService,
		Effect.acquireRelease(
			// Acquire: Create WorldSSE instance
			Effect.sync(() => {
				const sse = new WorldSSE(registry, config)

				return {
					start: () => Effect.sync(() => sse.start()),
					stop: () => Effect.sync(() => sse.stop()),
					getConnectedPorts: () => Effect.sync(() => sse.getConnectedPorts()),
				}
			}),
			// Release: Stop WorldSSE on scope exit
			(service) => service.stop(),
		),
	)
