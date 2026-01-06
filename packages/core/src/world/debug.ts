/**
 * World Stream Debug Utilities
 *
 * Provides debug statistics for agent-debug endpoint.
 * Computes message counts at global and session level.
 */

import type { Registry } from "@effect-atom/atom"
import { messagesAtom, sessionsAtom, partsAtom, statusAtom, connectionStatusAtom } from "./atoms.js"

/**
 * Debug statistics for World Stream state
 */
export interface WorldDebugStats {
	/** Total messages across all sessions */
	totalMessages: number
	/** Total sessions */
	totalSessions: number
	/** Total parts across all messages */
	totalParts: number
	/** Connection status */
	connectionStatus: "discovering" | "connecting" | "connected" | "disconnected" | "error"
	/** Per-session message counts */
	messagesBySession: Map<string, number>
}

/**
 * Compute debug statistics from World Stream atoms
 *
 * @param registry - Atom registry to read from
 * @returns Debug statistics
 *
 * @example
 * ```typescript
 * import { Registry } from "@effect-atom/atom"
 * import { getWorldDebugStats } from "@opencode-vibe/core/world/debug"
 *
 * const registry = Registry.make()
 * const stats = getWorldDebugStats(registry)
 * console.log(`Total messages: ${stats.totalMessages}`)
 * console.log(`Messages in session X: ${stats.messagesBySession.get("session-id")}`)
 * ```
 */
export function getWorldDebugStats(registry: Registry.Registry): WorldDebugStats {
	// Get atoms
	const messages = registry.get(messagesAtom)
	const sessions = registry.get(sessionsAtom)
	const parts = registry.get(partsAtom)
	const connectionStatus = registry.get(connectionStatusAtom)

	// Compute per-session message counts
	const messagesBySession = new Map<string, number>()
	for (const message of messages.values()) {
		const count = messagesBySession.get(message.sessionID) ?? 0
		messagesBySession.set(message.sessionID, count + 1)
	}

	return {
		totalMessages: messages.size,
		totalSessions: sessions.size,
		totalParts: parts.size,
		connectionStatus,
		messagesBySession,
	}
}
