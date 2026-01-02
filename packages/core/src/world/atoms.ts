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
import type { EnrichedMessage, EnrichedSession, WorldState } from "./types.js"
import { WorldMetrics } from "./metrics.js"

/**
 * Internal state container
 */
interface WorldStateData {
	sessions: Session[]
	messages: Message[]
	parts: Part[]
	status: Record<string, SessionStatus>
	connectionStatus: "connecting" | "connected" | "disconnected" | "error"
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
	setConnectionStatus(status: "connecting" | "connected" | "disconnected" | "error"): void {
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

		const worldState = {
			sessions: enrichedSessions,
			activeSessionCount,
			activeSession,
			connectionStatus: data.connectionStatus,
			lastUpdated: Date.now(),
			byDirectory,
			stats,
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
		status: "connecting" | "connected" | "disconnected" | "error",
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
				setConnectionStatus: (status: "connecting" | "connected" | "disconnected" | "error") =>
					Effect.sync(() => store.setConnectionStatus(status)),
			}
		}),
		// Release: Cleanup (WorldStore has no explicit cleanup currently)
		() => Effect.void,
	),
)

/**
 * effect-atom based state atoms
 *
 * These atoms provide a reactive state management layer that will eventually
 * replace the WorldStore class. They use effect-atom for fine-grained reactivity.
 */

/**
 * Sessions atom - Map of session ID to Session
 */
export const sessionsAtom = Atom.make(new Map<string, Session>())

/**
 * Messages atom - Map of session ID to Message array
 */
export const messagesAtom = Atom.make(new Map<string, Message[]>())

/**
 * Parts atom - Map of message ID to Part array
 */
export const partsAtom = Atom.make(new Map<string, Part[]>())

/**
 * Status atom - Map of session ID to SessionStatus
 */
export const statusAtom = Atom.make(new Map<string, SessionStatus>())

/**
 * Connection status atom
 */
export const connectionStatusAtom = Atom.make<
	"connecting" | "connected" | "disconnected" | "error"
>("disconnected")

/**
 * Derived atom - session count
 */
export const sessionCountAtom = Atom.make((get) => get(sessionsAtom).size)

/**
 * Re-export Registry for convenience
 */
export { Atom, Registry }
