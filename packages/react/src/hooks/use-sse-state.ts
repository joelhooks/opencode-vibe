/**
 * useSSEState - React hook for World Stream connection state
 *
 * Subscribes to World Stream for SSE connection status.
 * Replaces multiServerSSE dependency with World Stream.
 *
 * @example
 * ```tsx
 * function SSEDebugPanel() {
 *   const { instances, discovering, connected, connectedCount } = useSSEState()
 *
 *   return (
 *     <div>
 *       {discovering && <Badge>Discovering...</Badge>}
 *       <p>Connected: {connected ? 'Yes' : 'No'}</p>
 *       <ul>
 *         {instances.map(i => (
 *           <li key={i.port}>Port {i.port}: {i.status}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo } from "react"
import { useWorld } from "./use-world"

export interface SSEState {
	/** Discovered instances */
	instances: Array<{ port: number; status: string; directory: string }>
	/** True if discovery is in progress */
	discovering: boolean
	/** True if at least one instance is connected */
	connected: boolean
	/** Number of connected instances */
	connectedCount: number
}

/**
 * Subscribe to World Stream connection state
 * Returns current state and updates reactively on state changes.
 *
 * SSR-safe: Returns empty state on server, subscribes on client.
 */
export function useSSEState(): SSEState {
	const world = useWorld()

	return useMemo(
		() => ({
			instances: world.instances.map((i) => ({
				port: i.port,
				status: i.status,
				directory: i.directory,
			})),
			discovering: world.connectionStatus === "connecting",
			connected: world.connectionStatus === "connected",
			connectedCount: world.connectedInstanceCount,
		}),
		[world.instances, world.connectionStatus, world.connectedInstanceCount],
	)
}
