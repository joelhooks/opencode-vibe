/**
 * useWorldCompactionState - Get compaction state for a session
 *
 * Derives from useWorld() - no additional subscriptions needed.
 * Returns undefined if session not found or compactionState not available.
 *
 * ARCHITECTURE (ADR-016, ADR-018):
 * - Derived hook that selects from useWorld()
 * - Uses useMemo for memoization to prevent unnecessary re-renders
 * - Returns undefined when session not found or compactionState not available
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world (for types)
 * - Import useWorld from ./use-world.js
 * - No Effect types
 *
 * @example
 * ```tsx
 * function CompactionIndicator({ sessionId }: { sessionId: string }) {
 *   const compactionState = useWorldCompactionState(sessionId)
 *
 *   if (!compactionState?.isCompacting) {
 *     return null
 *   }
 *
 *   return (
 *     <div>
 *       <p>Compacting... {compactionState.progress ?? 0}%</p>
 *       {compactionState.isAutomatic && <p>Auto-triggered</p>}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import { useWorld } from "./use-world.js"
// Import from specific file to avoid barrel file pulling in Node.js-only deps
import type { CompactionState } from "@opencode-vibe/core/world/types"

/**
 * Get compaction state for a session
 *
 * @param sessionId - Session ID to lookup
 * @returns CompactionState if session found and compaction state available, undefined otherwise
 */
export function useWorldCompactionState(sessionId: string): CompactionState | undefined {
	const world = useWorld()

	return useMemo(() => {
		const session = world.sessions.find((s) => s.id === sessionId)
		return session?.compactionState
	}, [world.sessions, sessionId])
}
