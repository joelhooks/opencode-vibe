/**
 * Server Discovery API Route
 *
 * Discovers running opencode servers by scanning processes.
 * Uses shared discovery logic from @opencode-vibe/core/discovery/server.
 *
 * By default, includes sessions (IDs) and projects. Query params:
 * - includeSessions: "false" to exclude session IDs
 * - includeSessionDetails: "true" to include full session details (title, updatedAt)
 * - includeProjects: "false" to exclude project info
 *
 * Returns: { servers: [...], usage: {...} }
 */

import { Discovery, DiscoveryNodeLive } from "@opencode-vibe/core/discovery/server"
import { type NextRequest, NextResponse } from "next/server"
import { Effect } from "effect"

export async function GET(request: NextRequest) {
	const startTime = Date.now()
	const searchParams = request.nextUrl.searchParams

	// Sessions (IDs) and projects included by default, can be disabled with =false
	// Session details (title, updatedAt) opt-in only
	const includeSessions = searchParams.get("includeSessions") !== "false"
	const includeSessionDetails = searchParams.get("includeSessionDetails") === "true"
	const includeProjects = searchParams.get("includeProjects") !== "false"

	try {
		const servers = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* Discovery
				return yield* discovery.discover({
					includeSessions,
					includeSessionDetails,
					includeProjects,
				})
			}).pipe(Effect.provide(DiscoveryNodeLive)),
		)

		const duration = Date.now() - startTime
		if (duration > 500) {
			console.warn(`[opencode/servers] Slow discovery: ${duration}ms`)
		}

		return NextResponse.json(
			{
				servers,
				usage: {
					description:
						"Discovered OpenCode servers running on this machine (sessions IDs and projects included by default)",
					options: {
						includeSessions:
							"Sessions (IDs) included by default. Add ?includeSessions=false to exclude",
						includeSessionDetails:
							"Session details (title, updatedAt) opt-in. Add ?includeSessionDetails=true to include",
						includeProjects: "Projects included by default. Add ?includeProjects=false to exclude",
					},
					examples: {
						default: "/api/opencode/servers (sessions IDs + projects)",
						withDetails: "/api/opencode/servers?includeSessionDetails=true",
						minimal: "/api/opencode/servers?includeSessions=false&includeProjects=false",
					},
					routing: {
						byDirectory: "Match server.directory to route requests to correct port",
						bySession: "With includeSessions=true, match session ID to find its server",
					},
					endpoints: {
						proxy: "Use /api/opencode/{port}/... to proxy requests to a specific server",
						sessions: "GET /api/opencode/{port}/session for full session list",
						messages: "POST /api/opencode/{port}/session/{id}/message to send messages",
					},
				},
			},
			{
				headers: {
					"Cache-Control": "private, max-age=2",
				},
			},
		)
	} catch (error) {
		const duration = Date.now() - startTime
		console.error("[opencode/servers] Discovery failed:", {
			error: error instanceof Error ? error.message : String(error),
			duration: `${duration}ms`,
		})

		return NextResponse.json(
			{
				error: "Server discovery failed",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		)
	}
}
