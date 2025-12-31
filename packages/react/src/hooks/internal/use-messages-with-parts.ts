/**
 * useMessagesWithParts - Store selector combining messages and parts
 *
 * Selects messages from store and joins them with their parts.
 * Returns messages with associated parts in a single data structure.
 *
 * Uses useMemo to avoid creating new object references on every render,
 * which would cause infinite loops with useSyncExternalStore.
 *
 * @example
 * ```tsx
 * function SessionView({ sessionId }: { sessionId: string }) {
 *   const messages = useMessagesWithParts(sessionId)
 *
 *   return (
 *     <div>
 *       {messages.map(msg => (
 *         <div key={msg.info.id}>
 *           <p>{msg.info.role}</p>
 *           {msg.parts.map(p => <span key={p.id}>{p.content}</span>)}
 *         </div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import type { Message, Part } from "@opencode-vibe/core/types"
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"

export interface OpencodeMessage {
	/** Message metadata */
	info: Message
	/** Parts associated with this message */
	parts: Part[]
}

const EMPTY_MESSAGES: OpencodeMessage[] = []
const EMPTY_PARTS: Part[] = []

/**
 * Hook to get messages with their associated parts from store
 *
 * @param sessionId - Session ID to fetch messages for
 * @returns Array of messages with parts (empty array if none)
 */
export function useMessagesWithParts(sessionId: string): OpencodeMessage[] {
	const { directory } = useOpencode()

	// Select raw data from store - these are stable references from Immer
	const messages = useOpencodeStore((state) => state.directories[directory]?.messages[sessionId])
	const partsMap = useOpencodeStore((state) => state.directories[directory]?.parts)

	// Derive the combined structure with useMemo to avoid infinite loops
	// Only recomputes when messages or partsMap references change
	return useMemo(() => {
		if (!messages) return EMPTY_MESSAGES

		return messages.map((message) => ({
			info: message,
			parts: partsMap?.[message.id] ?? EMPTY_PARTS,
		}))
	}, [messages, partsMap])
}
