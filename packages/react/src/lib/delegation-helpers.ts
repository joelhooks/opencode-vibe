/**
 * delegation-helpers - Non-hook helpers for World Stream → Zustand delegation
 *
 * These helpers extract the delegation logic so it can be shared between:
 * - Provider-based hooks (use-context-usage.ts, etc.)
 * - Provider-free factory (factory.ts)
 *
 * Pattern: Try World Stream first, fall back to Zustand, return default if neither exists.
 */

import type { ContextUsage, CompactionState, SessionStatus, DirectoryState } from "../store/types"

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
 * Get context usage with World Stream → Zustand delegation
 *
 * @param worldValue - World Stream value (from useWorldContextUsage or undefined)
 * @param store - Zustand store state (directories object)
 * @param sessionId - Session ID
 * @param directory - Directory path
 * @returns Context usage state
 */
export function getContextUsage(
	worldValue: ContextUsage | undefined,
	store: { directories: Record<string, DirectoryState> },
	sessionId: string,
	directory: string,
): ContextUsage {
	// Try World Stream first
	if (worldValue !== undefined) {
		return worldValue
	}

	// Fallback to Zustand
	const zustandValue = store.directories[directory]?.contextUsage[sessionId]

	if (zustandValue !== undefined) {
		console.debug("[getContextUsage] Falling back to Zustand for", sessionId)
		return zustandValue
	}

	return DEFAULT_CONTEXT_USAGE
}

/**
 * Get compaction state with World Stream → Zustand delegation
 *
 * @param worldValue - World Stream value (from useWorldCompactionState or undefined)
 * @param store - Zustand store state (directories object)
 * @param sessionId - Session ID
 * @param directory - Directory path
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
	store: { directories: Record<string, DirectoryState> },
	sessionId: string,
	directory: string,
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

	// Fallback to Zustand
	const zustandValue = store.directories[directory]?.compaction[sessionId]

	if (zustandValue !== undefined) {
		console.debug("[getCompactionState] Falling back to Zustand for", sessionId)
		return zustandValue
	}

	return DEFAULT_COMPACTION_STATE
}

/**
 * Get session status with World Stream → Zustand delegation
 *
 * @param worldValue - World Stream value (from useWorldSessionStatus or undefined)
 * @param store - Zustand store state (directories object)
 * @param sessionId - Session ID
 * @param directory - Directory path
 * @returns Session status
 */
export function getSessionStatus(
	worldValue: SessionStatus | undefined,
	store: { directories: Record<string, DirectoryState> },
	sessionId: string,
	directory: string,
): SessionStatus {
	// Try World Stream first
	if (worldValue !== undefined) {
		return worldValue
	}

	// Fallback to Zustand
	const zustandValue = store.directories[directory]?.sessionStatus[sessionId]

	if (zustandValue !== undefined) {
		console.debug("[getSessionStatus] Falling back to Zustand for", sessionId)
		return zustandValue
	}

	return "completed"
}
