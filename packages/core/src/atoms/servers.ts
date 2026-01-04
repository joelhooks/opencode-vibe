/**
 * Server Discovery Atom (Effect Program)
 *
 * Pure Effect programs for OpenCode server discovery.
 * No React dependencies - usable in any Effect runtime.
 *
 * Provides:
 * - Effect-native server discovery integration
 * - Automatic fallback to localhost:4056
 * - Pure functional API
 *
 * @module atoms/servers
 */

import { Effect } from "effect"
import {
	Discovery,
	type DiscoveredServer,
	type ServerInfo,
	DiscoveryDefault,
} from "../discovery/index.js"

/**
 * Default fallback server (localhost:4056)
 * CRITICAL: This must ALWAYS be available as fallback
 */
export const DEFAULT_SERVER: ServerInfo = {
	port: 4056,
	directory: "",
	url: "http://localhost:4056",
}

/**
 * Select best server from list
 * Preference: first server with directory, otherwise first server
 *
 * @param servers - List of available servers
 * @returns The selected server
 */
export function selectBestServer(servers: ServerInfo[]): ServerInfo {
	// Prefer first server with a directory
	const serverWithDir = servers.find((s) => s.directory !== "")
	return serverWithDir || servers[0] || DEFAULT_SERVER
}

/**
 * Server Discovery Atom
 *
 * Pure Effect programs for server discovery and selection.
 */
export const ServerAtom = {
	/**
	 * Discover available OpenCode servers
	 *
	 * Runs server discovery and ensures localhost:4056 is always included.
	 * Never fails - falls back to DEFAULT_SERVER on error.
	 *
	 * @returns Effect that yields list of discovered servers (always includes default)
	 *
	 * @example
	 * ```typescript
	 * const servers = await Effect.runPromise(ServerAtom.discover())
	 * console.log("Found", servers.length, "servers")
	 * ```
	 */
	discover: (): Effect.Effect<ServerInfo[], never> =>
		Effect.gen(function* () {
			const discovery = yield* Discovery
			const discoveredServers = yield* discovery.discover()

			// Convert DiscoveredServer[] to ServerInfo[]
			const servers: ServerInfo[] = discoveredServers.map((s: DiscoveredServer) => ({
				port: s.port,
				directory: s.directory,
				url: `http://localhost:${s.port}`,
			}))

			// CRITICAL: Always include localhost:4056 default
			if (servers.length === 0) {
				return [DEFAULT_SERVER]
			}

			// Check if default server already in list
			const hasDefault = servers.some(
				(s) => s.port === DEFAULT_SERVER.port && s.directory === DEFAULT_SERVER.directory,
			)

			// If default not found, prepend it
			return hasDefault ? servers : [DEFAULT_SERVER, ...servers]
		}).pipe(
			Effect.provide(DiscoveryDefault),
			// On error, fall back to default server
			Effect.catchAll(() => Effect.succeed([DEFAULT_SERVER])),
		),

	/**
	 * Get the current "best" server
	 *
	 * Uses heuristic to select best server:
	 * 1. First server with non-empty directory (active project)
	 * 2. Otherwise, first server in list
	 * 3. Falls back to localhost:4056 if discovery fails
	 *
	 * @returns Effect that yields the best ServerInfo (never fails)
	 *
	 * @example
	 * ```typescript
	 * const currentServer = await Effect.runPromise(ServerAtom.currentServer())
	 * const client = createClient(currentServer.directory)
	 * ```
	 */
	currentServer: (): Effect.Effect<ServerInfo, never> =>
		ServerAtom.discover().pipe(Effect.map(selectBestServer)),
}
