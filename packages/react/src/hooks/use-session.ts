/**
 * useSession - React binding to SessionAtom subscription API
 *
 * Binds React to per-session atoms using useSyncExternalStore.
 * Subscribes to a single session's enriched state (session + messages + parts + status).
 *
 * ARCHITECTURE (ADR-019 Phase 2):
 * - Core owns SessionAtom (per-session reactive atoms)
 * - React binds UI (useSyncExternalStore)
 * - subscribeSession handles SessionAtom lifecycle
 *
 * USAGE:
 * - For single session detail views
 * - Granular subscription (only updates when THIS session changes)
 * - Handles null sessionId gracefully
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world
 * - NO Effect types
 * - NO direct Core imports
 *
 * @example
 * ```tsx
 * function SessionDetail({ sessionId }: { sessionId: string }) {
 *   const session = useSession(sessionId)
 *
 *   return (
 *     <div>
 *       <h2>{session.title}</h2>
 *       <p>Status: {session.status}</p>
 *       <p>Messages: {session.messages.length}</p>
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useSyncExternalStore } from "react"
import { subscribeSession } from "@opencode-vibe/core/world/subscriptions"
import type { EnrichedSession } from "@opencode-vibe/core/world/types"

/**
 * Empty session structure for null/undefined sessionId
 */
const emptySession: EnrichedSession = {
	id: "",
	title: "",
	directory: "",
	time: { created: 0, updated: 0 },
	status: "completed",
	isActive: false,
	messages: [],
	unreadCount: 0,
	contextUsagePercent: 0,
	lastActivityAt: 0,
}

/**
 * Per-sessionId cache for state
 * Maps sessionId → cached EnrichedSession
 */
const stateCache = new Map<string, EnrichedSession>()

/**
 * useSession - Subscribe to a single session's enriched state
 *
 * Returns EnrichedSession that updates when the session's data changes.
 * Uses useSyncExternalStore for React 18+ compatibility and SSR support.
 *
 * KEY INSIGHT from Hivemind (mem-48bb4bcedf1fc24c):
 * subscribeSession() calls callback immediately with current state.
 * This means we get the initial state synchronously in the subscribe callback,
 * which we cache for useSyncExternalStore's synchronous getSnapshot requirement.
 *
 * @param sessionId - Session ID to subscribe to (null/undefined returns empty session)
 * @returns EnrichedSession with session, messages, parts, and computed fields
 */
export function useSession(sessionId: string | null | undefined): EnrichedSession {
	// Handle null/undefined sessionId
	if (!sessionId) {
		return emptySession
	}

	// useSyncExternalStore requires synchronous getSnapshot
	// We cache state from subscribe callback (which fires immediately)
	const state = useSyncExternalStore(
		// subscribe: called once on mount, cleanup on unmount
		// called again if sessionId changes
		(callback) => {
			const unsubscribe = subscribeSession(sessionId, (enriched) => {
				// Cache state for synchronous getSnapshot
				stateCache.set(sessionId, enriched)
				// Notify React of state change
				callback()
			})
			return unsubscribe
		},
		// getSnapshot: called on every render, must be synchronous
		() => {
			// Return cached state (updated by subscribe callback)
			const cached = stateCache.get(sessionId) ?? emptySession
			return cached
		},
		// getServerSnapshot: for SSR, return empty session
		() => emptySession,
	)

	return state
}
