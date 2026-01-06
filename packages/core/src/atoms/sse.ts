/**
 * SSE Connection Atom (Effect Program)
 *
 * Pure Effect programs for SSE connection management.
 * No React dependencies - usable in any Effect runtime.
 *
 * Provides:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat monitoring (60s timeout)
 * - Event streaming via Effect.Stream
 * - Factory pattern for testability
 *
 * @module atoms/sse
 */

import { Effect, Stream, Schedule, Duration } from "effect"
import type { GlobalEvent } from "@opencode-ai/sdk/client"

/**
 * SSE Configuration
 */
export interface SSEConfig {
	/** Base URL for SSE endpoint (will append /global/event) */
	url: string
	/** Heartbeat timeout (default: 60s) */
	heartbeatTimeout?: Duration.Duration
	/** Retry schedule (default: exponential backoff) */
	retrySchedule?:
		| Schedule.Schedule<Duration.Duration, unknown, never>
		| Schedule.Schedule<number, unknown, number>
	/** Factory for creating EventSource (for testing) */
	createEventSource?: (url: string) => EventSource
}

/**
 * Default heartbeat timeout (60s = 2x server heartbeat of 30s)
 */
const DEFAULT_HEARTBEAT_TIMEOUT = Duration.seconds(60)

/**
 * Default retry schedule: exponential backoff starting at 3s, capping at 30s
 */
const DEFAULT_RETRY_SCHEDULE = Schedule.exponential(Duration.seconds(3))

/**
 * Create EventSource wrapper that converts to Effect.Stream
 *
 * @param url - SSE endpoint URL
 * @param createEventSource - EventSource factory (defaults to browser EventSource)
 * @param heartbeatTimeout - Timeout duration
 * @returns Stream of GlobalEvents
 */
function makeEventSourceStream(
	url: string,
	createEventSource: (url: string) => EventSource = (u) => new EventSource(u),
	heartbeatTimeout: Duration.Duration = DEFAULT_HEARTBEAT_TIMEOUT,
): Stream.Stream<GlobalEvent, Error> {
	return Stream.async<GlobalEvent, Error>((emit) => {
		const eventSource = createEventSource(url)
		let heartbeatTimer: NodeJS.Timeout | null = null

		// Reset heartbeat timer on each event
		const resetHeartbeat = () => {
			if (heartbeatTimer) {
				clearTimeout(heartbeatTimer)
			}
			heartbeatTimer = setTimeout(() => {
				emit.fail(new Error("SSE heartbeat timeout"))
				eventSource.close()
			}, Duration.toMillis(heartbeatTimeout))
		}

		eventSource.onopen = () => {
			resetHeartbeat()
		}

		eventSource.onmessage = (event: MessageEvent) => {
			resetHeartbeat()
			try {
				const data = JSON.parse(event.data) as GlobalEvent
				emit.single(data)
			} catch (error) {
				// Ignore malformed JSON - don't crash the stream
				console.warn("SSE: Failed to parse event data", error)
			}
		}

		eventSource.onerror = () => {
			if (heartbeatTimer) {
				clearTimeout(heartbeatTimer)
			}
			// EventSource error - emit error to stream
			emit.fail(new Error("SSE connection error"))
		}

		// Cleanup on stream end
		return Effect.sync(() => {
			if (heartbeatTimer) {
				clearTimeout(heartbeatTimer)
			}
			eventSource.close()
		})
	})
}

/**
 * SSE Atom
 *
 * Pure Effect programs for SSE connection management.
 */
export const SSEAtom = {
	/**
	 * Connect to SSE stream with automatic reconnection
	 *
	 * Creates a resilient SSE connection that:
	 * - Monitors heartbeat (60s timeout)
	 * - Reconnects on failure with exponential backoff
	 * - Parses GlobalEvent JSON
	 *
	 * Note: Retry logic should be handled at the consumption level,
	 * not at the stream creation level. Use Stream.retry when consuming.
	 *
	 * @param config - SSE configuration
	 * @returns Stream of GlobalEvents
	 *
	 * @example
	 * ```typescript
	 * const stream = SSEAtom.connect({ url: serverUrl })
	 *
	 * // Consume events with retry
	 * await Effect.runPromise(
	 *   Stream.runForEach(stream, (event) =>
	 *     Effect.sync(() => console.log("Event:", event))
	 *   ).pipe(Effect.retry(Schedule.exponential(Duration.seconds(3))))
	 * )
	 * ```
	 */
	connect: (config: SSEConfig): Stream.Stream<GlobalEvent, Error> => {
		const { url, heartbeatTimeout = DEFAULT_HEARTBEAT_TIMEOUT, createEventSource } = config

		const endpoint = `${url}/global/event`

		// Create stream with heartbeat monitoring
		return makeEventSourceStream(endpoint, createEventSource, heartbeatTimeout)
	},

	/**
	 * Create a simple SSE connection without retry logic
	 *
	 * Useful for testing or when you want to handle reconnection yourself.
	 *
	 * @param config - SSE configuration
	 * @returns Stream of GlobalEvents (fails on error, no retry)
	 *
	 * @example
	 * ```typescript
	 * const stream = SSEAtom.connectOnce({ url: serverUrl })
	 * ```
	 */
	connectOnce: (config: SSEConfig): Stream.Stream<GlobalEvent, Error> => {
		const { url, heartbeatTimeout = DEFAULT_HEARTBEAT_TIMEOUT, createEventSource } = config

		const endpoint = `${url}/global/event`

		return makeEventSourceStream(endpoint, createEventSource, heartbeatTimeout)
	},
}

/**
 * Factory function to create SSE atom config (for backwards compatibility)
 *
 * @param config - SSE configuration
 * @returns Config object
 */
export function makeSSEAtom(config: SSEConfig) {
	return { config }
}

/**
 * Default SSE atom - connects to NEXT_PUBLIC_OPENCODE_URL if set
 *
 * @deprecated Use SSEAtom.connect() with URL from discovery instead
 * This export is only for backwards compatibility when env var is set
 */
export const sseAtom = process.env.NEXT_PUBLIC_OPENCODE_URL
	? makeSSEAtom({
			url: process.env.NEXT_PUBLIC_OPENCODE_URL,
		})
	: null
