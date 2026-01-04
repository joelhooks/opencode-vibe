/**
 * @opencode-vibe/core/discovery
 *
 * Server discovery and routing modules for OpenCode.
 *
 * ## Modules
 *
 * - **discovery.ts**: Browser-based Discovery layer (fetch to /api/opencode/servers)
 * - **discovery.node.ts**: Node.js Discovery layer (lsof process scanning)
 * - **server-routing.ts**: Pure routing functions for directory/session→server mapping
 * - **types.ts**: Unified Discovery service interface
 *
 * ## Usage
 *
 * ```typescript
 * import { Discovery, DiscoveryBrowserLive } from "@opencode-vibe/core/discovery"
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* Discovery
 *   const servers = yield* discovery.discover({ includeSessions: true })
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(DiscoveryBrowserLive)))
 * ```
 *
 * ## Node.js-only exports
 *
 * For Node.js-specific functionality:
 * ```typescript
 * import { DiscoveryNodeLive } from "@opencode-vibe/core/discovery/node"
 * ```
 */

// Discovery service and types
export { Discovery } from "./types.js"
export type {
	DiscoveredServer,
	DiscoveredSession,
	DiscoveredProject,
	DiscoveryOptions,
	ServerInfo,
} from "./types.js"

// Browser-based Discovery layer (uses fetch)
export { DiscoveryBrowserLive, Default as DiscoveryDefault, makeTestLayer } from "./discovery.js"

// Pure routing functions (browser-safe)
export { getServerForDirectory, getServerForSession } from "./server-routing.js"
export type { ServerInfo as RoutingServerInfo } from "./server-routing.js"
