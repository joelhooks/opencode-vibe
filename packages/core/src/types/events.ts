/**
 * Canonical SSE event types for the opencode system.
 * All other packages should re-export from here.
 *
 * These types define the event structures used across the real-time
 * event streaming system. Originally duplicated across react/types,
 * react/store, and imported from SDK - now consolidated here.
 */

// Re-export SDK event types (source of truth)
export type { GlobalEvent } from "./sdk.js"

// Re-export discovery types (source of truth moved to discovery module)
export type {
	DiscoveredServer,
	DiscoveredSession,
	DiscoveredProject,
} from "../world/discovery/types.js"

// Import for local usage
import type { DiscoveredServer } from "../world/discovery/types.js"

/**
 * Backward-compatible SessionStatus (string union)
 * SDK uses object discriminated union - keep compat type until migration
 */
export type SessionStatus = "pending" | "running" | "completed" | "error" | "idle"

/**
 * SSE connection state for observability
 */
export type ConnectionState = "connecting" | "connected" | "disconnected"

/**
 * Extended connection state with timing metadata
 */
export interface ConnectionStateExtended {
	state: ConnectionState
	lastEventTime?: number
	backoffAttempt?: number
}

/**
 * Aggregated SSE state across all discovered servers
 */
export interface SSEState {
	servers: DiscoveredServer[]
	connections: [number, ConnectionStateExtended][] // [port, state] tuples
	discovering: boolean
	connected: boolean // True if any connection is active
}
