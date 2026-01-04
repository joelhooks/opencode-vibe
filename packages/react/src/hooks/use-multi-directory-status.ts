/**
 * useMultiDirectoryStatus - Track session status across multiple directories
 *
 * Returns session status (running/completed) for all sessions across multiple directories.
 * Implements cooldown logic to keep "running" indicator lit for 1 minute after streaming ends.
 *
 * MIGRATION NOTE (opencode-next--xts0a-mjz41bm4b8w):
 * - Migrated from Zustand to World Stream
 * - Now uses useWorld() for reactive state
 * - Removed bootstrap logic (World Stream handles initial state)
 * - Kept cooldown logic for UX smoothness
 *
 * @example
 * ```tsx
 * const { sessionStatuses, lastActivity } = useMultiDirectoryStatus(["/project1", "/project2"])
 * // sessionStatuses = { "ses-123": "running", "ses-456": "completed" }
 * // lastActivity = { "ses-123": 1704067200000, ... }
 * ```
 */

"use client"

import { useEffect, useState, useRef, useMemo } from "react"
import { useWorld } from "./use-world"
import type { SessionStatus } from "@opencode-vibe/core/types"

/**
 * How long to keep "running" indicator lit after streaming ends
 *
 * **Why 1 minute?** Prevents UI flicker when AI streaming pauses briefly
 * between chunks. Without cooldown, the green dot would flash on/off rapidly
 * during normal streaming, creating a janky UX.
 *
 * **Tradeoff**: Indicator may stay green for up to 1 minute after session
 * actually completes. This is acceptable for better perceived smoothness.
 */
const IDLE_COOLDOWN_MS = 60_000 // 1 minute

export interface UseMultiDirectoryStatusReturn {
	/** Map of sessionId -> status */
	sessionStatuses: Record<string, SessionStatus>
	/** Map of sessionId -> last activity timestamp */
	lastActivity: Record<string, number>
}

/**
 * Hook to manage session statuses across multiple directories
 *
 * **Migrated to World Stream** (opencode-next--xts0a-mjz41bm4b8w):
 * - Uses useWorld() for reactive state (replaces Zustand subscription)
 * - World Stream provides computed status via EnrichedSession
 * - Removed bootstrap logic (World Stream handles initial state)
 *
 * **Cooldown logic**: When a session becomes idle (status = "completed"),
 * the green indicator stays lit for 1 minute before fading. This prevents
 * flickering when AI streaming pauses briefly between chunks.
 *
 * @param directories - Array of directory paths with sessions to track
 * @param initialSessions - DEPRECATED - no longer used (kept for backward compat)
 * @returns Object with sessionStatuses and lastActivity maps
 */
export function useMultiDirectoryStatus(
	directories: string[],
	initialSessions?: Record<string, Array<{ id: string; formattedTime: string }>>,
): UseMultiDirectoryStatusReturn {
	const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})
	const [lastActivity, setLastActivity] = useState<Record<string, number>>({})

	const cooldownTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

	// Cleanup all timers on unmount
	useEffect(() => {
		return () => {
			for (const timer of cooldownTimersRef.current.values()) {
				clearTimeout(timer)
			}
		}
	}, [])

	// Get world state
	const world = useWorld()

	// Filter sessions by requested directories
	const filteredSessions = useMemo(() => {
		const directorySet = new Set(directories)
		return world.sessions.filter((s) => directorySet.has(s.directory))
	}, [world.sessions, directories])

	/**
	 * Subscribe to session status changes from World Stream
	 *
	 * **Cooldown logic**:
	 * - When status = "running": Immediately set to "running", cancel any pending cooldown
	 * - When status = "completed": Start 1-minute cooldown timer, keep indicator green until timer expires
	 *
	 * MIGRATION NOTE (opencode-next--xts0a-mjz41bm4b8w):
	 * - Replaced Zustand subscription with World Stream
	 * - World Stream already provides computed status via EnrichedSession
	 * - Removed computeStatusSync call (Core handles this now)
	 */
	useEffect(() => {
		for (const session of filteredSessions) {
			const { id: sessionId, status: statusValue, lastActivityAt } = session

			// Debug log status changes
			const prevStatus = sessionStatuses[sessionId]
			if (prevStatus !== statusValue) {
				console.debug("[useMultiDirectoryStatus] status changed:", {
					sessionId,
					prevStatus,
					newStatus: statusValue,
					directory: session.directory,
				})
			}

			if (statusValue === "running") {
				// Cancel any pending cooldown
				const existingTimer = cooldownTimersRef.current.get(sessionId)
				if (existingTimer) {
					clearTimeout(existingTimer)
					cooldownTimersRef.current.delete(sessionId)
				}

				setSessionStatuses((prev) => ({
					...prev,
					[sessionId]: "running",
				}))
				setLastActivity((prev) => ({
					...prev,
					[sessionId]: lastActivityAt,
				}))
			} else if (statusValue === "completed") {
				// Update last activity
				setLastActivity((prev) => ({
					...prev,
					[sessionId]: lastActivityAt,
				}))

				// Start cooldown only if not already in cooldown
				if (!cooldownTimersRef.current.has(sessionId)) {
					const timer = setTimeout(() => {
						setSessionStatuses((prev) => ({
							...prev,
							[sessionId]: "completed",
						}))
						cooldownTimersRef.current.delete(sessionId)
					}, IDLE_COOLDOWN_MS)

					cooldownTimersRef.current.set(sessionId, timer)
				}
			}
		}
	}, [filteredSessions, sessionStatuses])

	return { sessionStatuses, lastActivity }
}
