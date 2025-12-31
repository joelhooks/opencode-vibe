/**
 * useSessionStatus - Store selector for session status
 *
 * Selects session status from Zustand store populated by SSE events.
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

/**
 * Hook to get session status from store
 *
 * @param sessionId - Session ID to check status for
 * @returns Session status ("pending" | "running" | "completed" | "error")
 */
export function useSessionStatus(sessionId: string): SessionStatus {
	const { directory } = useOpencode()
	return useOpencodeStore(
		(state) => state.directories[directory]?.sessionStatus[sessionId] ?? "completed",
	)
}
