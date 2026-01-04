/**
 * World Stream State Management
 *
 * SPIKE SIMPLIFICATION: Using plain TypeScript instead of effect-atom for rapid prototyping.
 * This can be upgraded to effect-atom later once we validate the API design.
 *
 * State holder with computed derived values. Subscribers get notified on changes.
 */

import { Atom } from "@effect-atom/atom"
import * as Registry from "@effect-atom/atom/Registry"
import { Effect, Metric, Context, Layer } from "effect"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import type { Project, SessionStatus as SessionStatusObject } from "../types/sdk.js"
import type {
	EnrichedMessage,
	EnrichedSession,
	WorldState,
	Instance,
	ContextUsage,
	CompactionState,
} from "./types.js"
import { WorldMetrics } from "./metrics.js"

/**
 * Internal state container
 */
interface WorldStateData {
	sessions: Session[]
	messages: Message[]
	parts: Part[]
	status: Record<string, SessionStatus>
	connectionStatus: "discovering" | "connecting" | "connected" | "disconnected" | "error"
	instances: Instance[]
	projects: Project[]
	sessionToInstancePort: Record<string, number>
}

/**
 * Subscriber callback
 */
type WorldSubscriber = (state: WorldState) => void

/**
 * World state store
 */
export class WorldStore {
	private data: WorldStateData = {
		sessions: [],
		messages: [],
		parts: [],
		status: {},
		connectionStatus: "disconnected",
		instances: [],
		projects: [],
		sessionToInstancePort: {},
	}

	private subscribers = new Set<WorldSubscriber>()

	/**
	 * Subscribe to world state changes
	 *
	 * Fires immediately with current state, then on each change.
	 * Pattern: BehaviorSubject-like - subscribers always see current state.
	 */
	subscribe(callback: WorldSubscriber): () => void {
		this.subscribers.add(callback)
		// Fire immediately with current state (like React useState)
		callback(this.getState())
		return () => this.subscribers.delete(callback)
	}

	/**
	 * Get current world state snapshot
	 */
	getState(): WorldState {
		return this.deriveWorldState(this.data)
	}

	/**
	 * Update sessions
	 */
	setSessions(sessions: Session[]): void {
		this.data.sessions = sessions
		this.notify()
	}

	/**
	 * Update messages
	 */
	setMessages(messages: Message[]): void {
		this.data.messages = messages
		this.notify()
	}

	/**
	 * Update parts
	 */
	setParts(parts: Part[]): void {
		this.data.parts = parts
		this.notify()
	}

	/**
	 * Update session status (bulk)
	 */
	setStatus(status: Record<string, SessionStatus>): void {
		this.data.status = status
		this.notify()
	}

	/**
	 * Update single session status
	 */
	updateStatus(sessionId: string, status: SessionStatus): void {
		this.data.status = { ...this.data.status, [sessionId]: status }
		this.notify()
	}

	/**
	 * Upsert session by ID using binary search for O(log n) updates
	 */
	upsertSession(session: Session): void {
		const index = this.binarySearch(this.data.sessions, session.id)
		if (index >= 0) {
			// Update existing
			this.data.sessions[index] = session
		} else {
			// Insert at correct position to maintain sort
			const insertIndex = -(index + 1)
			this.data.sessions.splice(insertIndex, 0, session)
		}
		this.notify()
	}

	/**
	 * Upsert message by ID using binary search for O(log n) updates
	 */
	upsertMessage(message: Message): void {
		const index = this.binarySearch(this.data.messages, message.id)
		if (index >= 0) {
			// Update existing
			this.data.messages[index] = message
		} else {
			// Insert at correct position to maintain sort
			const insertIndex = -(index + 1)
			this.data.messages.splice(insertIndex, 0, message)
		}
		this.notify()
	}

	/**
	 * Upsert part by ID using binary search for O(log n) updates
	 */
	upsertPart(part: Part): void {
		const index = this.binarySearch(this.data.parts, part.id)
		if (index >= 0) {
			// Update existing
			this.data.parts[index] = part
		} else {
			// Insert at correct position to maintain sort
			const insertIndex = -(index + 1)
			this.data.parts.splice(insertIndex, 0, part)
		}
		this.notify()
	}

	/**
	 * Get sessionID for a message by messageID
	 * Used to mark session as active when receiving part events
	 */
	getMessageSessionId(messageId: string): string | undefined {
		const index = this.binarySearch(this.data.messages, messageId)
		if (index >= 0) {
			return this.data.messages[index].sessionID
		}
		return undefined
	}

	/**
	 * Update instances (bulk)
	 */
	setInstances(instances: Instance[]): void {
		this.data.instances = instances
		this.notify()
	}

	/**
	 * Update projects (bulk)
	 */
	setProjects(projects: Project[]): void {
		this.data.projects = projects
		this.notify()
	}

	/**
	 * Map session to instance for routing
	 */
	setSessionToInstance(sessionId: string, instance: Instance): void {
		this.data.sessionToInstancePort = {
			...this.data.sessionToInstancePort,
			[sessionId]: instance.port,
		}
		this.notify()
	}

	/**
	 * Upsert instance by port using binary search for O(log n) updates
	 */
	upsertInstance(instance: Instance): void {
		const index = this.binarySearchByPort(this.data.instances, instance.port)
		if (index >= 0) {
			// Update existing
			this.data.instances[index] = instance
		} else {
			// Insert at correct position to maintain sort by port
			const insertIndex = -(index + 1)
			this.data.instances.splice(insertIndex, 0, instance)
		}
		this.notify()
	}

	/**
	 * Update instance status by port
	 */
	updateInstanceStatus(port: number, status: Instance["status"]): void {
		const index = this.binarySearchByPort(this.data.instances, port)
		if (index >= 0) {
			this.data.instances[index] = {
				...this.data.instances[index],
				status,
			}
			this.notify()
		}
	}

	/**
	 * Remove instance by port
	 */
	removeInstance(port: number): void {
		const index = this.binarySearchByPort(this.data.instances, port)
		if (index >= 0) {
			this.data.instances.splice(index, 1)
			this.notify()
		}
	}

	/**
	 * Binary search for instance by port in sorted array
	 * @returns Index if found, or negative insertion point - 1 if not found
	 */
	private binarySearchByPort(array: Instance[], port: number): number {
		// Increment binary search counter
		Effect.runSync(Metric.increment(WorldMetrics.binarySearchTotal))

		let left = 0
		let right = array.length - 1

		while (left <= right) {
			const mid = Math.floor((left + right) / 2)
			const midPort = array[mid].port

			if (midPort === port) {
				return mid
			}

			if (midPort < port) {
				left = mid + 1
			} else {
				right = mid - 1
			}
		}

		// Not found - return negative insertion point - 1
		return -(left + 1)
	}

	/**
	 * Binary search for item by ID in sorted array
	 * @returns Index if found, or negative insertion point - 1 if not found
	 */
	private binarySearch(array: Array<{ id: string }>, id: string): number {
		// Increment binary search counter
		Effect.runSync(Metric.increment(WorldMetrics.binarySearchTotal))

		let left = 0
		let right = array.length - 1

		while (left <= right) {
			const mid = Math.floor((left + right) / 2)
			const midId = array[mid].id

			if (midId === id) {
				return mid
			}

			if (midId < id) {
				left = mid + 1
			} else {
				right = mid - 1
			}
		}

		// Not found - return negative insertion point - 1
		return -(left + 1)
	}

	/**
	 * Update connection status
	 */
	setConnectionStatus(
		status: "discovering" | "connecting" | "connected" | "disconnected" | "error",
	): void {
		this.data.connectionStatus = status
		this.notify()
	}

	/**
	 * Notify all subscribers
	 */
	private notify(): void {
		const worldState = this.getState()
		for (const subscriber of this.subscribers) {
			subscriber(worldState)
		}
	}

	/**
	 * Derive enriched world state from raw data
	 */
	private deriveWorldState(data: WorldStateData): WorldState {
		// Log derivation start with input counts
		Effect.runSync(
			Effect.logDebug("World state derivation started").pipe(
				Effect.annotateLogs({
					sessionCount: data.sessions.length,
					messageCount: data.messages.length,
					partCount: data.parts.length,
				}),
			),
		)

		// Build message ID -> parts map
		const partsByMessage = new Map<string, Part[]>()
		for (const part of data.parts) {
			const existing = partsByMessage.get(part.messageID) ?? []
			existing.push(part)
			partsByMessage.set(part.messageID, existing)
		}

		Effect.runSync(
			Effect.logDebug("Parts indexed by message").pipe(
				Effect.annotateLogs({
					messageCount: partsByMessage.size,
				}),
			),
		)

		// Build session ID -> messages map
		const messagesBySession = new Map<string, EnrichedMessage[]>()
		for (const msg of data.messages) {
			const msgParts = partsByMessage.get(msg.id) ?? []
			const enrichedMsg: EnrichedMessage = {
				...msg,
				parts: msgParts,
				// Message is streaming if it's assistant role and has no completed time
				isStreaming: msg.role === "assistant" && !msg.time?.completed,
			}

			const existing = messagesBySession.get(msg.sessionID) ?? []
			existing.push(enrichedMsg)
			messagesBySession.set(msg.sessionID, existing)
		}

		Effect.runSync(
			Effect.logDebug("Messages indexed by session").pipe(
				Effect.annotateLogs({
					sessionCount: messagesBySession.size,
					totalMessages: data.messages.length,
				}),
			),
		)

		// Build enriched sessions
		const enrichedSessions: EnrichedSession[] = data.sessions.map((session) => {
			const sessionMessages = messagesBySession.get(session.id) ?? []
			const sessionStatus = data.status[session.id] ?? "completed"
			const isActive = sessionStatus === "running"

			// Last activity is most recent message or session update
			const lastMessageTime =
				sessionMessages.length > 0
					? Math.max(...sessionMessages.map((m) => m.time?.created ?? 0))
					: 0
			const lastActivityAt = Math.max(lastMessageTime, session.time.updated)

			// Context usage percent - compute from last assistant message tokens
			// Total tokens = input + output + reasoning + cache.read + cache.write
			let contextUsagePercent = 0
			for (let i = sessionMessages.length - 1; i >= 0; i--) {
				const msg = sessionMessages[i]
				if (msg.role === "assistant" && msg.tokens && msg.model?.limits?.context) {
					const totalTokens =
						msg.tokens.input +
						msg.tokens.output +
						(msg.tokens.reasoning ?? 0) +
						(msg.tokens.cache?.read ?? 0) +
						(msg.tokens.cache?.write ?? 0)
					contextUsagePercent = (totalTokens / msg.model.limits.context) * 100
					break
				}
			}

			return {
				...session,
				status: sessionStatus,
				isActive,
				messages: sessionMessages,
				unreadCount: 0, // TODO: implement unread tracking
				contextUsagePercent,
				lastActivityAt,
			}
		})

		// Sort sessions by last activity (most recent first)
		enrichedSessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)

		// Active session is the most recently active one
		const activeSession = enrichedSessions.find((s) => s.isActive) ?? enrichedSessions[0] ?? null
		const activeSessionCount = enrichedSessions.filter((s) => s.isActive).length

		// Group sessions by directory
		const byDirectory = new Map<string, EnrichedSession[]>()
		for (const session of enrichedSessions) {
			const existing = byDirectory.get(session.directory) ?? []
			existing.push(session)
			byDirectory.set(session.directory, existing)
		}

		// Compute stats
		const stats = {
			total: enrichedSessions.length,
			active: activeSessionCount,
			streaming: enrichedSessions.filter((s) => s.messages.some((m) => m.isStreaming)).length,
		}

		// Build instance maps
		const instanceByPort = new Map<number, Instance>()
		for (const instance of data.instances) {
			instanceByPort.set(instance.port, instance)
		}

		const instancesByDirectory = new Map<string, Instance[]>()
		for (const instance of data.instances) {
			const existing = instancesByDirectory.get(instance.directory) ?? []
			existing.push(instance)
			instancesByDirectory.set(instance.directory, existing)
		}

		const connectedInstanceCount = data.instances.filter((i) => i.status === "connected").length

		// Build sessionToInstance map from sessionToInstancePort
		const sessionToInstance = new Map<string, Instance>()
		for (const [sessionId, port] of Object.entries(data.sessionToInstancePort)) {
			const instance = instanceByPort.get(port)
			if (instance) {
				sessionToInstance.set(sessionId, instance)
			}
		}

		// Enrich projects with instances and sessions
		const enrichedProjects = data.projects.map((project) => {
			// Use worktree from SDK Project type
			const projectInstances = instancesByDirectory.get(project.worktree) ?? []
			const projectSessions = byDirectory.get(project.worktree) ?? []

			const activeInstanceCount = projectInstances.filter((i) => i.status === "connected").length
			const sessionCount = projectSessions.length
			const activeSessionCount = projectSessions.filter((s) => s.isActive).length

			// Last activity is most recent session activity or 0
			const lastActivityAt =
				projectSessions.length > 0 ? Math.max(...projectSessions.map((s) => s.lastActivityAt)) : 0

			return {
				...project,
				instances: projectInstances,
				activeInstanceCount,
				sessions: projectSessions,
				sessionCount,
				activeSessionCount,
				lastActivityAt,
			}
		})

		const projectByDirectory = new Map<string, (typeof enrichedProjects)[0]>()
		for (const project of enrichedProjects) {
			projectByDirectory.set(project.worktree, project)
		}

		const worldState = {
			sessions: enrichedSessions,
			activeSessionCount,
			activeSession,
			connectionStatus: data.connectionStatus,
			lastUpdated: Date.now(),
			byDirectory,
			statuses: new Map(Object.entries(data.status)), // Expose status map for consumers
			stats,
			instances: data.instances,
			instanceByPort,
			instancesByDirectory,
			connectedInstanceCount,
			projects: enrichedProjects,
			projectByDirectory,
			sessionToInstance,
		}

		// Update metrics after derivation completes
		Effect.runSync(
			Effect.all([
				Metric.set(WorldMetrics.worldSessionsTotal, stats.total),
				Metric.set(WorldMetrics.worldSessionsActive, stats.active),
			]).pipe(
				Effect.tap(() =>
					Effect.logDebug("World state derivation completed").pipe(
						Effect.annotateLogs({
							totalSessions: stats.total,
							activeSessions: stats.active,
							streamingSessions: stats.streaming,
						}),
					),
				),
			),
		)

		return worldState
	}
}

// ============================================================================
// WorldStoreService - Effect.Service wrapper
// ============================================================================

/**
 * WorldStoreService interface - Effect.Service wrapper around WorldStore
 *
 * Provides scoped lifecycle management with Effect.Service pattern.
 * The WorldStore instance is created on acquire and cleaned up on release.
 */
export interface WorldStoreServiceInterface {
	/**
	 * Subscribe to world state changes
	 */
	subscribe: (callback: WorldSubscriber) => Effect.Effect<() => void, never, never>

	/**
	 * Get current world state snapshot
	 */
	getState: () => Effect.Effect<WorldState, never, never>

	/**
	 * Update sessions
	 */
	setSessions: (sessions: Session[]) => Effect.Effect<void, never, never>

	/**
	 * Update messages
	 */
	setMessages: (messages: Message[]) => Effect.Effect<void, never, never>

	/**
	 * Update parts
	 */
	setParts: (parts: Part[]) => Effect.Effect<void, never, never>

	/**
	 * Update session status (bulk)
	 */
	setStatus: (status: Record<string, SessionStatus>) => Effect.Effect<void, never, never>

	/**
	 * Update single session status
	 */
	updateStatus: (sessionId: string, status: SessionStatus) => Effect.Effect<void, never, never>

	/**
	 * Upsert session by ID
	 */
	upsertSession: (session: Session) => Effect.Effect<void, never, never>

	/**
	 * Upsert message by ID
	 */
	upsertMessage: (message: Message) => Effect.Effect<void, never, never>

	/**
	 * Upsert part by ID
	 */
	upsertPart: (part: Part) => Effect.Effect<void, never, never>

	/**
	 * Get sessionID for a message by messageID
	 */
	getMessageSessionId: (messageId: string) => Effect.Effect<string | undefined, never, never>

	/**
	 * Update connection status
	 */
	setConnectionStatus: (
		status: "discovering" | "connecting" | "connected" | "disconnected" | "error",
	) => Effect.Effect<void, never, never>
}

/**
 * WorldStoreService tag for dependency injection
 */
export class WorldStoreService extends Context.Tag("WorldStoreService")<
	WorldStoreService,
	WorldStoreServiceInterface
>() {}

/**
 * WorldStoreService Layer with scoped lifecycle
 *
 * Pattern from cursor-store.ts: Layer.scoped wraps WorldStore class,
 * providing Effect-native lifecycle management.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const store = yield* WorldStoreService
 *   yield* store.setSessions([...])
 *   const state = yield* store.getState()
 *   // Auto-cleanup when scope exits
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(WorldStoreServiceLive))
 * )
 * ```
 */
export const WorldStoreServiceLive: Layer.Layer<WorldStoreService, never, never> = Layer.scoped(
	WorldStoreService,
	Effect.acquireRelease(
		// Acquire: Create WorldStore instance
		Effect.sync(() => {
			const store = new WorldStore()

			return {
				subscribe: (callback: WorldSubscriber) => Effect.sync(() => store.subscribe(callback)),
				getState: () => Effect.sync(() => store.getState()),
				setSessions: (sessions: Session[]) => Effect.sync(() => store.setSessions(sessions)),
				setMessages: (messages: Message[]) => Effect.sync(() => store.setMessages(messages)),
				setParts: (parts: Part[]) => Effect.sync(() => store.setParts(parts)),
				setStatus: (status: Record<string, SessionStatus>) =>
					Effect.sync(() => store.setStatus(status)),
				updateStatus: (sessionId: string, status: SessionStatus) =>
					Effect.sync(() => store.updateStatus(sessionId, status)),
				upsertSession: (session: Session) => Effect.sync(() => store.upsertSession(session)),
				upsertMessage: (message: Message) => Effect.sync(() => store.upsertMessage(message)),
				upsertPart: (part: Part) => Effect.sync(() => store.upsertPart(part)),
				getMessageSessionId: (messageId: string) =>
					Effect.sync(() => store.getMessageSessionId(messageId)),
				setConnectionStatus: (
					status: "discovering" | "connecting" | "connected" | "disconnected" | "error",
				) => Effect.sync(() => store.setConnectionStatus(status)),
			}
		}),
		// Release: Cleanup (WorldStore has no explicit cleanup currently)
		() => Effect.void,
	),
)

/**
 * effect-atom based state atoms
 *
 * Pure effect-atom primitives that replace WorldStore class.
 * Uses Registry.set() for auto-invalidation (no manual notify()).
 */

/**
 * Sessions atom - Map for O(1) lookup by session ID
 */
export const sessionsAtom = Atom.make(new Map<string, Session>()).pipe(Atom.keepAlive)

/**
 * Messages atom - Map of message ID to Message
 */
export const messagesAtom = Atom.make(new Map<string, Message>()).pipe(Atom.keepAlive)

/**
 * Parts atom - Map of part ID to Part
 */
export const partsAtom = Atom.make(new Map<string, Part>()).pipe(Atom.keepAlive)

/**
 * Status atom - Map of session ID to SessionStatus
 */
export const statusAtom = Atom.make(new Map<string, SessionStatus>()).pipe(Atom.keepAlive)

/**
 * Connection status atom
 */
export const connectionStatusAtom = Atom.make<
	"discovering" | "connecting" | "connected" | "disconnected" | "error"
>("disconnected").pipe(Atom.keepAlive)

/**
 * Instances atom - Map of port to Instance
 */
export const instancesAtom = Atom.make(new Map<number, Instance>()).pipe(Atom.keepAlive)

/**
 * Projects atom - Map of worktree path to Project
 */
export const projectsAtom = Atom.make(new Map<string, Project>()).pipe(Atom.keepAlive)

/**
 * Session to instance port mapping for routing
 */
export const sessionToInstancePortAtom = Atom.make(new Map<string, number>()).pipe(Atom.keepAlive)

/**
 * Derived atom - session count
 */
export const sessionCountAtom = Atom.make((get) => get(sessionsAtom).size).pipe(Atom.keepAlive)

/**
 * Derived atom - computes enriched WorldState from primitive atoms
 *
 * Auto-invalidates when any dependency atom changes (no manual notify()).
 * Converts Maps to arrays for deriveWorldStateFromData.
 */
export const worldStateAtom = Atom.make((get) => {
	const data: WorldStateData = {
		sessions: Array.from(get(sessionsAtom).values()),
		messages: Array.from(get(messagesAtom).values()),
		parts: Array.from(get(partsAtom).values()),
		status: Object.fromEntries(get(statusAtom)),
		connectionStatus: get(connectionStatusAtom),
		instances: Array.from(get(instancesAtom).values()),
		projects: Array.from(get(projectsAtom).values()),
		sessionToInstancePort: Object.fromEntries(get(sessionToInstancePortAtom)),
	}

	// Reuse WorldStore.deriveWorldState() logic
	// NOTE: This duplicates the derivation logic temporarily.
	// Once WorldStore is deleted, we can extract this as a pure function.
	return deriveWorldStateFromData(data)
}).pipe(Atom.keepAlive)

/**
 * Pure function: derive WorldState from WorldStateData
 *
 * Extracted from WorldStore.deriveWorldState() for reuse with atoms.
 * This is the SAME logic, ensuring behavioral equivalence.
 */
function deriveWorldStateFromData(data: WorldStateData): WorldState {
	// Log derivation start with input counts
	Effect.runSync(
		Effect.logDebug("World state derivation started").pipe(
			Effect.annotateLogs({
				sessionCount: data.sessions.length,
				messageCount: data.messages.length,
				partCount: data.parts.length,
			}),
		),
	)

	// Build message ID -> parts map
	const partsByMessage = new Map<string, Part[]>()
	for (const part of data.parts) {
		const existing = partsByMessage.get(part.messageID) ?? []
		existing.push(part)
		partsByMessage.set(part.messageID, existing)
	}

	Effect.runSync(
		Effect.logDebug("Parts indexed by message").pipe(
			Effect.annotateLogs({
				messageCount: partsByMessage.size,
			}),
		),
	)

	// Build session ID -> messages map
	const messagesBySession = new Map<string, EnrichedMessage[]>()
	for (const msg of data.messages) {
		const msgParts = partsByMessage.get(msg.id) ?? []
		const enrichedMsg: EnrichedMessage = {
			...msg,
			parts: msgParts,
			// Message is streaming if it's assistant role and has no completed time
			isStreaming: msg.role === "assistant" && !msg.time?.completed,
		}

		const existing = messagesBySession.get(msg.sessionID) ?? []
		existing.push(enrichedMsg)
		messagesBySession.set(msg.sessionID, existing)
	}

	Effect.runSync(
		Effect.logDebug("Messages indexed by session").pipe(
			Effect.annotateLogs({
				sessionCount: messagesBySession.size,
				totalMessages: data.messages.length,
			}),
		),
	)

	// Build enriched sessions
	const enrichedSessions: EnrichedSession[] = data.sessions.map((session) => {
		const sessionMessages = messagesBySession.get(session.id) ?? []
		const sessionStatus = data.status[session.id] ?? "completed"
		const isActive = sessionStatus === "running"

		// Last activity is most recent message or session update
		const lastMessageTime =
			sessionMessages.length > 0 ? Math.max(...sessionMessages.map((m) => m.time?.created ?? 0)) : 0
		const lastActivityAt = Math.max(lastMessageTime, session.time.updated)

		// Context usage percent - compute from last assistant message tokens
		// Total tokens = input + output + reasoning + cache.read + cache.write
		let contextUsagePercent = 0
		let contextUsage: ContextUsage | undefined = undefined
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role === "assistant" && msg.tokens && msg.model?.limits?.context) {
				const inputTokens = msg.tokens.input
				const outputTokens = msg.tokens.output
				const cachedTokens = (msg.tokens.cache?.read ?? 0) + (msg.tokens.cache?.write ?? 0)
				const totalTokens = inputTokens + outputTokens + (msg.tokens.reasoning ?? 0) + cachedTokens
				const percentage = (totalTokens / msg.model.limits.context) * 100

				// Backward compat
				contextUsagePercent = percentage

				// New detailed context usage
				contextUsage = {
					used: totalTokens,
					limit: msg.model.limits.context,
					percentage,
					isNearLimit: percentage > 80,
					tokens: {
						input: inputTokens,
						output: outputTokens,
						cached: cachedTokens,
					},
					lastUpdated: msg.time?.completed ?? msg.time?.created ?? Date.now(),
				}
				break
			}
		}

		// Detect compaction state from messages
		let compactionState: CompactionState | undefined = undefined
		for (const msg of sessionMessages) {
			if (msg.agent === "compaction") {
				// Active compaction detected
				const isCompacting = !msg.time?.completed // Still running if no completed time
				compactionState = {
					isCompacting,
					isAutomatic: true, // Default assumption - can be refined later
					startedAt: msg.time?.created,
					messageId: msg.id,
				}
				// Use first compaction message found (they're in chronological order)
				break
			}
		}

		return {
			...session,
			status: sessionStatus,
			isActive,
			messages: sessionMessages,
			unreadCount: 0, // TODO: implement unread tracking
			contextUsagePercent,
			contextUsage,
			compactionState,
			lastActivityAt,
		}
	})

	// Sort sessions by last activity (most recent first)
	enrichedSessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)

	// Active session is the most recently active one
	const activeSession = enrichedSessions.find((s) => s.isActive) ?? enrichedSessions[0] ?? null
	const activeSessionCount = enrichedSessions.filter((s) => s.isActive).length

	// Group sessions by directory
	const byDirectory = new Map<string, EnrichedSession[]>()
	for (const session of enrichedSessions) {
		const existing = byDirectory.get(session.directory) ?? []
		existing.push(session)
		byDirectory.set(session.directory, existing)
	}

	// Compute stats
	const stats = {
		total: enrichedSessions.length,
		active: activeSessionCount,
		streaming: enrichedSessions.filter((s) => s.messages.some((m) => m.isStreaming)).length,
	}

	// Build instance maps
	const instanceByPort = new Map<number, Instance>()
	for (const instance of data.instances) {
		instanceByPort.set(instance.port, instance)
	}

	const instancesByDirectory = new Map<string, Instance[]>()
	for (const instance of data.instances) {
		const existing = instancesByDirectory.get(instance.directory) ?? []
		existing.push(instance)
		instancesByDirectory.set(instance.directory, existing)
	}

	const connectedInstanceCount = data.instances.filter((i) => i.status === "connected").length

	// Build sessionToInstance map from sessionToInstancePort
	const sessionToInstance = new Map<string, Instance>()
	for (const [sessionId, port] of Object.entries(data.sessionToInstancePort)) {
		const instance = instanceByPort.get(port)
		if (instance) {
			sessionToInstance.set(sessionId, instance)
		}
	}

	// Enrich projects with instances and sessions
	const enrichedProjects = data.projects.map((project) => {
		// Use worktree from SDK Project type
		const projectInstances = instancesByDirectory.get(project.worktree) ?? []
		const projectSessions = byDirectory.get(project.worktree) ?? []

		const activeInstanceCount = projectInstances.filter((i) => i.status === "connected").length
		const sessionCount = projectSessions.length
		const activeSessionCount = projectSessions.filter((s) => s.isActive).length

		// Last activity is most recent session activity or 0
		const lastActivityAt =
			projectSessions.length > 0 ? Math.max(...projectSessions.map((s) => s.lastActivityAt)) : 0

		return {
			...project,
			instances: projectInstances,
			activeInstanceCount,
			sessions: projectSessions,
			sessionCount,
			activeSessionCount,
			lastActivityAt,
		}
	})

	const projectByDirectory = new Map<string, (typeof enrichedProjects)[0]>()
	for (const project of enrichedProjects) {
		projectByDirectory.set(project.worktree, project)
	}

	const worldState = {
		sessions: enrichedSessions,
		activeSessionCount,
		activeSession,
		connectionStatus: data.connectionStatus,
		lastUpdated: Date.now(),
		byDirectory,
		statuses: new Map(Object.entries(data.status)), // Expose status map for consumers
		stats,
		instances: data.instances,
		instanceByPort,
		instancesByDirectory,
		connectedInstanceCount,
		projects: enrichedProjects,
		projectByDirectory,
		sessionToInstance,
	}

	// Update metrics after derivation completes
	Effect.runSync(
		Effect.all([
			Metric.set(WorldMetrics.worldSessionsTotal, stats.total),
			Metric.set(WorldMetrics.worldSessionsActive, stats.active),
		]).pipe(
			Effect.tap(() =>
				Effect.logDebug("World state derivation completed").pipe(
					Effect.annotateLogs({
						totalSessions: stats.total,
						activeSessions: stats.active,
						streamingSessions: stats.streaming,
					}),
				),
			),
		),
	)

	return worldState
}

/**
 * Re-export Registry for convenience
 */
export { Atom, Registry }
