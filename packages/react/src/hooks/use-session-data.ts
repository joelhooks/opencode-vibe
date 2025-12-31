/**
 * useSessionData - Get session from Zustand store
 *
 * Returns session data from the store (updated via SSE).
 * No local state, no loading/error - just a selector.
 *
 * @example
 * ```tsx
 * function SessionView({ sessionId }: { sessionId: string }) {
 *   const session = useSessionData(sessionId)
 *
 *   if (!session) return <div>Session not found</div>
 *
 *   return <div>{session.title}</div>
 * }
 * ```
 */

"use client"

import type { Session } from "../store/types"
import { useOpencodeStore } from "../store"
import { useOpencode } from "../providers"

/**
 * Hook to get a single session from the store
 *
 * Returns undefined if session not found or archived.
 * Session data updates automatically via SSE events.
 *
 * @param sessionId - Session ID to retrieve
 * @returns Session or undefined
 */
export function useSessionData(sessionId: string): Session | undefined {
	const { directory } = useOpencode()

	return useOpencodeStore((state) => {
		const sessions = state.directories[directory]?.sessions
		if (!sessions) return undefined

		const session = sessions.find((s) => s.id === sessionId)

		// Filter out archived sessions
		if (session?.time?.archived) {
			return undefined
		}

		return session
	})
}
