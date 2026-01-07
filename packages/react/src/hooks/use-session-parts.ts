/**
 * useSessionParts - Convenience hook for accessing parts array
 *
 * Thin wrapper around useSessionAtom that returns just the parts array.
 * Useful for components that only need parts, not the full enriched session.
 *
 * ARCHITECTURE (ADR-019 Phase 3):
 * - Delegates to useSessionAtom (useSession from use-session.ts)
 * - Returns Part[] instead of EnrichedSession
 * - Handles null/undefined gracefully (returns empty array)
 *
 * USAGE:
 * - For components rendering parts list
 * - When you don't need messages, status, or other session fields
 * - Cleaner API than destructuring: `const parts = useSessionParts(id)`
 *
 * @example
 * ```tsx
 * function PartsList({ sessionId }: { sessionId: string }) {
 *   const parts = useSessionParts(sessionId)
 *
 *   return (
 *     <div>
 *       {parts.map(part => (
 *         <PartItem key={part.id} part={part} />
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useSession } from "./use-session"
import type { Part } from "@opencode-vibe/core/types"

/**
 * useSessionParts - Subscribe to a session's parts array
 *
 * Returns flattened parts array from all messages in the enriched session.
 * Returns empty array if sessionId is null/undefined or if session has no messages.
 *
 * @param sessionId - Session ID to subscribe to (null/undefined returns empty array)
 * @returns Part[] array that updates when the session's parts change
 */
export function useSessionParts(sessionId: string | null | undefined): Part[] {
	const enrichedSession = useSession(sessionId)

	// Flatten all parts from all messages
	return enrichedSession.messages.flatMap((message) => message.parts) as Part[]
}
