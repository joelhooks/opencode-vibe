import { notFound } from "next/navigation"
import { createClientSSR } from "@opencode-vibe/core/ssr"
import { AgentDebugJson } from "./agent-debug-json"
import { Effect } from "effect"
import { Discovery } from "@opencode-vibe/core/discovery"
import { DiscoveryNodeLive } from "@opencode-vibe/core/world/discovery/node"
import { SSRConfigInjector } from "../ssr-config-injector"

interface Props {
	params: Promise<{ id: string }>
	searchParams: Promise<{ dir?: string }>
}

// OpencodeInstance type for SSR plugin
interface OpencodeInstance {
	port: number
	directory: string
	baseUrl: string
}

/**
 * Discover OpenCode servers for SSR (NOT cached - used for initial instances)
 */
async function discoverServers(): Promise<OpencodeInstance[]> {
	try {
		const servers = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* Discovery
				return yield* discovery.discover()
			}).pipe(Effect.provide(DiscoveryNodeLive)),
		)

		// Convert DiscoveredServer[] to OpencodeInstance[] for client
		// Use browser proxy URLs since client will connect through Next.js
		return servers.map((server) => ({
			port: server.port,
			directory: server.directory,
			baseUrl: `/api/opencode/${server.port}`,
		}))
	} catch (error) {
		console.warn("[SSR] Discovery failed:", error)
		return []
	}
}

/**
 * Agent Debug Page - Server Component
 *
 * Returns machine-readable JSON debug info for AI agents.
 * Server component handles discovery/bootstrap, client component uses hooks.
 *
 * ARCHITECTURE:
 * - Server: Bootstraps session, validates it exists, discovers instances
 * - Client: Uses World Stream hooks to gather real-time state
 * - Output: JSON formatted in <pre> for copy/paste
 *
 * CRITICAL: Must await searchParams BEFORE calling discoverServers() to mark route as dynamic.
 * Even creating a promise without awaiting it CALLS the function, which runs Effect code
 * that uses Date.now() at initialization time, causing Next.js 16 prerendering error.
 *
 * @example
 * GET /session/{sessionId}/agent-debug?dir=/path/to/project
 */
export default async function AgentDebugPage({ params, searchParams }: Props) {
	// AWAIT searchParams FIRST - this marks route as dynamic BEFORE any Date.now() calls
	console.log("[agent-debug SSR] Resolving search params")
	const resolvedSearchParams = await searchParams
	console.log("[agent-debug SSR] Resolved search params:", resolvedSearchParams)
	const { id: sessionId } = await params
	console.log("[agent-debug SSR] Resolved params:", sessionId)

	// NOW we can safely call discoverServers (which uses Effect/Date.now internally)
	const discoveredInstances = await discoverServers()
	console.log("[agent-debug SSR] Discovered instances for client:", discoveredInstances)

	// Bootstrap: verify session exists via SSR client
	try {
		const client = await createClientSSR(resolvedSearchParams.dir)
		const result = await client.session.get({ path: { id: sessionId } })

		if (!result.data) {
			notFound()
		}

		// Session exists, render with config injector
		return (
			<>
				{/* Pass resolved values directly to client component */}
				<SSRConfigInjector
					searchParamsPromise={searchParams}
					discoveredInstancesPromise={Promise.resolve(discoveredInstances)}
				/>
				<AgentDebugJson sessionId={sessionId} directory={resolvedSearchParams.dir || ""} />
			</>
		)
	} catch (error) {
		console.error(`[agent-debug] Failed to bootstrap session ${sessionId}:`, error)
		notFound()
	}
}
