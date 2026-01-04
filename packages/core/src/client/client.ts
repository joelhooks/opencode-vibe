/**
 * Client routing utilities and SDK factory
 *
 * Provides routing logic and SDK client factory for OpenCode.
 */

import { Effect } from "effect"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"
import {
	Discovery,
	DiscoveryBrowserLive,
	getServerForDirectory,
	getServerForSession,
	type ServerInfo,
} from "../discovery/index.js"

export type { OpencodeClient }

/**
 * Default OpenCode server URL
 * Can be overridden via NEXT_PUBLIC_OPENCODE_URL env var
 */
export const OPENCODE_URL = process.env.NEXT_PUBLIC_OPENCODE_URL ?? "http://localhost:4056"

/**
 * Default proxy URL for browser clients
 * Extracts port from OPENCODE_URL and formats as Next.js API route
 */
const DEFAULT_PROXY_URL = (() => {
	try {
		const url = new URL(OPENCODE_URL)
		const port = url.port || "4056"
		return `/api/opencode/${port}`
	} catch {
		// Fallback if OPENCODE_URL is malformed
		return "/api/opencode/4056"
	}
})()

/**
 * Routing context for smart server discovery
 * Inject this from MultiServerSSE or other discovery mechanisms
 */
export interface RoutingContext {
	/** Available servers from discovery */
	servers: ServerInfo[]
	/** Optional session->port cache for session-specific routing */
	sessionToPort?: Map<string, number>
}

/**
 * Get the appropriate server URL for a client request
 *
 * Priority: session-specific routing > directory routing > default server
 *
 * @param directory - Optional project directory for scoping
 * @param sessionId - Optional session ID for session-specific routing
 * @param routingContext - Routing context with servers (optional)
 * @returns Server URL to use
 *
 * @example
 * ```ts
 * // Basic usage (routes to proxy URL)
 * const url = getClientUrl()
 * // => "/api/opencode/4056"
 *
 * // With directory (routes to directory's server if found)
 * const url = getClientUrl("/path/to/project", undefined, { servers })
 * // => "/api/opencode/4057" (if server found) or "/api/opencode/4056"
 *
 * // With session (routes to session's server)
 * const url = getClientUrl("/path/to/project", "ses_123", { servers, sessionToPort })
 * // => routes to cached session server, then directory, then proxy URL
 * ```
 */
export function getClientUrl(
	directory?: string,
	sessionId?: string,
	routingContext?: RoutingContext,
): string {
	// No routing context = use proxy URL (browser-safe)
	if (!routingContext || routingContext.servers.length === 0) {
		return DEFAULT_PROXY_URL
	}

	// Priority: session-specific routing > directory routing > default
	if (sessionId && directory) {
		return getServerForSession(
			sessionId,
			directory,
			routingContext.servers,
			routingContext.sessionToPort,
		)
	}

	if (directory) {
		return getServerForDirectory(directory, routingContext.servers)
	}

	return DEFAULT_PROXY_URL
}

/**
 * Helper to run Effect programs with Discovery layer
 *
 * Provides DiscoveryBrowserLive layer by default.
 * For SSR/Node.js, provide DiscoveryNodeLive explicitly.
 *
 * @example
 * ```ts
 * const servers = await runWithDiscovery(
 *   Effect.gen(function* () {
 *     const discovery = yield* Discovery
 *     return yield* discovery.discover()
 *   })
 * )
 * ```
 */
export const runWithDiscovery = <A>(effect: Effect.Effect<A, never, Discovery>) =>
	Effect.runPromise(effect.pipe(Effect.provide(DiscoveryBrowserLive)))

/**
 * Create an OpenCode SDK client instance with proxy URL routing
 *
 * Always routes to the Next.js API proxy (`/api/opencode/{port}`), which handles
 * server discovery and routing on the backend. This ensures browser-safe operation
 * without needing async discovery in the client factory.
 *
 * For advanced routing with Discovery service, use `getClientUrl()` with routing context.
 *
 * @param directory - Optional project directory for scoping requests (passed via x-opencode-directory header)
 * @param sessionId - Optional session ID for session-specific routing (unused - for future use)
 * @returns Configured OpencodeClient with all namespaces
 *
 * @example
 * ```ts
 * // Basic usage (routes via proxy)
 * const client = createClient()
 * const sessions = await client.session.list()
 *
 * // With directory scoping
 * const client = createClient("/path/to/project")
 * const sessions = await client.session.list()
 * ```
 */
export function createClient(directory?: string, sessionId?: string): OpencodeClient {
	// Always use proxy URL for browser-safe operation
	// The Next.js API route handles server discovery and routing
	const serverUrl = DEFAULT_PROXY_URL

	return createOpencodeClient({
		baseUrl: serverUrl,
		directory,
	})
}

/**
 * Singleton client for global operations (no directory scoping)
 * Use createClient(directory) for project-scoped operations
 */
export const globalClient = createClient()
