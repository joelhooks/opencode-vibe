/**
 * useSessionStatus - Internal hook with World Stream delegation
 *
 * Delegates to World Stream for session status.
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
import { useWorldSessionStatus } from "../use-world-session-status.js"

/**
 * Hook to get session status
 *
 * Delegates to World Stream - the single source of truth.
 *
 * @param sessionId - Session ID to check status for
 * @returns Session status ("pending" | "running" | "completed" | "error")
 */
export function useSessionStatus(sessionId: string): SessionStatus {
	return useWorldSessionStatus(sessionId)
}
