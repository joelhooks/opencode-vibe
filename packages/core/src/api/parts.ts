/**
 * Parts API - Promise-based wrapper
 *
 * Promise-based API for message parts operations.
 * Wraps PartAtom Effect programs with Effect.runPromise.
 *
 * @module api/parts
 */

import { Effect } from "effect"
import { PartAtom } from "../atoms/parts.js"
import type { Part } from "../types/index.js"

/**
 * Part API namespace
 *
 * Promise-based wrappers around PartAtom.
 */
export const parts = {
	/**
	 * Fetch all parts for a session
	 *
	 * @param sessionId - Session ID to fetch parts for
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Part array
	 *
	 * @example
	 * ```typescript
	 * const parts = await parts.list("session-123")
	 * console.log(parts.length)
	 * ```
	 */
	list: (sessionId: string, directory?: string): Promise<Part[]> =>
		Effect.runPromise(PartAtom.list(sessionId, directory)),

	/**
	 * Fetch a single part by ID
	 *
	 * @param sessionId - Session ID containing the part
	 * @param partId - Part ID
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Part or null
	 *
	 * @example
	 * ```typescript
	 * const part = await parts.get("session-123", "part-456")
	 * if (part) {
	 *   console.log(part.type, part.content)
	 * }
	 * ```
	 */
	get: (sessionId: string, partId: string, directory?: string): Promise<Part | null> =>
		Effect.runPromise(PartAtom.get(sessionId, partId, directory)),
}

// Export types for consumers
export type { Part }
