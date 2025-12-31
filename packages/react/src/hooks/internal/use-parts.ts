/**
 * useParts - Store selector for message parts with real-time SSE updates
 *
 * Selects parts for a message from Zustand store populated by SSE events.
 * Returns empty array if message has no parts (avoids undefined issues).
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

import type { Part } from "@opencode-vibe/core/types"
import { useOpencodeStore } from "../../store"
import { useOpencode } from "../../providers"

const EMPTY_PARTS: Part[] = []

/**
 * Hook to get parts for a message from store
 *
 * @param messageId - Message ID to fetch parts for
 * @returns Array of parts, sorted by ID (empty array if none)
 */
export function useParts(messageId: string): Part[] {
	const { directory } = useOpencode()
	return useOpencodeStore((state) => state.directories[directory]?.parts[messageId] ?? EMPTY_PARTS)
}
