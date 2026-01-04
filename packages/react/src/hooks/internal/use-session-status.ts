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
import { getSessionStatus as getSessionStatusHelper } from "../../lib/delegation-helpers"

/**
 * Hook to get session status
 *
 * Delegates to World Stream first, falls back to Zustand if undefined.
 * This enables gradual migration from Zustand to World Stream.
 *
 * Uses shared delegation helper for DRY with factory.
 *
 * @param sessionId - Session ID to check status for
 * @returns Session status ("pending" | "running" | "completed" | "error")
 */
export function useSessionStatus(sessionId: string): SessionStatus {
	const { directory } = useOpencode()

	// Try World Stream first
	const worldValue = useWorldSessionStatus(sessionId)

	// Get full store state (needed by helper)
	const store = useOpencodeStore()

	// Use shared delegation helper
	return getSessionStatusHelper(worldValue, store, sessionId, directory)
}
