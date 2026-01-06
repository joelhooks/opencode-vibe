/**
 * Discovery Module
 *
 * Server discovery for OpenCode instances using Effect Layers.
 *
 * Node.js-only discovery. For server discovery, import from:
 * `@opencode-vibe/core/world/discovery/node`
 *
 * Exports:
 * - Types (Discovery service, DiscoveredServer, DiscoveryOptions, ServerInfo)
 * - Routing helpers (getServerForDirectory, getServerForSession)
 *
 * @module world/discovery
 */

// Types
export {
	Discovery,
	type DiscoveredServer,
	type DiscoveredSession,
	type DiscoveredProject,
	type DiscoveryOptions,
	type ServerInfo,
} from "./types.js"

// Routing helpers
export { getServerForDirectory, getServerForSession } from "./routing.js"
