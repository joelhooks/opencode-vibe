/**
 * useCompactionState - Internal hook with World Stream delegation
 *
 * Delegates to World Stream for compaction state.
 * Returns default state if session has no active compaction.
 *
 * @example
 * ```tsx
 * function CompactionIndicator({ sessionId }: { sessionId: string }) {
 *   const { isCompacting, progress } = useCompactionState(sessionId)
 *
 *   if (!isCompacting) return null
 *
 *   return (
 *     <div>
 *       Compacting: {progress}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import type { CompactionState } from "../../store/types"
import { useWorldCompactionState } from "../use-world-compaction-state.js"
import { getCompactionState as getCompactionStateHelper } from "../../lib/delegation-helpers"

/**
 * Hook to get compaction state for a session
 *
 * Delegates to World Stream - the single source of truth.
 * Uses helper to map Core type to React store type.
 *
 * @param sessionId - Session ID to get compaction state for
 * @returns Compaction state with isCompacting, progress, etc.
 */
export function useCompactionState(sessionId: string): CompactionState {
	const worldValue = useWorldCompactionState(sessionId)
	return getCompactionStateHelper(worldValue)
}
