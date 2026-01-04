/**
 * useWorldContextUsage - Get context usage metrics for a session
 *
 * Derives from useWorld() - no additional subscriptions needed.
 * Returns undefined if session not found or contextUsage not computed yet.
 *
 * ARCHITECTURE (ADR-016, ADR-018):
 * - Derived hook that selects from useWorld()
 * - Uses useMemo for memoization to prevent unnecessary re-renders
 * - Returns undefined when session not found or contextUsage not available
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world (for types)
 * - Import useWorld from ./use-world.js
 * - No Effect types
 *
 * @example
 * ```tsx
 * function ContextUsageIndicator({ sessionId }: { sessionId: string }) {
 *   const contextUsage = useWorldContextUsage(sessionId)
 *
 *   if (!contextUsage) {
 *     return null
 *   }
 *
 *   return (
 *     <div>
 *       <p>Used: {contextUsage.used.toLocaleString()} / {contextUsage.limit.toLocaleString()}</p>
 *       <p>Progress: {contextUsage.percentage}%</p>
 *       {contextUsage.isNearLimit && <Warning>Approaching limit!</Warning>}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import { useWorld } from "./use-world.js"
// Import from specific file to avoid barrel file pulling in Node.js-only deps
import type { ContextUsage } from "@opencode-vibe/core/world/types"

/**
 * Get context usage metrics for a session
 *
 * @param sessionId - Session ID to lookup
 * @returns ContextUsage if session found and metrics available, undefined otherwise
 */
export function useWorldContextUsage(sessionId: string): ContextUsage | undefined {
	const world = useWorld()

	return useMemo(() => {
		const session = world.sessions.find((s) => s.id === sessionId)
		return session?.contextUsage
	}, [world.sessions, sessionId])
}
