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
 * Hook to get context usage for a session
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * This enables gradual migration from Zustand to World Stream.
 *
 * @param sessionId - Session ID to get context usage for
 * @returns Context usage state with token counts, limit, percentage
 */
export function useContextUsage(sessionId: string): ContextUsage {
	const { directory } = useOpencode()

	// Try World Stream first
	const worldValue = useWorldContextUsage(sessionId)

	// Fallback to Zustand if World Stream doesn't have it
	const zustandValue = useOpencodeStore(
		(state) => state.directories[directory]?.contextUsage[sessionId],
	)

	// Prefer World Stream, fallback to Zustand
	if (worldValue !== undefined) {
		return worldValue
	}

	// Log fallback for debugging (remove in Phase 5)
	if (zustandValue !== undefined) {
		console.debug("[useContextUsage] Falling back to Zustand for", sessionId)
	}

	return zustandValue ?? DEFAULT_CONTEXT_USAGE
}

// Re-export formatTokens from Core for backwards compatibility
export { formatTokens }
