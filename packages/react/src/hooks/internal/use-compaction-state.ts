/**
 * useCompactionState - Internal hook with World Stream delegation
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
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
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"
import { useWorldCompactionState } from "../use-world-compaction-state.js"
import { getCompactionState as getCompactionStateHelper } from "../../lib/delegation-helpers"

/**
 * Hook to get compaction state for a session
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * This enables gradual migration from Zustand to World Stream.
 *
 * Uses shared delegation helper for DRY with factory.
 *
 * @param sessionId - Session ID to get compaction state for
 * @returns Compaction state with isCompacting, progress, etc.
 */
export function useCompactionState(sessionId: string): CompactionState {
	const { directory } = useOpencode()

	// Try World Stream first
	const worldValue = useWorldCompactionState(sessionId)

	// Get full store state (needed by helper)
	const store = useOpencodeStore()

	// Use shared delegation helper
	return getCompactionStateHelper(worldValue, store, sessionId, directory)
}
