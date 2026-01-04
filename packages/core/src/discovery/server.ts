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

// Process-based discovery (Node.js only - uses child_process)
export {
	discoverServers,
	type DiscoveredServer,
	type DiscoveryOptions,
} from "./server-discovery.js"
