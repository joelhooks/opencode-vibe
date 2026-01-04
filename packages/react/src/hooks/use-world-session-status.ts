/**
 * useWorldSessionStatus - Get session status from world state
 *
 * Derives from useWorld() - no additional subscriptions needed.
 * Returns undefined if session not found.
 *
 * ARCHITECTURE (ADR-016, ADR-018):
 * - Derived hook that selects from useWorld()
 * - Uses useMemo for memoization to prevent unnecessary re-renders
 * - Returns undefined when session not found
 * - Uses backward-compat string status from EnrichedSession
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world (for types)
 * - Import useWorld from ./use-world.js
 * - No Effect types
 *
 * @example
 * ```tsx
 * function SessionStatusBadge({ sessionId }: { sessionId: string }) {
 *   const status = useWorldSessionStatus(sessionId)
 *
 *   if (!status) {
 *     return null
 *   }
 *
 *   return (
 *     <span className={`badge badge-${status}`}>
 *       {status}
 *     </span>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import { useWorld } from "./use-world.js"
// Import from core/types - SessionStatus is re-exported there
import type { SessionStatus } from "@opencode-vibe/core/types"

/**
 * Get session status from world state
 *
 * @param sessionId - Session ID to lookup
 * @returns SessionStatus if session found, undefined otherwise
 */
export function useWorldSessionStatus(sessionId: string): SessionStatus | undefined {
	const world = useWorld()

	return useMemo(() => {
		const session = world.sessions.find((s) => s.id === sessionId)
		return session?.status
	}, [world.sessions, sessionId])
}
