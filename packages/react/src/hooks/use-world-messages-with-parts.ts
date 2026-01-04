/**
 * useWorldMessagesWithParts - Get messages with parts from World Stream
 *
 * Derives from useWorld() - no additional subscriptions needed.
 * Returns empty array if session not found.
 *
 * This replaces the Zustand-based useMessagesWithParts hook by delegating
 * to World Stream which already enriches messages with their parts.
 *
 * ARCHITECTURE (ADR-016, ADR-018):
 * - Core owns computation (WorldStore, derived state)
 * - React binds UI (useSyncExternalStore via useWorld)
 * - Derived hooks just select from useWorld()
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world (for types)
 * - Import useWorld from ./use-world.js
 *
 * @example
 * ```tsx
 * function MessageList({ sessionId }: { sessionId: string }) {
 *   const messages = useWorldMessagesWithParts(sessionId)
 *
 *   return (
 *     <div>
 *       {messages.map(msg => (
 *         <div key={msg.id}>
 *           <p>{msg.role}</p>
 *           {msg.parts.map(p => <Part key={p.id} {...p} />)}
 *         </div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import { useWorld } from "./use-world.js"
// Import from specific file to avoid barrel file pulling in Node.js-only deps
import type { EnrichedMessage } from "@opencode-vibe/core/world/types"

/**
 * useWorldMessagesWithParts - Get enriched messages with parts for a session
 *
 * Derives messages from useWorld().sessions by finding the session
 * and returning its messages array (which already includes parts).
 * Returns empty array if session not found.
 *
 * Uses useMemo to prevent unnecessary re-renders when world.sessions
 * reference changes but the actual messages for this sessionId haven't changed.
 *
 * @param sessionId - The session ID to get messages for
 * @returns EnrichedMessage[] - Messages with parts, or empty array if not found
 */
export function useWorldMessagesWithParts(sessionId: string): EnrichedMessage[] {
	const world = useWorld()

	return useMemo(() => {
		const session = world.sessions.find((s) => s.id === sessionId)
		return session?.messages ?? []
	}, [world.sessions, sessionId])
}
