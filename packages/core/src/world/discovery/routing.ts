/**
 * Server Routing Helpers
 *
 * Pure functions for determining which OpenCode server to route requests to.
 * Used by client.ts to pick the right server based on directory or session ID.
 *
 * Architecture:
 * - getServerForDirectory: Route based on project directory
 * - getServerForSession: Route based on session ID (with directory fallback)
 * - Returns null when no servers are found (callers handle "no server" state)
 *
 * @see {@link https://github.com/user/repo/blob/main/docs/server-discovery.md}
 */

/**
 * Server information from discovery
 */
export interface ServerInfo {
	port: number
	directory: string
	url: string
}

/**
 * Normalize directory path by removing trailing slash
 */
function normalizeDirectory(directory: string): string {
	return directory.endsWith("/") ? directory.slice(0, -1) : directory
}

/**
 * Find server URL for a given directory.
 * Returns null if no match found.
 *
 * @param directory - Project directory path
 * @param servers - Available servers from discovery
 * @returns Server URL if found, null otherwise
 *
 * @example
 * ```ts
 * const url = getServerForDirectory("/home/user/project", servers)
 * // Returns "http://127.0.0.1:4057" if found, or null if not
 * ```
 */
export function getServerForDirectory(directory: string, servers: ServerInfo[]): string | null {
	if (!directory || servers.length === 0) {
		return null
	}

	const normalizedDirectory = normalizeDirectory(directory)

	// Find first server matching this directory
	const server = servers.find((s) => normalizeDirectory(s.directory) === normalizedDirectory)

	return server?.url ?? null
}

/**
 * Find server URL for a session, with directory fallback.
 * Prefers session cache (if available), then directory match.
 *
 * @param sessionId - Session ID to route
 * @param directory - Project directory (fallback if session not cached)
 * @param servers - Available servers from discovery
 * @param sessionToPort - Optional session->port cache from MultiServerSSE
 * @returns Server URL if found, null otherwise
 *
 * @example
 * ```ts
 * // With session cache
 * const url = getServerForSession("session-123", "/home/user/project", servers, cache)
 * // Returns cached server if found, else directory match, else null
 *
 * // Without session cache (falls back to directory)
 * const url = getServerForSession("session-123", "/home/user/project", servers)
 * ```
 */
export function getServerForSession(
	sessionId: string,
	directory: string,
	servers: ServerInfo[],
	sessionToPort?: Map<string, number>,
): string | null {
	if (servers.length === 0) {
		return null
	}

	// 1. Check session cache first (most specific)
	if (sessionToPort) {
		const cachedPort = sessionToPort.get(sessionId)
		if (cachedPort !== undefined) {
			// Verify the cached port still exists in discovered servers
			const server = servers.find((s) => s.port === cachedPort)
			if (server) {
				return server.url
			}
			// Cached port is stale (server died) - fall through to directory match
		}
	}

	// 2. Fall back to directory match
	return getServerForDirectory(directory, servers)
}
