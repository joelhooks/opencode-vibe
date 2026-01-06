/**
 * React hook for World Stream debug statistics
 *
 * Provides message count tracking at global and session level.
 * Used by agent-debug endpoint for observability.
 */

"use client"

import { useWorld, getWorldRegistry } from "./use-world"
import { getWorldDebugStats } from "@opencode-vibe/core/world/debug"
import type { WorldDebugStats } from "@opencode-vibe/core/world/debug"

/**
 * Hook to get World Stream debug statistics
 *
 * REACTIVE: Depends on useWorld() to trigger re-renders when atoms change.
 * Computes debug stats on every render (cheap operation - just reads from Maps).
 *
 * @returns Debug statistics with message counts
 *
 * @example
 * ```tsx
 * function AgentDebug() {
 *   const debug = useWorldDebug()
 *
 *   return (
 *     <div>
 *       <p>Total messages: {debug.totalMessages}</p>
 *       <p>Messages in session: {debug.messagesBySession.get(sessionId) ?? 0}</p>
 *     </div>
 *   )
 * }
 * ```
 */
export function useWorldDebug(): WorldDebugStats | null {
	// Subscribe to world state changes to trigger re-renders
	// This ensures debug stats update when atoms change
	useWorld()
	const registry = getWorldRegistry()

	// Compute debug stats from registry on every render
	// This is cheap (just reads from Maps) and ensures we always have fresh data
	if (!registry) return null
	return getWorldDebugStats(registry)
}
