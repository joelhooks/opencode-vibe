/**
 * delegation-helpers - Non-hook helpers for World Stream value normalization
 *
 * These helpers normalize World Stream values for use in:
 * - Provider-based hooks (use-context-usage.ts, etc.)
 * - Provider-free factory (factory.ts)
 *
 * Pattern: World Stream is the single source of truth.
 */

import type { ContextUsage, CompactionState, SessionStatus } from "../store/types"

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
 * Default compaction state when no compaction is active
 */
const DEFAULT_COMPACTION_STATE: CompactionState = {
	isCompacting: false,
	isAutomatic: false,
	progress: "complete",
	startedAt: 0,
}

/**
 * Get context usage from World Stream
 *
 * @param worldValue - World Stream value (from useWorldContextUsage)
 * @returns Context usage state
 */
export function getContextUsage(worldValue: ContextUsage | undefined): ContextUsage {
	return worldValue ?? DEFAULT_CONTEXT_USAGE
}

/**
 * Get compaction state from World Stream
 *
 * @param worldValue - World Stream value (from useWorldCompactionState)
 * @returns Compaction state
 */
export function getCompactionState(
	worldValue:
		| {
				isCompacting: boolean
				isAutomatic: boolean
				startedAt?: number
				messageId?: string
				progress?: number
		  }
		| undefined,
): CompactionState {
	// Map Core type to Store type if World Stream has data
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

	return DEFAULT_COMPACTION_STATE
}

/**
 * Get session status from World Stream
 *
 * @param worldValue - World Stream value (from useWorldSessionStatus)
 * @returns Session status
 */
export function getSessionStatus(worldValue: SessionStatus | undefined): SessionStatus {
	return worldValue ?? "completed"
}
