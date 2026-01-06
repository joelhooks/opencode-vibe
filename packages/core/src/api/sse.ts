/**
 * SSE API - Stream-based wrapper
 *
 * API for SSE connection management.
 * Re-exports SSEAtom which already provides the right abstraction.
 *
 * Note: SSEAtom.connect returns Effect.Stream, not Effect.Effect.
 * Consumers should use Stream.runForEach with retry for consumption.
 *
 * @module api/sse
 */

import { SSEAtom, type SSEConfig } from "../atoms/sse.js"
import type { GlobalEvent } from "@opencode-ai/sdk/client"
import type { Stream } from "effect"

/**
 * SSE API namespace
 *
 * Stream-based wrappers around SSEAtom.
 */
export const sse = {
	/**
	 * Connect to SSE stream with automatic reconnection
	 *
	 * @param config - SSE configuration
	 * @returns Stream of GlobalEvents
	 *
	 * @example
	 * ```typescript
	 * import { Effect, Stream, Schedule, Duration } from "effect"
	 * import { discovery } from "@opencode-vibe/core"
	 *
	 * // Get server URL from discovery service
	 * const servers = await discovery.discover()
	 * const url = servers[0]?.url // or use discovery.discoverOne()
	 *
	 * const stream = sse.connect({ url })
	 *
	 * await Effect.runPromise(
	 *   Stream.runForEach(stream, (event) =>
	 *     Effect.sync(() => console.log("Event:", event))
	 *   ).pipe(Effect.retry(Schedule.exponential(Duration.seconds(3))))
	 * )
	 * ```
	 */
	connect: (config: SSEConfig): Stream.Stream<GlobalEvent, Error> => SSEAtom.connect(config),

	/**
	 * Create a simple SSE connection without retry logic
	 *
	 * @param config - SSE configuration
	 * @returns Stream of GlobalEvents (fails on error, no retry)
	 */
	connectOnce: (config: SSEConfig): Stream.Stream<GlobalEvent, Error> =>
		SSEAtom.connectOnce(config),
}

// Export types for consumers
export type { SSEConfig, GlobalEvent }
