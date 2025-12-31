/**
 * useMessages - Store selector for messages with real-time SSE updates
 *
 * Selects messages from Zustand store populated by SSE events.
 * Returns empty array if session has no messages (avoids undefined issues).
 *
 * @example
 * ```tsx
 * function MessageList({ sessionId }: { sessionId: string }) {
 *   const messages = useMessages(sessionId)
 *
 *   return (
 *     <ul>
 *       {messages.map(m => <li key={m.id}>{m.role}: {m.id}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 */

"use client"

import type { Message } from "@opencode-vibe/core/types"
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"

const EMPTY_MESSAGES: Message[] = []

/**
 * Hook to get messages for a session from store
 *
 * @param sessionId - Session ID to fetch messages for
 * @returns Array of messages, sorted by ID (empty array if none)
 */
export function useMessages(sessionId: string): Message[] {
	const { directory } = useOpencode()
	return useOpencodeStore(
		(state) => state.directories[directory]?.messages[sessionId] ?? EMPTY_MESSAGES,
	)
}
