/**
 * useSessionData - Get session from World Stream
 *
 * Delegates to World Stream for session data.
 * Returns undefined if session not found or archived.
 *
 * @example
 * ```tsx
 * function SessionView({ sessionId }: { sessionId: string }) {
 *   const session = useSessionData(sessionId)
 *
 *   if (!session) return <div>Session not found</div>
 *
 *   return <div>{session.title}</div>
 * }
 * ```
 */

"use client"

import type { Session } from "../store/types"
import { useWorldSession } from "./use-world-session.js"

/**
 * Hook to get a single session
 *
 * MIGRATION NOTE (ADR-018 - Zustand Elimination):
 * This hook now delegates to World Stream via useWorldSession.
 * EnrichedSession extends Session, so the return type is compatible.
 *
 * Returns undefined if session not found.
 * Session data updates automatically via World Stream.
 *
 * @param sessionId - Session ID to retrieve
 * @returns Session or undefined
 */
export function useSessionData(sessionId: string): Session | undefined {
	// Delegate to World Stream
	// EnrichedSession extends Session, so this is type-safe
	return useWorldSession(sessionId)
}
