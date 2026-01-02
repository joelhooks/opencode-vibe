/**
 * World Stream - ADR-018 Reactive World Stream
 *
 * Exports the world stream API for consuming enriched world state
 * from SSE events. Provides both subscription and async iterator APIs.
 *
 * SELF-CONTAINED: Discovery and SSE connections are handled internally.
 * No dependencies on browser APIs or proxy routes.
 */

// Main API
export { createWorldStream } from "./stream.js"
export type { WorldState, WorldStreamConfig, WorldStreamHandle } from "./stream.js"
export type { SSEEventInfo } from "./types.js"

// Discovery (for CLI tools that need direct access)
export { discoverServers } from "../discovery/server-discovery.js"
export type { DiscoveredServer } from "../discovery/server-discovery.js"

// SSE internals (for advanced usage)
export { WorldSSE, createWorldSSE, connectToSSE, SSEService, SSEServiceLive } from "./sse.js"
export type { SSEEvent, WorldSSEConfig, SSEServiceInterface } from "./sse.js"

// WorldStore (atom-based state management)
export { WorldStore, WorldStoreService, WorldStoreServiceLive } from "./atoms.js"
export type { WorldStoreServiceInterface } from "./atoms.js"

// Enriched types
export type { EnrichedMessage, EnrichedSession } from "./types.js"

// Cursor-based streaming types (Effect Schema)
export { EventOffset, StreamCursor } from "./cursor.js"
export { WorldEvent } from "./events.js"
export type { EventOffset as EventOffsetType, StreamCursor as StreamCursorType } from "./cursor.js"
export type { WorldEvent as WorldEventType } from "./events.js"

// Cursor persistence (Effect Layer)
export { CursorStore, CursorStoreLive } from "./cursor-store.js"
export type { CursorStoreService } from "./cursor-store.js"

// AtomRuntime with API services
export { apiRuntimeAtom, MessageService, StatusService } from "./runtime.js"

// effect-atom based state (Map-based for O(1) SSE updates)
export {
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	connectionStatusAtom,
	sessionCountAtom,
	Atom,
	Registry,
} from "./atoms.js"

// Derived world atom (array-based for enrichment)
export { worldAtom } from "./derived.js"

// Event sources (extensible event source pattern)
export { createSwarmDbSource } from "./event-source.js"
export { createSseSource } from "./sse-source.js"
export type { EventSource, SourceEvent } from "./event-source.js"

// Merged stream (combines multiple event sources)
export { createMergedWorldStream } from "./merged-stream.js"
export type { MergedStreamConfig, MergedStreamHandle } from "./merged-stream.js"

// Metrics endpoint (Prometheus exposition format)
export { formatPrometheusMetrics } from "./metrics-endpoint.js"
export type { MetricSnapshot } from "./metrics-endpoint.js"
