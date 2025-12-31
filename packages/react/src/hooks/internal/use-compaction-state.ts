/**
 * useCompactionState - Store selector for session compaction state
 *
 * Selects compaction state from Zustand store populated by message.updated SSE events.
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

/**
 * Default compaction state when no compaction is active
 */
const DEFAULT_COMPACTION_STATE: CompactionState = {
	isCompacting: false,
	isAutomatic: false,
	progress: "complete",
	startedAt: 0,
}

/**
 * Hook to get compaction state for a session from store
 *
 * @param sessionId - Session ID to get compaction state for
 * @returns Compaction state with isCompacting, progress, etc.
 */
export function useCompactionState(sessionId: string): CompactionState {
	const { directory } = useOpencode()
	return useOpencodeStore(
		(state) => state.directories[directory]?.compaction[sessionId] ?? DEFAULT_COMPACTION_STATE,
	)
}
