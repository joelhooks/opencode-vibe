/**
 * useContextUsage - Store selector for session context usage
 *
 * Selects context usage from Zustand store populated by message.updated SSE events.
 * Returns default state if session has no context usage tracked yet.
 *
 * @example
 * ```tsx
 * function ContextIndicator({ sessionId }: { sessionId: string }) {
 *   const { percentage, isNearLimit } = useContextUsage(sessionId)
 *
 *   return (
 *     <div className={isNearLimit ? "text-red-500" : ""}>
 *       {percentage.toFixed(0)}%
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import type { ContextUsage } from "../../store/types"
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"

/**
 * Default context usage state when no data exists yet
 */
const DEFAULT_CONTEXT_USAGE: ContextUsage = {
	used: 0,
	limit: 200000,
	percentage: 0,
	isNearLimit: false,
	tokens: {
		input: 0,
		output: 0,
		cached: 0,
	},
	lastUpdated: 0,
}

/**
 * Hook to get context usage for a session from store
 *
 * @param sessionId - Session ID to get context usage for
 * @returns Context usage state with token counts, limit, percentage
 */
export function useContextUsage(sessionId: string): ContextUsage {
	const { directory } = useOpencode()
	return useOpencodeStore(
		(state) => state.directories[directory]?.contextUsage[sessionId] ?? DEFAULT_CONTEXT_USAGE,
	)
}

/**
 * Format token count with K/M suffix
 *
 * @param n - Token count
 * @returns Formatted string (e.g., "1.5K", "2.3M")
 */
export function formatTokens(n: number): string {
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
	return n.toString()
}
