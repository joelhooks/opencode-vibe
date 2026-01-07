/**
 * Merged Stream - Combines multiple event sources into unified World Stream
 *
 * Extends the base World Stream to support pluggable event sources (SwarmDb, Git, etc.)
 * in addition to SSE. Uses Effect Stream.mergeAll to combine sources efficiently.
 *
 * Architecture:
 * - Checks source.available() before including in merge
 * - Filters out unavailable sources gracefully
 * - Uses Stream.mergeAll for concurrent event emission
 * - Maintains existing World Stream API (subscribe, getSnapshot, async iterator)
 *
 * Pattern from Hivemind (mem-dba88064f38c20fc):
 * - Stream.mergeAll for combining multiple streams
 * - Effect.all for parallel availability checks
 * - Graceful degradation when sources unavailable
 */

import { Effect, Stream, pipe, Scope, Exit, Duration } from "effect"
import type { EventSource, SourceEvent } from "./event-source.js"
import type { WorldStreamConfig, WorldStreamHandle, WorldState } from "./types.js"
import {
	Registry,
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	worldStateAtom,
	instancesAtom,
	connectionStatusAtom,
	projectsAtom,
} from "./atoms.js"
import { WorldSSE } from "./sse.js"
import type { Message, Part, Session } from "../types/domain.js"
import type { Layer } from "effect"
import type { Discovery } from "./discovery/index.js"

/**
 * Extended config for merged streams
 */
export interface MergedStreamConfig extends WorldStreamConfig {
	/**
	 * Additional event sources to merge with SSE
	 * Each source is checked for availability before inclusion
	 */
	sources?: EventSource[]
	/**
	 * Optional WorldSSE instance for dependency injection (testing)
	 * If not provided, creates a new WorldSSE instance
	 */
	sse?: WorldSSE
	/**
	 * Optional Registry for dependency injection (testing)
	 * If not provided, creates a new Registry
	 * Note: If both sse and registry are provided, sse should already be using this registry
	 */
	registry?: ReturnType<typeof Registry.make>
	/**
	 * Discovery Layer (default: empty implementation that returns [])
	 *
	 * Inject custom Discovery implementation for testing or Node.js environments.
	 * Node.js: DiscoveryNodeLive from @opencode-vibe/core/world/discovery/node (lsof process scanning)
	 * Testing: Use Layer.succeed(Discovery, { discover: () => Effect.succeed([...]) })
	 */
	discoveryLayer?: Layer.Layer<Discovery>
}

/**
 * Extended handle with stream() method for testing
 * Not part of public WorldStreamHandle API
 */
export interface MergedStreamHandle extends WorldStreamHandle {
	/**
	 * Get merged event stream (for testing)
	 * Internal use only - not part of public API
	 */
	stream(): Stream.Stream<SourceEvent, Error>
	/**
	 * Get the atom registry for external event routing
	 * Used by React layer to wire multiServerSSE events to event-router.ts
	 */
	getRegistry(): Registry.Registry
}

/**
 * Create a merged world stream that combines SSE with additional event sources
 *
 * Checks each source's availability and merges all available streams using
 * Stream.mergeAll. Unavailable sources are filtered out gracefully.
 *
 * @param config - Configuration including optional additional sources
 *
 * @example
 * ```typescript
 * import { createMergedWorldStream, createSwarmDbSource } from "@opencode-vibe/core/world"
 *
 * const swarmDb = createSwarmDbSource("~/.config/swarm-tools/swarm.db")
 *
 * const stream = createMergedWorldStream({
 *   baseUrl: "http://localhost:1999",
 *   sources: [swarmDb]
 * })
 *
 * // All events (SSE + SwarmDb) flow through unified stream
 * for await (const world of stream) {
 *   console.log(world.sessions)
 * }
 * ```
 */
export function createMergedWorldStream(config: MergedStreamConfig = {}): MergedStreamHandle {
	const {
		baseUrl,
		autoReconnect = true,
		onEvent,
		sources = [],
		sse: injectedSSE,
		registry: injectedRegistry,
		discoveryLayer,
		initialInstances,
	} = config

	// Use injected registry (for testing) or create a new one
	// Configure defaultIdleTTL based on environment:
	// - Server (SSR): undefined (no timers - atoms are short-lived per-request)
	// - Client: 5 minutes (cleanup idle atoms after inactivity)
	const registry =
		injectedRegistry ||
		Registry.make({
			defaultIdleTTL:
				typeof window === "undefined"
					? undefined // No TTL on server (no timers)
					: Duration.toMillis(Duration.minutes(5)), // 5 min on client
		})

	// CRITICAL: Mount worldStateAtom to keep it reactive
	// From Hivemind mem-f081811ec795ff2a: "Use r.mount() which keeps atoms alive while mounted"
	// Without mount, Registry.subscribe won't fire when dependent atoms (statusAtom, etc.) change
	const cleanupMount = registry.mount(worldStateAtom)

	// CRITICAL FIX: Populate instancesAtom from initialInstances (SSR discovery)
	// This bypasses client-side discovery and enables immediate SSE connections
	if (initialInstances && initialInstances.length > 0) {
		const instanceMap = new Map(initialInstances.map((i) => [i.port, i]))
		registry.set(instancesAtom, instanceMap)
	}

	// Use injected SSE instance (for testing) or create a new one
	const sse =
		injectedSSE ||
		new WorldSSE(registry, {
			serverUrl: baseUrl, // undefined = use discovery loop for all servers
			autoReconnect,
			onEvent,
			discoveryLayer,
			initialInstances, // Pass to WorldSSE for immediate connections
		})

	// Only start if we created it (injected SSE is controlled by test)
	if (!injectedSSE) {
		sse.start()
	}

	/**
	 * Create merged event stream from all available sources
	 *
	 * Checks availability and merges streams using Stream.mergeAll.
	 * Internal method for testing - not part of public WorldStreamHandle API.
	 */
	function stream(): Stream.Stream<SourceEvent, Error> {
		// Check availability for all sources in parallel
		// Catch both typed errors and defects (thrown exceptions)
		const availabilityChecks = sources.map((source) =>
			source.available().pipe(
				Effect.map((isAvailable) => ({ source, isAvailable })),
				// Catch defects first (thrown errors)
				Effect.catchAllDefect(() => Effect.succeed({ source, isAvailable: false })),
				// Then catch typed errors
				Effect.catchAll(() => Effect.succeed({ source, isAvailable: false })),
			),
		)

		return Stream.unwrap(
			Effect.gen(function* () {
				// Wait for all availability checks
				const results = yield* Effect.all(availabilityChecks, { concurrency: "unbounded" })

				// Filter to only available sources
				const availableSources = results.filter((r) => r.isAvailable).map((r) => r.source)

				// If no available sources, return empty stream
				if (availableSources.length === 0) {
					return Stream.empty
				}

				// Create streams from all available sources
				const streams = availableSources.map((source) => source.stream())

				// Merge all streams
				return Stream.mergeAll(streams, { concurrency: "unbounded" })
			}),
		)
	}

	/**
	 * Subscribe to world state changes
	 *
	 * Pattern: BehaviorSubject-like - fires immediately with current state,
	 * then on each change (like React useState).
	 *
	 * CRITICAL FIX: Subscribe to leaf atoms instead of derived worldStateAtom.
	 * Registry.subscribe on derived atoms doesn't fire when dependencies change.
	 * We must subscribe to each leaf atom and manually trigger callback with derived state.
	 */
	function subscribe(callback: (state: WorldState) => void): () => void {
		// Fire immediately with current state
		callback(registry.get(worldStateAtom))

		// Subscribe to ALL leaf atoms that worldStateAtom depends on
		// When any leaf atom changes, re-compute worldStateAtom and fire callback
		const unsubscribes = [
			registry.subscribe(sessionsAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
			registry.subscribe(messagesAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
			registry.subscribe(partsAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
			registry.subscribe(statusAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
			registry.subscribe(connectionStatusAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
			registry.subscribe(instancesAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
			registry.subscribe(projectsAtom, () => {
				callback(registry.get(worldStateAtom))
			}),
		]

		return () => unsubscribes.forEach((unsub) => unsub())
	}

	/**
	 * Get current world state snapshot
	 */
	async function getSnapshot(): Promise<WorldState> {
		return registry.get(worldStateAtom)
	}

	/**
	 * Async iterator for world state changes
	 *
	 * Uses Effect acquireRelease for guaranteed cleanup.
	 * Pattern from Hivemind (mem-fa2e52bd6e3f080b): acquireRelease ensures
	 * cleanup (unsubscribe) is called even on interruption/scope close.
	 */
	async function* asyncIterator(): AsyncIterableIterator<WorldState> {
		// Yield current state immediately
		yield registry.get(worldStateAtom)

		// Use Effect Scope + acquireRelease for subscription lifecycle
		// This guarantees unsubscribe is called even if iterator is abandoned mid-stream
		const scope = await Effect.runPromise(Scope.make())

		try {
			// Acquire subscription with guaranteed cleanup via acquireRelease
			const subscription = await Effect.runPromise(
				pipe(
					Effect.acquireRelease(
						// Acquire: subscribe to store and set up queue
						Effect.sync(() => {
							const queue: WorldState[] = []
							let resolveNext: ((state: WorldState) => void) | null = null

							const unsubscribe = registry.subscribe(worldStateAtom, (state: WorldState) => {
								if (resolveNext) {
									// If iterator is waiting, resolve immediately
									resolveNext(state)
									resolveNext = null
								} else {
									// Otherwise, queue for later consumption
									queue.push(state)
								}
							})

							// Return subscription handle with queue access
							return {
								unsubscribe,
								queue,
								setResolveNext: (fn: typeof resolveNext) => {
									resolveNext = fn
								},
							}
						}),
						// Release: guaranteed cleanup (called when scope closes)
						({ unsubscribe }) => Effect.sync(unsubscribe),
					),
					Scope.extend(scope),
				),
			)

			// Yield states as they arrive using queue pattern
			try {
				while (true) {
					if (subscription.queue.length > 0) {
						// Drain queue first
						yield subscription.queue.shift()!
					} else {
						// Wait for next state via Promise
						const state = await new Promise<WorldState>((resolve) => {
							subscription.setResolveNext(resolve)
						})
						yield state
					}
				}
			} finally {
				// Close scope to trigger cleanup (acquireRelease calls unsubscribe)
				await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined as void)))
			}
		} catch (error) {
			// Ensure scope is closed on error path too
			await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined as void)))
			throw error
		}
	}

	/**
	 * Clean up resources
	 */
	async function dispose(): Promise<void> {
		sse?.stop()
		cleanupMount() // Unmount worldStateAtom
	}

	// TODO (0c.4): Re-enable event consumer for additional sources (swarm-db, etc.)
	// SwarmDb event paths eliminated for now - will be re-added in future phase
	// Uncomment when routeEvent() is updated to handle SourceEvent types
	// if (sources.length > 0) {
	// 	const consumerEffect = pipe(
	// 		stream(),
	// 		Stream.runForEach((event) =>
	// 			Effect.sync(() => {
	// 				// TODO: Call routeEvent() or new router for SourceEvent types
	//
	// 				// Call onEvent callback for all source events (not just SSE)
	// 				if (onEvent) {
	// 					// Convert SourceEvent to SSEEventInfo format
	// 					// Extract properties from data (assuming data is an object)
	// 					const properties =
	// 						typeof event.data === "object" && event.data !== null
	// 							? (event.data as Record<string, unknown>)
	// 							: { raw: event.data }
	//
	// 					onEvent({
	// 						source: event.source, // Top-level source for formatSSEEvent
	// 						type: event.type,
	// 						properties,
	// 					})
	// 				}
	// 			}),
	// 		),
	// 		// Catch all errors to prevent consumer from crashing
	// 		Effect.catchAll(() => Effect.void),
	// 	)
	//
	// 	// Run consumer in background (fire and forget)
	// 	Effect.runPromise(consumerEffect).catch(() => {
	// 		// Consumer errors are logged but don't crash the stream
	// 		// This allows graceful degradation if sources fail
	// 	})
	// }

	return {
		subscribe,
		getSnapshot,
		stream,
		getRegistry: () => registry,
		[Symbol.asyncIterator]: asyncIterator,
		dispose,
	}
}
