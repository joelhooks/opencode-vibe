/**
 * @opencode-vibe/core/discovery/server
 *
 * Node.js-only server discovery exports.
 *
 * **WARNING**: This module uses Node.js APIs (child_process).
 * Do NOT import from client-side code. Use the browser-safe
 * discovery.ts module instead.
 *
 * @module discovery/server
 */

// Node.js Discovery Layer (uses child_process for lsof)
export { DiscoveryNodeLive } from "./discovery.node.js"

// Re-export Discovery service for convenience
export { Discovery } from "./types.js"

// Re-export types
export type {
	DiscoveredServer,
	DiscoveredSession,
	DiscoveredProject,
	DiscoveryOptions,
	ServerInfo,
} from "./types.js"
