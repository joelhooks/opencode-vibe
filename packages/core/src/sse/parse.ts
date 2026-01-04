/**
 * SSE Event Parser
 *
 * Parse at boundary, types flow everywhere.
 * Uses Effect Schema for runtime validation + type narrowing.
 */

import { Schema, Either } from "effect"
import { SSEEvent } from "./schemas.js"

/**
 * Parse unknown data into SSEEvent
 *
 * Returns Either.Right(event) on success, Either.Left(error) on failure.
 *
 * @example
 * ```typescript
 * const result = parseSSEEvent(rawEvent)
 * if (Either.isRight(result)) {
 *   const event = result.right
 *   // event.type is narrowed based on discriminant
 * }
 * ```
 */
export const parseSSEEvent = Schema.decodeUnknownEither(SSEEvent)

/**
 * Parse unknown data into SSEEvent (throws on failure)
 *
 * Useful for contexts where errors should propagate (tests, Effect programs).
 *
 * @example
 * ```typescript
 * const event = parseSSEEventSync(rawEvent)
 * // Throws ParseError if invalid
 * ```
 */
export const parseSSEEventSync = Schema.decodeUnknownSync(SSEEvent)
