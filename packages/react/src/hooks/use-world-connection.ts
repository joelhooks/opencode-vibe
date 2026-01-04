/**
 * useWorldConnection - Get connection status from world state
 *
 * Binds to Core's World Stream connection status via useWorld().
 * Simple derivation - no additional subscriptions needed.
 *
 * ARCHITECTURE (ADR-016):
 * - Core owns computation (WorldStore.connectionStatus)
 * - React binds UI (useWorld hook)
 * - Derived hooks just select from useWorld()
 *
 * @example
 * ```tsx
 * function ConnectionIndicator() {
 *   const status = useWorldConnection()
 *   return <div>Status: {status}</div>
 * }
 * ```
 */

"use client"

import { useWorld } from "./use-world.js"

/**
 * Connection status type
 */
export type ConnectionStatus = "discovering" | "connecting" | "connected" | "disconnected" | "error"

/**
 * useWorldConnection - Subscribe to connection status
 *
 * Returns current connection status from world state.
 * Automatically updates when connection status changes.
 *
 * @returns Current connection status
 */
export function useWorldConnection(): ConnectionStatus {
	const world = useWorld()
	return world.connectionStatus
}
