/**
 * useMessages - Get messages for a session from World Stream
 *
 * MIGRATED from Zustand to World Stream (vancouver-auto-detail-pro--frahg-mk2q6th1yn2)
 *
 * Derives from useWorld() - no additional subscriptions needed.
 * Returns empty array if session not found.
 *
 * ARCHITECTURE (ADR-016, ADR-018):
 * - Core owns computation (WorldStore, derived state)
 * - React binds UI (useSyncExternalStore via useWorld)
 * - Derived hooks just select from useWorld()
 *
 * BACKWARD COMPATIBILITY:
 * - Returns EnrichedMessage[] (superset of Message with parts, isStreaming)
 * - Always returns array (never undefined)
 * - Maintains same API as Zustand version
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world (for types)
 * - Import useWorld from ../use-world.js
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

import { useMemo } from "react"
import { useWorld } from "../use-world.js"
// Import from specific file to avoid barrel file pulling in Node.js-only deps
import type { EnrichedMessage } from "@opencode-vibe/core/world/types"

/**
 * useMessages - Get messages for a session
 *
 * Derives messages from useWorld().sessions by finding the session
 * and returning its messages array. Returns empty array if session not found.
 *
 * Uses useMemo to prevent unnecessary re-renders when world.sessions
 * reference changes but the actual messages for this sessionId haven't changed.
 *
 * @param sessionId - The session ID to get messages for
 * @returns EnrichedMessage[] - Messages for the session, or empty array if not found
 */
export function useMessages(sessionId: string): EnrichedMessage[] {
	const world = useWorld()

	return useMemo(() => {
		const session = world.sessions.find((s) => s.id === sessionId)
		return session?.messages ?? []
	}, [world.sessions, sessionId])
}
