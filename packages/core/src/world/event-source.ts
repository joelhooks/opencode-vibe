/**
 * EventSource - Generic event source interface for World Stream
 *
 * Provides an extensible pattern for integrating multiple event sources
 * (SwarmDb, SSE, Git, etc.) into the reactive World Stream.
 *
 * Architecture:
 * - EventSource interface: generic contract for any event source
 * - SourceEvent: normalized event shape across all sources
 * - createSwarmDbSource(): First concrete implementation (Swarm coordination DB)
 *
 * Pattern from Hivemind (mem-dba88064f38c20fc):
 * - Effect Stream.async for polling sources
 * - Cursor-based pagination for durable streaming
 * - Schedule.spaced for polling intervals
 */

import { Effect, Stream, Schedule } from "effect"
import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import { existsSync } from "node:fs"

/**
 * Generic event source interface
 *
 * All event sources (SwarmDb, SSE, Git) implement this interface.
 */
export interface EventSource {
	/** Source identifier (e.g., "swarm-db", "sse", "git") */
	name: string

	/** Check if source is available/accessible */
	available: () => Effect.Effect<boolean>

	/** Stream of events from this source (may emit errors) */
	stream: () => Stream.Stream<SourceEvent, Error>
}

/**
 * Normalized event shape across all sources
 *
 * All sources emit this format for consumption by World Stream.
 */
export interface SourceEvent {
	/** Source identifier (matches EventSource.name) */
	source: string

	/** Event type (e.g., "worker.spawned", "session.created") */
	type: string

	/** Event payload (source-specific) */
	data: unknown

	/** Unix timestamp (milliseconds) */
	timestamp: number

	/** Optional sequence number for ordering */
	sequence?: number
}

/**
 * SwarmDb event row shape (from swarm.db events table)
 */
interface SwarmDbEvent {
	id: number
	type: string
	project_key: string
	timestamp: number
	sequence: number
	data: string
}

/**
 * Create SwarmDb event source
 *
 * Polls the events table in ~/.config/swarm-tools/swarm.db using cursor-based pagination.
 * Implements the EventSource interface for integration with World Stream.
 *
 * **Cursor Strategy**: Uses sequence number (AUTOINCREMENT id) for pagination.
 * Query: `SELECT * FROM events WHERE sequence > ? ORDER BY sequence`
 *
 * **Polling Behavior**: Polls at configured interval, emits only new events since last poll.
 * Initial poll happens immediately on stream subscription.
 *
 * **Error Handling**: Database errors are emitted to the stream but don't terminate it.
 * Allows recovery from transient failures (locked db, connection issues).
 *
 * @param dbPath - Absolute path to swarm.db (e.g., ~/.config/swarm-tools/swarm.db)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 500ms)
 *
 * @example
 * ```typescript
 * const source = createSwarmDbSource("~/.config/swarm-tools/swarm.db")
 *
 * // Check availability
 * const isAvailable = await Effect.runPromise(source.available())
 *
 * // Stream events
 * const events = source.stream()
 * await Stream.runForEach(events, (event) =>
 *   Effect.sync(() => console.log(event))
 * )
 * ```
 */
export function createSwarmDbSource(dbPath: string, pollIntervalMs = 500): EventSource {
	return {
		name: "swarm-db",

		/**
		 * Check if database file exists
		 */
		available: () =>
			Effect.sync(() => {
				return existsSync(dbPath)
			}),

		/**
		 * Stream events from database using cursor-based polling
		 *
		 * Pattern: Stream.async with Schedule.spaced for polling
		 * Query: SELECT * FROM events WHERE sequence > ? ORDER BY sequence
		 */
		stream: () => {
			return Stream.async<SourceEvent, Error>((emit) => {
				// Create database client
				const client: Client = createClient({
					url: `file:${dbPath}`,
				})

				// Track last seen sequence for cursor-based pagination
				let lastSequence = 0

				/**
				 * Polling function - queries new events and emits them
				 * Errors are emitted to stream but don't terminate polling
				 */
				const poll = async () => {
					try {
						// Query events after last sequence
						const result = await client.execute({
							sql: "SELECT * FROM events WHERE sequence > ? ORDER BY sequence",
							args: [lastSequence],
						})

						// Emit each event
						for (const row of result.rows) {
							const dbEvent = row as unknown as SwarmDbEvent

							// Parse JSON data (fallback to raw string if invalid JSON)
							let parsedData: unknown
							try {
								parsedData = JSON.parse(dbEvent.data)
							} catch (parseError) {
								// Invalid JSON - pass through as-is
								// This preserves data but signals parsing issue
								parsedData = dbEvent.data
							}

							// Emit normalized SourceEvent
							const sourceEvent: SourceEvent = {
								source: "swarm-db",
								type: dbEvent.type,
								data: parsedData,
								timestamp: dbEvent.timestamp,
								sequence: dbEvent.sequence,
							}

							emit.single(sourceEvent)

							// Update cursor
							lastSequence = dbEvent.sequence
						}
					} catch (error) {
						// Database error - emit to stream but continue polling
						// Allows recovery from transient failures (db locked, etc.)
						emit.fail(
							new Error(
								`SwarmDb poll failed: ${error instanceof Error ? error.message : String(error)}`,
							),
						)
					}
				}

				// Start polling interval
				const intervalId = setInterval(poll, pollIntervalMs)

				// Initial poll
				void poll()

				// Cleanup on stream end
				return Effect.sync(() => {
					clearInterval(intervalId)
					client.close()
				})
			})
		},
	}
}
