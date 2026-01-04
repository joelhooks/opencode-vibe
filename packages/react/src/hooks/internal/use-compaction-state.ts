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
 * Hook to get compaction state for a session
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * This enables gradual migration from Zustand to World Stream.
 *
 * @param sessionId - Session ID to get compaction state for
 * @returns Compaction state with isCompacting, progress, etc.
 */
export function useCompactionState(sessionId: string): CompactionState {
	const { directory } = useOpencode()

	// Try World Stream first
	const worldValue = useWorldCompactionState(sessionId)

	// Fallback to Zustand if World Stream doesn't have it
	const zustandValue = useOpencodeStore(
		(state) => state.directories[directory]?.compaction[sessionId],
	)

	// Prefer World Stream, fallback to Zustand
	// Map Core type to Store type if needed
	if (worldValue !== undefined) {
		return {
			isCompacting: worldValue.isCompacting,
			isAutomatic: worldValue.isAutomatic,
			startedAt: worldValue.startedAt ?? 0,
			messageId: worldValue.messageId,
			progress:
				worldValue.progress === undefined || worldValue.progress === 100
					? "complete"
					: worldValue.progress === 0
						? "pending"
						: "generating",
		}
	}

	// Log fallback for debugging (remove in Phase 5)
	if (zustandValue !== undefined) {
		console.debug("[useCompactionState] Falling back to Zustand for", sessionId)
	}

	return zustandValue ?? DEFAULT_COMPACTION_STATE
}
