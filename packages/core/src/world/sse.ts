/**
 * World SSE - Self-contained SSE connection management
 *
 * Effect-forward implementation that:
 * 1. Discovers servers via lsof (no proxy routes)
 * 2. Connects directly to server SSE endpoints
 * 3. Feeds events to WorldStore atoms
 *
 * This replaces MultiServerSSE with a clean, self-contained implementation.
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

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredServer {
	port: number
	pid: number
	directory: string
}

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

/**
 * Discover servers via browser proxy API
 * Fetches /api/opencode-servers which returns discovered servers
 */
function discoverServersFromProxy(): Effect.Effect<DiscoveredServer[], Error> {
	return Effect.tryPromise({
		try: async () => {
			const response = await fetch("/api/opencode-servers")
			if (!response.ok) {
				return []
			}
			const servers = (await response.json()) as Array<{
				port: number
				pid?: number
				directory: string
			}>
			return servers.map((s) => ({
				port: s.port,
				pid: s.pid ?? 0,
				directory: s.directory,
			}))
		},
		catch: () => new Error("Failed to discover servers from proxy"),
	}).pipe(Effect.catchAll(() => Effect.succeed([] as DiscoveredServer[])))
}

// ============================================================================
// Discovery - lsof in CLI, proxy API in browser
// ============================================================================

/**
 * Discover running OpenCode servers
 *
 * In browser: fetches /api/opencode-servers (Next.js proxy)
 * In CLI/server: uses lsof to find bun/opencode processes
 */
export function discoverServers(): Effect.Effect<DiscoveredServer[], Error> {
	return Effect.gen(function* () {
		// Browser: use proxy API for discovery
		if (isBrowser()) {
			return yield* discoverServersFromProxy()
		}

		// Dynamic import for Node.js child_process
		const { exec } = yield* Effect.promise(() => import("child_process"))
		const { promisify } = yield* Effect.promise(() => import("util"))
		const execAsync = promisify(exec)

		// Find listening TCP ports for bun/opencode processes
		const result = yield* Effect.tryPromise({
			try: async () => {
				try {
					const { stdout } = await execAsync(
						`lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E 'bun|opencode' | awk '{print $2, $9}'`,
						{ timeout: 2000 },
					)
					return stdout
				} catch (error: any) {
					// lsof returns exit code 1 when grep finds no matches - that's OK
					if (error.stdout !== undefined) {
						return error.stdout || ""
					}
					throw error
				}
			},
			catch: (error) => new Error(`Discovery failed: ${error}`),
		})

		// Parse candidates
		const candidates: Array<{ port: number; pid: number }> = []
		const seen = new Set<number>()

		for (const line of result.trim().split("\n")) {
			if (!line) continue
			const [pid, address] = line.split(" ")
			const portMatch = address?.match(/:(\d+)$/)
			if (!portMatch) continue

			const port = parseInt(portMatch[1]!, 10)
			if (seen.has(port)) continue
			seen.add(port)

			candidates.push({ port, pid: parseInt(pid!, 10) })
		}

		// Verify each candidate is an OpenCode server
		const servers: DiscoveredServer[] = []

		for (const candidate of candidates) {
			const server = yield* verifyServer(candidate.port, candidate.pid)
			if (server) {
				servers.push(server)
			}
		}

		return servers
	})
}

/**
 * Verify a port is an OpenCode server by checking /project/current
 */
function verifyServer(port: number, pid: number): Effect.Effect<DiscoveredServer | null, never> {
	return Effect.gen(function* () {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 500)

		try {
			const response = yield* Effect.tryPromise({
				try: () =>
					fetch(`http://127.0.0.1:${port}/project/current`, {
						signal: controller.signal,
					}),
				catch: () => null,
			})

			clearTimeout(timeoutId)

			if (!response || !response.ok) return null

			const project = yield* Effect.tryPromise({
				try: () => response.json() as Promise<{ worktree?: string }>,
				catch: () => null,
			})

			if (!project) return null

			const directory = project.worktree
			if (!directory || directory === "/" || directory.length <= 1) {
				return null
			}

			return { port, pid, directory }
		} catch {
			clearTimeout(timeoutId)
			return null
		}
	}).pipe(Effect.catchAll(() => Effect.succeed(null)))
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
	 * Start the discovery loop
	 */
	private startDiscoveryLoop(): void {
		const discoverAndUpdate = Effect.gen(this, function* () {
			// Discover servers
			const servers = yield* discoverServers().pipe(
				Effect.catchAll(() => Effect.succeed([] as DiscoveredServer[])),
			)

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
	 * CRITICAL: Maps sessionID to Instance for routing.
	 * When session events arrive, we extract the session directory and
	 * map it to the Instance that sent the event (this connection's port).
	 */
	private handleEvent(event: SSEEvent, sourcePort: number): void {
		const { type, properties } = event

		// Call the event callback for logging/debugging
		// Add source tag for multi-source scenarios
		this.config.onEvent({
			source: "sse",
			type,
			properties,
		})

		switch (type) {
			case "session.created":
			case "session.updated": {
				const session = properties as unknown as Session
				if (session?.id) {
					// Upsert session in sessionsAtom (Map)
					const sessions = this.registry.get(sessionsAtom)
					const updated = new Map(sessions)
					updated.set(session.id, session)
					this.registry.set(sessionsAtom, updated)

					// Map session to instance for routing
					// Find instance by port from instancesAtom
					const instances = this.registry.get(instancesAtom)
					const instance = instances.get(sourcePort)
					if (instance) {
						const mapping = this.registry.get(sessionToInstancePortAtom)
						const updatedMapping = new Map(mapping)
						updatedMapping.set(session.id, instance.port)
						this.registry.set(sessionToInstancePortAtom, updatedMapping)
					}
				}
				break
			}

			case "message.created":
			case "message.updated": {
				const message = properties as unknown as Message
				if (message?.id) {
					// Upsert message in messagesAtom (Map)
					const messages = this.registry.get(messagesAtom)
					const updated = new Map(messages)
					updated.set(message.id, message)
					this.registry.set(messagesAtom, updated)

					// CRITICAL: Receiving message events = session is active
					// Mark as "running" since we're getting live data
					const sessionId = message.sessionID
					if (sessionId) {
						const statuses = this.registry.get(statusAtom)
						const updatedStatuses = new Map(statuses)
						updatedStatuses.set(sessionId, "running")
						this.registry.set(statusAtom, updatedStatuses)

						const instances = this.registry.get(instancesAtom)
						const instance = instances.get(sourcePort)
						if (instance) {
							const mapping = this.registry.get(sessionToInstancePortAtom)
							const updatedMapping = new Map(mapping)
							updatedMapping.set(sessionId, instance.port)
							this.registry.set(sessionToInstancePortAtom, updatedMapping)
						}
					}
				}
				break
			}

			case "part.created":
			case "part.updated":
			case "message.part.updated": {
				// Handle both part.* and message.part.updated event types
				// message.part.updated wraps part data in a "part" property
				const partData =
					type === "message.part.updated"
						? (properties as { part?: Part }).part
						: (properties as unknown as Part)

				if (partData?.id) {
					// Upsert part in partsAtom (Map)
					const parts = this.registry.get(partsAtom)
					const updated = new Map(parts)
					updated.set(partData.id, partData)
					this.registry.set(partsAtom, updated)

					// Map session to instance via part → messageID → sessionID lookup
					// Get message to find sessionID
					const messages = this.registry.get(messagesAtom)
					const message = messages.get(partData.messageID)
					const sessionId = message?.sessionID

					// CRITICAL: Receiving part events = session is DEFINITELY running
					// This is a STRONG SIGNAL - we're getting live streaming content
					if (sessionId) {
						const statuses = this.registry.get(statusAtom)
						const updatedStatuses = new Map(statuses)
						updatedStatuses.set(sessionId, "running")
						this.registry.set(statusAtom, updatedStatuses)

						const instances = this.registry.get(instancesAtom)
						const instance = instances.get(sourcePort)
						if (instance) {
							const mapping = this.registry.get(sessionToInstancePortAtom)
							const updatedMapping = new Map(mapping)
							updatedMapping.set(sessionId, instance.port)
							this.registry.set(sessionToInstancePortAtom, updatedMapping)
						}
					}
				}
				break
			}

			case "session.status": {
				const { sessionID, status } = properties as {
					sessionID?: string
					status?: SessionStatus
				}
				if (sessionID && status) {
					// Update status in statusAtom (Map)
					const statuses = this.registry.get(statusAtom)
					const updated = new Map(statuses)
					updated.set(sessionID, status)
					this.registry.set(statusAtom, updated)

					// Map session to instance for status events too
					const instances = this.registry.get(instancesAtom)
					const instance = instances.get(sourcePort)
					if (instance) {
						const mapping = this.registry.get(sessionToInstancePortAtom)
						const updatedMapping = new Map(mapping)
						updatedMapping.set(sessionID, instance.port)
						this.registry.set(sessionToInstancePortAtom, updatedMapping)
					}
				}
				break
			}
		}
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
 * @param registry - Registry to feed events into
 * @param config - SSE configuration
 *
 * @example
 * ```typescript
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
