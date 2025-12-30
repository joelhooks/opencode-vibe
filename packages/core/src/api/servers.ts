/**
 * Servers API - Promise-based wrapper
 *
 * Promise-based API for server discovery operations.
 * Wraps ServerAtom Effect programs with Effect.runPromise.
 *
 * @module api/servers
 */

import { Effect } from "effect"
import { ServerAtom } from "../atoms/servers.js"
import type { ServerInfo } from "../discovery/index.js"

/**
 * Server API namespace
 *
 * Promise-based wrappers around ServerAtom.
 */
export const servers = {
	/**
	 * Discover available OpenCode servers
	 *
	 * @returns Promise that resolves to ServerInfo array (always includes localhost:4056)
	 *
	 * @example
	 * ```typescript
	 * const servers = await servers.discover()
	 * console.log(servers.length)
	 * ```
	 */
	discover: (): Promise<ServerInfo[]> => Effect.runPromise(ServerAtom.discover()),

	/**
	 * Get the current "best" server
	 *
	 * @returns Promise that resolves to the best ServerInfo
	 *
	 * @example
	 * ```typescript
	 * const currentServer = await servers.currentServer()
	 * console.log(currentServer.url)
	 * ```
	 */
	currentServer: (): Promise<ServerInfo> => Effect.runPromise(ServerAtom.currentServer()),
}

// Export types for consumers
export type { ServerInfo }
