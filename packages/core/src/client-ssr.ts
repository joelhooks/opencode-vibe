/**
 * Server-Side Rendering (SSR) client utilities
 *
 * This module uses Node.js-specific discovery (DiscoveryNodeLive).
 * Only import from:
 * - Server Components
 * - API Routes
 * - CLI tools
 *
 * DO NOT import from client components or browser code.
 *
 * @module client-ssr
 */

import { Effect } from "effect"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"
import {
	Discovery,
	getServerForDirectory,
	getServerForSession,
	type ServerInfo,
} from "./discovery/index.js"
import { DiscoveryNodeLive } from "./discovery/server.js"
import { OPENCODE_URL } from "./client/client.js"

export type { OpencodeClient }

/**
 * Create an OpenCode SDK client for Server-Side Rendering (SSR)
 *
 * Uses DiscoveryNodeLive (Node.js lsof) for direct server discovery.
 * This function is for SERVER-SIDE RENDERING ONLY (Next.js Server Components, API routes, CLI).
 *
 * @param directory - Optional project directory for scoping
 * @param sessionId - Optional session ID for session-specific routing
 * @returns Promise<OpencodeClient>
 *
 * @example Server Component
 * ```tsx
 * import { createClientSSR } from "@opencode-vibe/core"
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
	// Discover servers using Node.js lsof
	const servers = await Effect.runPromise(
		Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		}).pipe(Effect.provide(DiscoveryNodeLive)),
	)

	// No servers found - fallback to default
	if (servers.length === 0) {
		return createOpencodeClient({
			baseUrl: OPENCODE_URL,
			directory,
		})
	}

	// Convert to ServerInfo format for routing logic
	const serverInfos: ServerInfo[] = servers.map((server) => ({
		port: server.port,
		directory: server.directory,
		url: `http://127.0.0.1:${server.port}`,
	}))

	// Route using same logic as client-side createClient
	let serverUrl: string

	if (sessionId && directory) {
		serverUrl = getServerForSession(sessionId, directory, serverInfos)
	} else if (directory) {
		serverUrl = getServerForDirectory(directory, serverInfos)
	} else {
		serverUrl = serverInfos[0]?.url ?? OPENCODE_URL
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
 * import { globalClientSSR } from "@opencode-vibe/core"
 *
 * export default async function Page() {
 *   const client = await globalClientSSR
 *   const projects = await client.project.list()
 *   return <div>...</div>
 * }
 * ```
 */
export const globalClientSSR = createClientSSR()
