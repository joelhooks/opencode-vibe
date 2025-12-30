/**
 * Sessions API - Promise-based wrapper
 *
 * Promise-based API for session operations.
 * Wraps SessionAtom Effect programs with Effect.runPromise.
 *
 * @module api/sessions
 */

import { Effect } from "effect"
import { SessionAtom } from "../atoms/sessions.js"
import type { Session } from "../types/index.js"

/**
 * Session API namespace
 *
 * Promise-based wrappers around SessionAtom.
 */
export const sessions = {
	/**
	 * Fetch all sessions for a directory
	 *
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Session array
	 *
	 * @example
	 * ```typescript
	 * const sessions = await sessions.list("/my/project")
	 * console.log(sessions.length)
	 * ```
	 */
	list: (directory?: string): Promise<Session[]> => Effect.runPromise(SessionAtom.list(directory)),

	/**
	 * Fetch a single session by ID
	 *
	 * @param id - Session ID
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Session or null
	 *
	 * @example
	 * ```typescript
	 * const session = await sessions.get("ses_123")
	 * if (session) {
	 *   console.log(session.title)
	 * }
	 * ```
	 */
	get: (id: string, directory?: string): Promise<Session | null> =>
		Effect.runPromise(SessionAtom.get(id, directory)),
}

// Export types for consumers
export type { Session }
