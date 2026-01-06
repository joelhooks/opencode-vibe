/**
 * Client routing utilities and SDK factory
 *
 * Provides routing logic and SDK client factory for OpenCode.
 */

import { Effect } from "effect"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"
import {
	Discovery,
	getServerForDirectory,
	getServerForSession,
	type ServerInfo,
} from "../world/discovery/index.js"

export type { OpencodeClient }

/**
 * OpenCode server URL from environment variable
 * Returns undefined if NEXT_PUBLIC_OPENCODE_URL not set
 * Discovery MUST be used to find running servers - no hardcoded fallbacks
 */
export const OPENCODE_URL = process.env.NEXT_PUBLIC_OPENCODE_URL

/**
 * Proxy URL for browser clients derived from environment variable
 * Returns undefined if NEXT_PUBLIC_OPENCODE_URL not set or malformed
 * No hardcoded fallback - discovery is required to find running servers
 */
const DEFAULT_PROXY_URL = (() => {
	const baseUrl = process.env.NEXT_PUBLIC_OPENCODE_URL
	if (!baseUrl) return undefined

	try {
		const url = new URL(baseUrl)
		if (!url.port) return undefined
		return `/api/opencode/${url.port}`
	} catch {
		// Malformed URL = undefined (no fallback)
		return undefined
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
 * Priority: session-specific routing > directory routing > env var
 *
 * @param directory - Optional project directory for scoping
 * @param sessionId - Optional session ID for session-specific routing
 * @param routingContext - Routing context with servers (optional)
 * @returns Server URL to use, or undefined if no server available
 *
 * @example
 * ```ts
 * // Basic usage (returns undefined if OPENCODE_URL not set)
 * const url = getClientUrl()
 * // => undefined (no discovery, no env var)
 *
 * // With directory (routes to directory's server if found via discovery)
 * const url = getClientUrl("/path/to/project", undefined, { servers })
 * // => "/api/opencode/4057" (if server found) or undefined
 *
 * // With session (routes to session's server via discovery)
 * const url = getClientUrl("/path/to/project", "ses_123", { servers, sessionToPort })
 * // => routes to cached session server, then directory, then env var, or undefined
 * ```
 */
export function getClientUrl(
	directory?: string,
	sessionId?: string,
	routingContext?: RoutingContext,
): string | undefined {
	// No routing context = use proxy URL from env var (may be undefined)
	if (!routingContext || routingContext.servers.length === 0) {
		return DEFAULT_PROXY_URL
	}

	// Priority: session-specific routing > directory routing > env var
	if (sessionId && directory) {
		const url = getServerForSession(
			sessionId,
			directory,
			routingContext.servers,
			routingContext.sessionToPort,
		)
		if (url) return url
	}

	if (directory) {
		const url = getServerForDirectory(directory, routingContext.servers)
		if (url) return url
	}

	return DEFAULT_PROXY_URL
}

/**
 * Create an OpenCode SDK client instance with proxy URL routing
 *
 * This function does NOT throw if no URL is available. Instead, it creates
 * a client that will fail when making requests with a helpful error from the SDK.
 *
 * The URL should come from discovery (via World Stream/MultiServerSSE) and be
 * passed as the baseUrl parameter. The env var is only a fallback.
 *
 * @param directory - Optional project directory for scoping requests
 * @param sessionId - Optional session ID for session-specific routing (unused)
 * @param baseUrl - Optional explicit base URL from discovery (recommended)
 * @returns Configured OpencodeClient with all namespaces
 *
 * @example
 * ```ts
 * // With discovery (recommended)
 * const url = getClientUrl("/path/to/project", undefined, { servers })
 * const client = createClient("/path/to/project", undefined, url)
 *
 * // With env var (legacy - only if NEXT_PUBLIC_OPENCODE_URL is set)
 * const client = createClient("/path/to/project")
 *
 * // No URL - client will work but fail on first request
 * const client = createClient()  // SDK will error with helpful message
 * ```
 */
export function createClient(
	directory?: string,
	sessionId?: string,
	baseUrl?: string,
): OpencodeClient {
	// Use provided baseUrl, fallback to env var proxy, or empty string
	const serverUrl = baseUrl ?? DEFAULT_PROXY_URL ?? ""

	return createOpencodeClient({
		baseUrl: serverUrl,
		directory,
	})
}

/**
 * Lazy-initialized singleton client for global operations (no directory scoping)
 * Use createClient(directory) for project-scoped operations
 *
 * Getter pattern to avoid module evaluation throw
 */
let _globalClient: OpencodeClient | null = null

/**
 * Get the global singleton client instance
 * Lazy-initialized on first access to avoid module evaluation throw
 */
export function getGlobalClient(): OpencodeClient {
	if (!_globalClient) {
		_globalClient = createClient()
	}
	return _globalClient
}

/**
 * @deprecated Use getGlobalClient() instead to avoid module evaluation issues
 * This export maintained for backwards compatibility but should be migrated
 */
export const globalClient: OpencodeClient = new Proxy({} as OpencodeClient, {
	get(_target, prop) {
		const client = getGlobalClient()
		const value = client[prop as keyof OpencodeClient]
		// Bind methods to the actual client instance
		return typeof value === "function" ? value.bind(client) : value
	},
	has(_target, prop) {
		return prop in getGlobalClient()
	},
	ownKeys(_target) {
		return Reflect.ownKeys(getGlobalClient())
	},
	getOwnPropertyDescriptor(_target, prop) {
		return Reflect.getOwnPropertyDescriptor(getGlobalClient(), prop)
	},
})
