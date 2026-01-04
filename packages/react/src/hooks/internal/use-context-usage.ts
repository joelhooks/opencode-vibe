/**
 * useContextUsage - Internal hook with World Stream delegation
 *
 * Delegates to World Stream for context usage data.
 * Returns default state if no data exists.
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

import { formatTokens } from "@opencode-vibe/core/utils"
import type { ContextUsage } from "../../store/types"
import { useWorldContextUsage } from "../use-world-context-usage.js"

/**
 * Hook to get context usage for a session
 *
 * Delegates to World Stream - the single source of truth.
 *
 * @param sessionId - Session ID to get context usage for
 * @returns Context usage state with token counts, limit, percentage
 */
export function useContextUsage(sessionId: string): ContextUsage {
	return useWorldContextUsage(sessionId)
}

// Re-export formatTokens from Core for backwards compatibility
export { formatTokens }
