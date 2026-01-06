/**
 * useWorld - React binding to Core's World Stream API
 *
 * Binds React to the reactive World Stream using useSyncExternalStore.
 * Uses singleton pattern for global stream instance.
 *
 * ARCHITECTURE (ADR-016, ADR-018):
 * - Core owns computation (WorldStore, derived state)
 * - React binds UI (useSyncExternalStore)
 * - Effect is internal to Core (Promise APIs exposed)
 *
 * IMPORT CONSTRAINT:
 * - ONLY import from @opencode-vibe/core/world
 * - NO Effect types
 * - NO direct Core imports
 *
 * @example
 * ```tsx
 * function SessionList() {
 *   const world = useWorld()
 *
 *   return (
 *     <div>
 *       <p>Status: {world.connectionStatus}</p>
 *       <p>Sessions: {world.sessions.length}</p>
 *       {world.sessions.map(s => <Session key={s.id} {...s} />)}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useSyncExternalStore } from "react"
// Import from specific files to avoid pulling in Node.js-only dependencies (otel.js)
// The barrel file (@opencode-vibe/core/world) exports OTel which uses async_hooks
import { createWorldStream } from "@opencode-vibe/core/world/stream"
import type { WorldState, WorldStreamHandle } from "@opencode-vibe/core/world/types"

/**
 * Singleton stream instance
 * Multiple components can call useWorld() - they all share one stream
 */
let globalStream: WorldStreamHandle | null = null

/**
 * Cached state for synchronous getSnapshot
 * Updated by subscribe callback (BehaviorSubject pattern)
 */
let cachedState: WorldState | null = null

/**
 * Get initial instances from OpencodeSSRPlugin config
 * Returns undefined if no config or no instances
 */
function getInitialInstances(): WorldState["instances"] | undefined {
	if (typeof window === "undefined") {
		return undefined
	}

	const config = (window as any).__OPENCODE

	if (!config?.instances) {
		return undefined
	}

	// Convert OpencodeInstance[] to Instance[] format
	return config.instances.map((i: any) => ({
		port: i.port,
		pid: 0, // Unknown from SSR
		directory: i.directory,
		status: "connected" as const,
		baseUrl: i.baseUrl,
		lastSeen: Date.now(),
	}))
}

/**
 * Get or create the global stream instance
 */
function getStream(): WorldStreamHandle {
	if (!globalStream) {
		const initialInstances = getInitialInstances()
		globalStream = createWorldStream({ initialInstances })
	}
	return globalStream
}

/**
 * Server snapshot for SSR
 * Returns empty state structure for initial render
 */
const emptyState: WorldState = {
	sessions: [],
	activeSessionCount: 0,
	activeSession: null,
	connectionStatus: "connecting",
	lastUpdated: 0,
	byDirectory: new Map(),
	stats: { total: 0, active: 0, streaming: 0 },
	// Instance layer
	instances: [],
	instanceByPort: new Map(),
	instancesByDirectory: new Map(),
	connectedInstanceCount: 0,
	// Project layer
	projects: [],
	projectByDirectory: new Map(),
	// Routing layer
	sessionToInstance: new Map(),
}

/**
 * useWorld - Subscribe to reactive world state
 *
 * Returns current world state and automatically updates when state changes.
 * Uses useSyncExternalStore for React 18+ compatibility and SSR support.
 *
 * KEY INSIGHT from Hivemind (mem-104fa528210dc178):
 * WorldStore.subscribe() fires immediately with current state (BehaviorSubject pattern).
 * This means we get the initial state synchronously in the subscribe callback,
 * which we cache for useSyncExternalStore's synchronous getSnapshot requirement.
 *
 * @returns Current world state snapshot
 */
export function useWorld(): WorldState {
	const stream = getStream()

	// useSyncExternalStore requires synchronous getSnapshot
	// We cache state from subscribe callback (which fires immediately)
	return useSyncExternalStore(
		// subscribe: called once on mount, cleanup on unmount
		(callback) => {
			const unsubscribe = stream.subscribe((state) => {
				// Cache state for synchronous getSnapshot
				cachedState = state
				// Notify React of state change
				callback()
			})
			return unsubscribe
		},
		// getSnapshot: called on every render, must be synchronous
		() => {
			// Return cached state (updated by subscribe callback)
			return cachedState || emptyState
		},
		// getServerSnapshot: for SSR, return empty state
		() => emptyState,
	)
}

/**
 * Get the global world registry for external event routing
 * Used by layout-client.tsx to wire multiServerSSE events to event-router.ts
 *
 * Returns null if stream hasn't been initialized yet.
 *
 * @example
 * ```typescript
 * const registry = getWorldRegistry()
 * if (registry) {
 *   routeEvent(event, registry, port)
 * }
 * ```
 */
export function getWorldRegistry() {
	if (!globalStream) return null
	// Safe cast: createWorldStream returns MergedStreamHandle with getRegistry()
	return (globalStream as any).getRegistry()
}

/**
 * Reset the singleton stream (TEST ONLY)
 * @internal
 */
export function __resetWorldStream(): void {
	globalStream = null
	cachedState = null
	// Note: worldStateAtom uses Atom.keepAlive, so it persists across resets
	// Tests should use Registry.make() for isolated atom instances if needed
}
