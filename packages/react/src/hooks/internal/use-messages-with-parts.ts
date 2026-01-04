/**
 * useMessagesWithParts - Internal hook with World Stream delegation
 *
 * Delegates to World Stream for messages with parts.
 * World Stream already enriches messages with their parts via EnrichedMessage.
 *
 * This hook maintains the OpencodeMessage interface for backward compatibility
 * while delegating to useWorldMessagesWithParts for the actual data.
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
import { useWorldMessagesWithParts } from "../use-world-messages-with-parts.js"

export interface OpencodeMessage {
	/** Message metadata */
	info: Message
	/** Parts associated with this message */
	parts: Part[]
}

/**
 * Hook to get messages with their associated parts
 *
 * MIGRATION NOTE (ADR-018 - Zustand Elimination):
 * This hook now delegates to World Stream via useWorldMessagesWithParts.
 * The OpencodeMessage interface is maintained for backward compatibility,
 * but the data source is now World Stream (not Zustand).
 *
 * @param sessionId - Session ID to fetch messages for
 * @returns Array of messages with parts (empty array if none)
 */
export function useMessagesWithParts(sessionId: string): OpencodeMessage[] {
	// Delegate to World Stream
	const enrichedMessages = useWorldMessagesWithParts(sessionId)

	// Transform EnrichedMessage to OpencodeMessage for backward compat
	// EnrichedMessage already has parts, we just need to reshape the interface
	return useMemo(() => {
		return enrichedMessages.map((msg) => ({
			info: msg, // EnrichedMessage extends Message, so this works
			parts: msg.parts,
		}))
	}, [enrichedMessages])
}
