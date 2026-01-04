/**
 * useSessionList - Get sessions from World Stream
 *
 * Delegates to World Stream for sessions array.
 * No local state, no loading/error - just a selector.
 *
 * @example
 * ```tsx
 * function SessionList() {
 *   const sessions = useSessionList()
 *
 *   return (
 *     <ul>
 *       {sessions.map(s => <li key={s.id}>{s.title}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 */

"use client"

import type { Session } from "../store/types"
import { useWorldSessionList } from "./use-world-session-list.js"

/**
 * Hook to get all sessions
 *
 * MIGRATION NOTE (ADR-018 - Zustand Elimination):
 * This hook now delegates to World Stream via useWorldSessionList.
 * EnrichedSession extends Session, so the return type is compatible.
 *
 * Session list updates automatically via World Stream.
 *
 * @returns Array of sessions
 */
export function useSessionList(): Session[] {
	// Delegate to World Stream
	// EnrichedSession[] is compatible with Session[] (extends)
	return useWorldSessionList()
}
