/**
 * useParts - Get parts for a message from World Stream
 *
 * Finds the message in World Stream and returns its parts.
 * Returns empty array if message has no parts (avoids undefined issues).
 *
 * MIGRATION NOTE (ADR-018 - Zustand Elimination):
 * This hook now delegates to World Stream. EnrichedMessage already includes parts,
 * so we just need to find the message and return its parts property.
 *
 * @example
 * ```tsx
 * function PartList({ messageId }: { messageId: string }) {
 *   const parts = useParts(messageId)
 *
 *   return (
 *     <ul>
 *       {parts.map(p => <li key={p.id}>{p.type}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import type { Part } from "@opencode-vibe/core/types"
import { useWorld } from "../use-world.js"

const EMPTY_PARTS: Part[] = []

/**
 * Hook to get parts for a message from World Stream
 *
 * @param messageId - Message ID to fetch parts for
 * @returns Array of parts (empty array if message not found)
 */
export function useParts(messageId: string): Part[] {
	const world = useWorld()

	return useMemo(() => {
		// Find the message in all sessions
		for (const session of world.sessions) {
			const message = session.messages.find((m) => m.id === messageId)
			if (message) {
				return message.parts ?? EMPTY_PARTS
			}
		}
		return EMPTY_PARTS
	}, [world.sessions, messageId])
}
