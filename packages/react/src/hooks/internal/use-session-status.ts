/**
 * useSessionStatus - Internal hook with World Stream delegation
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * Status is updated in real-time via session.status SSE events.
 *
 * @example
 * ```tsx
 * function SessionIndicator({ sessionId }: { sessionId: string }) {
 *   const status = useSessionStatus(sessionId)
 *
 *   return <div>{status === "running" ? "Running" : "Idle"}</div>
 * }
 * ```
 */

"use client"

import type { SessionStatus } from "../../store/types"
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"
import { useWorldSessionStatus } from "../use-world-session-status.js"

/**
 * Hook to get session status
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * This enables gradual migration from Zustand to World Stream.
 *
 * @param sessionId - Session ID to check status for
 * @returns Session status ("pending" | "running" | "completed" | "error")
 */
export function useSessionStatus(sessionId: string): SessionStatus {
	const { directory } = useOpencode()

	// Try World Stream first
	const worldValue = useWorldSessionStatus(sessionId)

	// Fallback to Zustand if World Stream doesn't have it
	const zustandValue = useOpencodeStore(
		(state) => state.directories[directory]?.sessionStatus[sessionId],
	)

	// Prefer World Stream, fallback to Zustand
	if (worldValue !== undefined) {
		return worldValue
	}

	// Log fallback for debugging (remove in Phase 5)
	if (zustandValue !== undefined) {
		console.debug("[useSessionStatus] Falling back to Zustand for", sessionId)
	}

	return zustandValue ?? "completed"
}
