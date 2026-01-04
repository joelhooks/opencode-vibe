/**
 * useWorldSessionList - Get all sessions from World Stream
 *
 * Derives from useWorld() - no additional subscriptions needed.
 * Returns all sessions from world state.
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
 * function SessionList() {
 *   const sessions = useWorldSessionList()
 *
 *   return (
 *     <ul>
 *       {sessions.map(s => (
 *         <li key={s.id}>{s.title}</li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */

"use client"

import { useWorld } from "./use-world.js"
// Import from specific file to avoid barrel file pulling in Node.js-only deps
import type { EnrichedSession } from "@opencode-vibe/core/world/types"

/**
 * useWorldSessionList - Get all sessions
 *
 * Returns world.sessions array directly.
 * Sessions are already enriched with status, messages, context usage, etc.
 *
 * @returns EnrichedSession[] - All sessions from world state
 */
export function useWorldSessionList(): EnrichedSession[] {
	const world = useWorld()
	return world.sessions
}
