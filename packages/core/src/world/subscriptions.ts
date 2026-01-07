/**
 * Subscriptions - ADR-019 Phase 2: SessionAtom Tier
 *
 * Subscription APIs for per-session atoms.
 * Provides convenient subscription functions that handle SessionAtom creation and cleanup.
 */

import { Registry } from "@effect-atom/atom"
import type { EnrichedSession } from "./types.js"
import { getOrCreateSessionAtom } from "./session-atom.js"

/**
 * Subscribe to enriched session updates
 *
 * Gets or creates a SessionAtom for the given session ID and subscribes to its
 * enrichedSessionAtom. The callback receives EnrichedSession updates whenever
 * the session data changes.
 *
 * @param sessionId - Unique session identifier
 * @param callback - Called with EnrichedSession on updates
 * @param registry - Optional registry (uses default if not provided)
 * @returns Unsubscribe function to stop receiving updates
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribeSession("session-123", (enriched) => {
 *   console.log(enriched.title, enriched.messages.length)
 * })
 *
 * // Later, stop listening
 * unsubscribe()
 * ```
 */
export function subscribeSession(
	sessionId: string,
	callback: (enrichedSession: EnrichedSession) => void,
	registry?: Registry.Registry,
): () => void {
	// Get or create SessionAtom for this session
	const sessionAtom = getOrCreateSessionAtom(sessionId)

	// Use provided registry or create a default one
	const reg = registry ?? Registry.make()

	// Subscribe to enrichedSessionAtom
	const unsubscribe = reg.subscribe(sessionAtom.enrichedSessionAtom, callback)

	// Call callback immediately with current enriched state
	// This ensures subscribers get the initial value
	const currentEnriched = reg.get(sessionAtom.enrichedSessionAtom)
	callback(currentEnriched)

	return unsubscribe
}
