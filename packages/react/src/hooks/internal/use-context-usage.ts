/**
 * useContextUsage - Internal hook with World Stream delegation
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * Returns default state if no data exists in either source.
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
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"
import { useWorldContextUsage } from "../use-world-context-usage.js"
import { getContextUsage as getContextUsageHelper } from "../../lib/delegation-helpers"

/**
 * Hook to get context usage for a session
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * This enables gradual migration from Zustand to World Stream.
 *
 * Uses shared delegation helper for DRY with factory.
 *
 * @param sessionId - Session ID to get context usage for
 * @returns Context usage state with token counts, limit, percentage
 */
export function useContextUsage(sessionId: string): ContextUsage {
	const { directory } = useOpencode()

	// Try World Stream first
	const worldValue = useWorldContextUsage(sessionId)

	// Get full store state (needed by helper)
	const store = useOpencodeStore()

	// Use shared delegation helper
	return getContextUsageHelper(worldValue, store, sessionId, directory)
}

// Re-export formatTokens from Core for backwards compatibility
export { formatTokens }
