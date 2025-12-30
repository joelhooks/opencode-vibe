/**
 * Messages API - Promise-based wrapper
 *
 * Promise-based API for message operations.
 * Wraps MessageAtom Effect programs with Effect.runPromise.
 *
 * @module api/messages
 */

import { Effect } from "effect"
import { MessageAtom } from "../atoms/messages.js"
import type { Message } from "../types/index.js"

/**
 * Message API namespace
 *
 * Promise-based wrappers around MessageAtom.
 */
export const messages = {
	/**
	 * Fetch all messages for a session
	 *
	 * @param sessionId - Session ID to fetch messages for
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Message array
	 *
	 * @example
	 * ```typescript
	 * const messages = await messages.list("session-123")
	 * console.log(messages.length)
	 * ```
	 */
	list: (sessionId: string, directory?: string): Promise<Message[]> =>
		Effect.runPromise(MessageAtom.list(sessionId, directory)),

	/**
	 * Fetch a single message by ID
	 *
	 * @param sessionId - Session ID containing the message
	 * @param messageId - Message ID
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Message or null
	 *
	 * @example
	 * ```typescript
	 * const message = await messages.get("session-123", "msg-456")
	 * if (message) {
	 *   console.log(message.role, message.id)
	 * }
	 * ```
	 */
	get: (sessionId: string, messageId: string, directory?: string): Promise<Message | null> =>
		Effect.runPromise(MessageAtom.get(sessionId, messageId, directory)),
}

// Export types for consumers
export type { Message }
