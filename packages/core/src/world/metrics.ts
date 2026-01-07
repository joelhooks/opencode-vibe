/**
 * World Layer Metrics - Centralized observability metrics for SSE, world state, and performance
 *
 * Defines gauges, counters, and histograms for monitoring the world stream layer.
 * Use these metrics to track:
 * - SSE connection health (connections, reconnections, events)
 * - World state cardinality (total sessions, active sessions)
 * - Performance (event processing time, binary search operations)
 *
 * USAGE:
 * ```typescript
 * import { WorldMetrics } from "./metrics"
 * import { Metric } from "effect"
 *
 * // Increment gauge
 * Metric.increment(WorldMetrics.sseConnectionsActive)
 *
 * // Record counter with label (use Metric.tagged at call site)
 * Metric.increment(WorldMetrics.sseEventsTotal.pipe(
 *   Metric.tagged("event_type", "session:created")
 * ))
 *
 * // Record histogram
 * Metric.record(WorldMetrics.eventProcessingSeconds, durationInSeconds)
 * ```
 */

import { Effect, Metric, MetricBoundaries } from "effect"

// Pre-define metrics to avoid TypeScript inference issues with complex Effect types
const sseConnectionsActive = Metric.gauge("sse_connections_active")
const worldSessionsTotal = Metric.gauge("world_sessions_total")
const worldSessionsActive = Metric.gauge("world_sessions_active")
const sseReconnectionsTotal = Metric.counter("sse_reconnections_total")
const binarySearchTotal = Metric.counter("binary_search_total")
const swarmDbPollsTotal = Metric.counter("swarmdb_polls_total")
const sseEventsTotal = Metric.counter("sse_events_total")
const cursorOperationsTotal = Metric.counter("cursor_operations_total")

const eventProcessingBoundaries = MetricBoundaries.exponential({
	start: 0.001,
	factor: 2,
	count: 10,
})
const eventProcessingSeconds = Metric.histogram(
	"event_processing_seconds",
	eventProcessingBoundaries,
)
const swarmDbPollSeconds = Metric.histogram("swarmdb_poll_seconds", eventProcessingBoundaries)
const cursorQuerySeconds = Metric.histogram("cursor_query_seconds", eventProcessingBoundaries)

// Pre-define atom subscription metrics
const atomSubscriptionsActive = Metric.gauge("atom_subscriptions_active")
const atomCreationsTotal = Metric.counter("atom_creations_total")
const atomDisposalsTotal = Metric.counter("atom_disposals_total")

/**
 * WorldMetrics - Centralized metrics for the world layer
 *
 * Exported as const object to provide:
 * - Type-safe metric access
 * - Consistent naming (follows Prometheus conventions: snake_case)
 * - Documented metric semantics
 */
export const WorldMetrics = {
	// ============================================================================
	// GAUGES - Current state snapshots
	// ============================================================================

	/**
	 * sse_connections_active - Number of active SSE connections
	 *
	 * Tracks current SSE connection count. Increment on connect, decrement on disconnect.
	 * Use for: Connection health monitoring, capacity planning
	 */
	sseConnectionsActive,

	/**
	 * world_sessions_total - Total number of sessions in world state
	 *
	 * Tracks all sessions (active + inactive). Set on world state updates.
	 * Use for: Data cardinality monitoring, memory estimation
	 */
	worldSessionsTotal,

	/**
	 * world_sessions_active - Number of active sessions in world state
	 *
	 * Tracks only active sessions. Set on world state updates.
	 * Use for: User activity monitoring, capacity planning
	 */
	worldSessionsActive,

	/**
	 * atom_subscriptions_active - Number of active atom subscriptions
	 *
	 * Tracks current subscription count per atom tier.
	 * Add labels at call site with Metric.tagged:
	 *
	 * ```typescript
	 * Metric.set(WorldMetrics.atomSubscriptionsActive.pipe(
	 *   Metric.tagged("tier", "session"),
	 *   Metric.tagged("atom_id", "sessionsAtom")
	 * ), subscriptionCount)
	 * ```
	 *
	 * Use for: Memory leak detection, idleTTL debugging, atom lifecycle monitoring
	 */
	atomSubscriptionsActive,

	// ============================================================================
	// COUNTERS - Cumulative counts (monotonically increasing)
	// ============================================================================

	/**
	 * sse_events_total - Total SSE events received
	 *
	 * Tracks cumulative event count. Increment on each event received.
	 * Add labels at call site with Metric.tagged:
	 *
	 * ```typescript
	 * Metric.increment(WorldMetrics.sseEventsTotal.pipe(
	 *   Metric.tagged("event_type", eventType)
	 * ))
	 * ```
	 *
	 * Use for: Event throughput monitoring, debugging event flows
	 */
	sseEventsTotal,

	/**
	 * sse_reconnections_total - Total SSE reconnection attempts
	 *
	 * Tracks cumulative reconnection count. Increment on each reconnect attempt.
	 * Use for: Connection stability monitoring, network health
	 */
	sseReconnectionsTotal,

	/**
	 * binary_search_total - Total binary search operations
	 *
	 * Tracks cumulative binary search count across all world state updates.
	 * Use for: Performance monitoring, algorithm efficiency validation
	 */
	binarySearchTotal,

	/**
	 * swarmdb_polls_total - Total SwarmDb polling cycles
	 *
	 * Tracks cumulative polling cycles for SwarmDb event source.
	 * Use for: Polling frequency monitoring, event source health
	 */
	swarmDbPollsTotal,

	/**
	 * cursor_operations_total - Total cursor store operations
	 *
	 * Tracks cumulative cursor store operations.
	 * Add labels at call site with Metric.tagged:
	 *
	 * ```typescript
	 * Metric.increment(WorldMetrics.cursorOperationsTotal.pipe(
	 *   Metric.tagged("operation", "save")
	 * ))
	 * ```
	 *
	 * Use for: Database operation monitoring, cursor store health
	 */
	cursorOperationsTotal,

	/**
	 * atom_creations_total - Total atom creations
	 *
	 * Tracks cumulative atom creation count by tier.
	 * Add labels at call site with Metric.tagged:
	 *
	 * ```typescript
	 * Metric.increment(WorldMetrics.atomCreationsTotal.pipe(
	 *   Metric.tagged("tier", "session"),
	 *   Metric.tagged("atom_id", "sessionsAtom")
	 * ))
	 * ```
	 *
	 * Use for: Atom lifecycle monitoring, memory allocation tracking
	 */
	atomCreationsTotal,

	/**
	 * atom_disposals_total - Total atom disposals
	 *
	 * Tracks cumulative atom disposal count by tier.
	 * Add labels at call site with Metric.tagged:
	 *
	 * ```typescript
	 * Metric.increment(WorldMetrics.atomDisposalsTotal.pipe(
	 *   Metric.tagged("tier", "session"),
	 *   Metric.tagged("atom_id", "sessionsAtom"),
	 *   Metric.tagged("reason", "idle_ttl")
	 * ))
	 * ```
	 *
	 * Use for: idleTTL effectiveness, memory cleanup validation
	 */
	atomDisposalsTotal,

	// ============================================================================
	// HISTOGRAMS - Value distributions
	// ============================================================================

	/**
	 * event_processing_seconds - SSE event processing duration (seconds)
	 *
	 * Tracks distribution of event processing time from SSE receive to world state update.
	 * Buckets: Exponential from 1ms to ~1s (1ms, 2ms, 4ms, 8ms, 16ms, 32ms, 64ms, 128ms, 256ms, 512ms)
	 *
	 * Use for: Performance monitoring, latency percentiles (p50, p95, p99)
	 *
	 * USAGE:
	 * ```typescript
	 * const start = performance.now()
	 * // ... process event ...
	 * const durationSeconds = (performance.now() - start) / 1000
	 * Metric.record(WorldMetrics.eventProcessingSeconds, durationSeconds)
	 * ```
	 */
	eventProcessingSeconds,

	/**
	 * swarmdb_poll_seconds - SwarmDb polling query duration (seconds)
	 *
	 * Tracks distribution of SwarmDb query latency from query start to completion.
	 * Buckets: Same as event_processing_seconds (1ms to ~1s)
	 *
	 * Use for: Database performance monitoring, query latency percentiles
	 */
	swarmDbPollSeconds,

	/**
	 * cursor_query_seconds - Cursor store query duration (seconds)
	 *
	 * Tracks distribution of cursor store query latency.
	 * Buckets: Same as event_processing_seconds (1ms to ~1s)
	 *
	 * Use for: Database performance monitoring, cursor operation latency
	 */
	cursorQuerySeconds,
} as const

// ============================================================================
// ATOM METRICS TRACKING
// ============================================================================

/**
 * Atom tier classification for metrics
 *
 * - session: Atoms with idleTTL (sessionsAtom, messagesAtom, partsAtom, statusAtom, sessionToInstancePortAtom)
 * - global: Atoms with keepAlive (connectionStatusAtom, instancesAtom, projectsAtom, sessionCountAtom, worldStateAtom)
 */
export type AtomTier = "session" | "global"

/**
 * Atom lifecycle event for tracking
 */
export interface AtomLifecycleEvent {
	/** Atom identifier (e.g., "sessionsAtom") */
	atomId: string
	/** Atom tier classification */
	tier: AtomTier
	/** Event type */
	event: "created" | "subscribed" | "unsubscribed" | "disposed"
	/** Current subscription count after event */
	subscriptionCount: number
	/** Timestamp of event */
	timestamp: Date
	/** Optional disposal reason */
	reason?: "idle_ttl" | "manual"
}

/**
 * Atom metrics snapshot for debugging
 */
export interface AtomMetrics {
	atomId: string
	tier: AtomTier
	subscriptionCount: number
	createdAt: Date
	lastAccessedAt: Date
}

/**
 * Internal registry of atom metrics
 */
const atomMetricsRegistry = new Map<string, AtomMetrics>()

/**
 * Track atom lifecycle event
 *
 * Updates internal metrics registry and increments Prometheus metrics.
 * In development, also logs to console.
 *
 * @param event - Atom lifecycle event to track
 *
 * @example
 * ```typescript
 * trackAtomLifecycle({
 *   atomId: "sessionsAtom",
 *   tier: "session",
 *   event: "subscribed",
 *   subscriptionCount: 1,
 *   timestamp: new Date()
 * })
 * ```
 */
export function trackAtomLifecycle(event: AtomLifecycleEvent): void {
	const { atomId, tier, event: eventType, subscriptionCount, timestamp, reason } = event

	// Update internal registry
	if (eventType === "created") {
		atomMetricsRegistry.set(atomId, {
			atomId,
			tier,
			subscriptionCount: 0,
			createdAt: timestamp,
			lastAccessedAt: timestamp,
		})

		// Increment creation counter
		Effect.runSync(
			Metric.update(
				atomCreationsTotal.pipe(Metric.tagged("tier", tier), Metric.tagged("atom_id", atomId)),
				1,
			),
		)
	} else if (eventType === "disposed") {
		atomMetricsRegistry.delete(atomId)

		// Increment disposal counter
		Effect.runSync(
			Metric.update(
				atomDisposalsTotal.pipe(
					Metric.tagged("tier", tier),
					Metric.tagged("atom_id", atomId),
					Metric.tagged("reason", reason ?? "manual"),
				),
				1,
			),
		)
	} else {
		// Update subscription count and last accessed time
		const existing = atomMetricsRegistry.get(atomId)
		if (existing) {
			existing.subscriptionCount = subscriptionCount
			existing.lastAccessedAt = timestamp
		}
	}

	// Update Prometheus gauge for subscription count
	Effect.runSync(
		Metric.update(
			atomSubscriptionsActive.pipe(Metric.tagged("tier", tier), Metric.tagged("atom_id", atomId)),
			subscriptionCount,
		),
	)

	// Development-only logging
	if (process.env.NODE_ENV === "development") {
		logAtomLifecycle(event)
	}
}

/**
 * Get current atom metrics for all tracked atoms
 *
 * Returns a snapshot of all atom metrics in the registry.
 * Useful for debugging and monitoring.
 *
 * @returns Array of atom metrics snapshots
 *
 * @example
 * ```typescript
 * const metrics = getAtomMetrics()
 * console.log(`Total atoms: ${metrics.length}`)
 * console.log(`Session tier atoms: ${metrics.filter(m => m.tier === "session").length}`)
 * ```
 */
export function getAtomMetrics(): AtomMetrics[] {
	return Array.from(atomMetricsRegistry.values())
}

/**
 * Log atom lifecycle event to console (development-only)
 *
 * Formats atom lifecycle events with clear visual structure.
 * Only called when NODE_ENV=development.
 *
 * @param event - Atom lifecycle event to log
 *
 * @example
 * ```typescript
 * logAtomLifecycle({
 *   atomId: "sessionsAtom",
 *   tier: "session",
 *   event: "subscribed",
 *   subscriptionCount: 1,
 *   timestamp: new Date()
 * })
 * // [ATOM] sessionsAtom (session) subscribed → 1 subscribers
 * ```
 */
export function logAtomLifecycle(event: AtomLifecycleEvent): void {
	const { atomId, tier, event: eventType, subscriptionCount, reason } = event

	const prefix = "[ATOM]"
	const tierLabel = `(${tier})`
	const countLabel = `→ ${subscriptionCount} subscriber${subscriptionCount === 1 ? "" : "s"}`
	const reasonLabel = reason ? ` (${reason})` : ""

	const message = `${prefix} ${atomId} ${tierLabel} ${eventType}${reasonLabel} ${countLabel}`

	// Use Effect logging for consistency
	Effect.runSync(Effect.logDebug(message))
}

/**
 * Clear atom metrics registry
 *
 * Useful for testing to reset state between test runs.
 */
export function clearAtomMetrics(): void {
	atomMetricsRegistry.clear()
}
