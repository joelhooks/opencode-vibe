/**
 * World Stream State Management - effect-atom primitives
 *
 * Pure effect-atom based state atoms for World Stream reactive state.
 * Uses Registry.set() for auto-invalidation (no manual notify()).
 */

import { Atom } from "@effect-atom/atom"
import * as Registry from "@effect-atom/atom/Registry"
import { Duration, Effect, Metric } from "effect"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import type { Project } from "../types/sdk.js"
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
 * effect-atom based state atoms
 *
 * Pure effect-atom primitives that replace WorldStore class.
 * Uses Registry.set() for auto-invalidation (no manual notify()).
 */

/**
 * Sessions atom - Map for O(1) lookup by session ID
 */
export const sessionsAtom = Atom.make(new Map<string, Session>()).pipe(
	Atom.setIdleTTL(Duration.minutes(5)),
)

/**
 * Messages atom - Map of message ID to Message
 */
export const messagesAtom = Atom.make(new Map<string, Message>()).pipe(
	Atom.setIdleTTL(Duration.minutes(5)),
)

/**
 * Parts atom - Map of part ID to Part
 */
export const partsAtom = Atom.make(new Map<string, Part>()).pipe(
	Atom.setIdleTTL(Duration.minutes(5)),
)

/**
 * Status atom - Map of session ID to SessionStatus
 */
export const statusAtom = Atom.make(new Map<string, SessionStatus>()).pipe(
	Atom.setIdleTTL(Duration.minutes(5)),
)

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
export const sessionToInstancePortAtom = Atom.make(new Map<string, number>()).pipe(
	Atom.setIdleTTL(Duration.minutes(5)),
)

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

	// Use pure deriveWorldStateFromData() function
	return deriveWorldStateFromData(data)
}).pipe(Atom.keepAlive)

/**
 * Pure function: derive WorldState from WorldStateData
 *
 * Computes enriched world state from primitive atoms data.
 * Used by worldStateAtom for auto-invalidating derived state.
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
		// CRITICAL: cache.write is billing-only, does NOT consume context
		// Formula: used = input + output + reasoning + cache.read (excludes cache.write)
		//          usableContext = limit - min(outputLimit, 32K)
		//          percentage = round((used / usableContext) * 100)
		let contextUsagePercent = 0
		let contextUsage: ContextUsage | undefined = undefined
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role === "assistant" && msg.tokens && msg.model?.limits?.context) {
				const inputTokens = msg.tokens.input
				const outputTokens = msg.tokens.output
				const reasoningTokens = msg.tokens.reasoning ?? 0
				const cachedTokens = msg.tokens.cache?.read ?? 0 // Only cache.read counts

				// Step 1: Sum tokens that count toward context (excludes cache.write)
				const used = inputTokens + outputTokens + reasoningTokens + cachedTokens

				// Step 2: Calculate usable context (reserve space for output, cap at 32K)
				const outputReserve = Math.min(msg.model.limits.output ?? 16000, 32000)
				const usableContext = msg.model.limits.context - outputReserve

				// Step 3: Calculate percentage
				const percentage = Math.round((used / usableContext) * 100)

				// Backward compat
				contextUsagePercent = percentage

				// New detailed context usage
				contextUsage = {
					used,
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

	// Compute lastUpdated from actual data (most recent session activity)
	// This ensures stable value when data doesn't change (no Date.now())
	const lastUpdated =
		enrichedSessions.length > 0 ? Math.max(...enrichedSessions.map((s) => s.lastActivityAt)) : 0

	const worldState = {
		sessions: enrichedSessions,
		activeSessionCount,
		activeSession,
		connectionStatus: data.connectionStatus,
		lastUpdated,
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

/**
 * Re-export SessionAtom infrastructure (ADR-019 Phase 2)
 */
export {
	type SessionAtom,
	getOrCreateSessionAtom,
	sessionAtomRegistry,
	clearSessionAtomRegistry,
} from "./session-atom.js"
