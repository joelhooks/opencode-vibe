/**
 * useSessionMessages - Convenience hook for extracting just messages array
 *
 * Thin wrapper around useSessionAtom (useSession) that returns only the messages array.
 * Useful for components that only need to render messages and don't care about
 * session metadata, status, or parts.
 *
 * ARCHITECTURE (ADR-019 Phase 3):
 * - Delegates to useSession (useSessionAtom) for subscription
 * - Returns Message[] instead of EnrichedSession
 * - Handles null/undefined sessionId gracefully (returns [])
 *
 * USAGE:
 * - For message list views that don't need session metadata
 * - Simpler API when you only care about messages
 *
 * @example
 * ```tsx
 * function MessageList({ sessionId }: { sessionId: string }) {
 *   const messages = useSessionMessages(sessionId)
 *
 *   return (
 *     <ul>
 *       {messages.map(msg => (
 *         <li key={msg.id}>{msg.text}</li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */

"use client"

import { useSession } from "./use-session.js"
import type { EnrichedMessage } from "@opencode-vibe/core/world/types"

/**
 * useSessionMessages - Subscribe to a session's messages array
 *
 * Returns EnrichedMessage[] that updates when the session's messages change.
 * Delegates to useSession for subscription, extracts messages field.
 *
 * @param sessionId - Session ID to subscribe to (null/undefined returns empty array)
 * @returns EnrichedMessage[] array (empty if session not found or null sessionId)
 */
export function useSessionMessages(sessionId: string | null | undefined): EnrichedMessage[] {
	const enrichedSession = useSession(sessionId)
	return enrichedSession.messages
}
