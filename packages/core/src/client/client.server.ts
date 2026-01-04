/**
 * Server-only client utilities
 *
 * This module uses Node.js APIs (child_process via lsof).
 * Only import from:
 * - Server Components
 * - API Routes
 * - CLI tools
 *
 * DO NOT import from client components or browser code.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"
import { discoverServers } from "../discovery/server-discovery.js"
import { getServerForDirectory, getServerForSession, type ServerInfo } from "../discovery/index.js"

const OPENCODE_URL = process.env.NEXT_PUBLIC_OPENCODE_URL ?? "http://localhost:4056"

/**
 * SSR-specific async client factory that uses server discovery
 *
 * This function is for SERVER-SIDE RENDERING ONLY. It:
 * 1. Discovers servers directly via lsof (Node.js)
 * 2. Routes requests directly to server ports
 * 3. Falls back to OPENCODE_URL if discovery fails
 *
 * @param directory - Optional project directory for scoping
 * @param sessionId - Optional session ID for session-specific routing
 * @returns Promise<OpencodeClient>
 *
 * @example Server Component
 * ```tsx
 * import { createClientSSR } from "@opencode-vibe/core/client/server"
 *
 * export default async function Page() {
 *   const client = await createClientSSR()
 *   const projects = await client.project.list()
 *   return <div>{projects.data.length} projects</div>
 * }
 * ```
 */
export async function createClientSSR(
	directory?: string,
	sessionId?: string,
): Promise<OpencodeClient> {
	// Discover servers directly (Node.js - uses lsof)
	const discovered = await discoverServers()

	// Transform to ServerInfo format
	const servers: ServerInfo[] = discovered.map((server) => ({
		port: server.port,
		directory: server.directory,
		url: `http://127.0.0.1:${server.port}`,
	}))

	// No servers found - fallback to default
	if (servers.length === 0) {
		return createOpencodeClient({
			baseUrl: OPENCODE_URL,
			directory,
		})
	}

	// Route using same logic as client-side createClient
	let serverUrl: string

	if (sessionId && directory) {
		serverUrl = getServerForSession(sessionId, directory, servers)
	} else if (directory) {
		serverUrl = getServerForDirectory(directory, servers)
	} else {
		serverUrl = servers[0]?.url ?? OPENCODE_URL
	}

	return createOpencodeClient({
		baseUrl: serverUrl,
		directory,
	})
}

/**
 * Global SSR client promise for use in server components
 * Use this for global operations (no directory scoping) in SSR
 *
 * @example
 * ```tsx
 * import { globalClientSSR } from "@opencode-vibe/core/client/server"
 *
 * export default async function Page() {
 *   const client = await globalClientSSR
 *   const projects = await client.project.list()
 *   return <div>...</div>
 * }
 * ```
 */
export const globalClientSSR = createClientSSR()
