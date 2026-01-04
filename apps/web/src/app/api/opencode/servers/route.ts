/**
 * Server Discovery API Route
 *
 * Discovers running opencode servers by scanning processes.
 * Uses shared discovery logic from @opencode-vibe/core/discovery/server.
 *
 * Query params:
 * - includeSessions: "true" to fetch session IDs for each server
 * - includeSessionDetails: "true" to fetch full session details (id, title, updatedAt)
 * - includeProjects: "true" to fetch project info (id, directory, name)
 *
 * Returns: { servers: [...], usage: {...} }
 */

import { discoverServers } from "@opencode-vibe/core/discovery/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
	const startTime = Date.now()
	const searchParams = request.nextUrl.searchParams
	const includeSessions = searchParams.get("includeSessions") === "true"
	const includeSessionDetails = searchParams.get("includeSessionDetails") === "true"
	const includeProjects = searchParams.get("includeProjects") === "true"

	try {
		const servers = await discoverServers({
			includeSessions,
			includeSessionDetails,
			includeProjects,
		})

		const duration = Date.now() - startTime
		if (duration > 500) {
			console.warn(`[opencode/servers] Slow discovery: ${duration}ms`)
		}

		return NextResponse.json(
			{
				servers,
				usage: {
					description: "Discovered OpenCode servers running on this machine",
					options: {
						includeSessions:
							"Add ?includeSessions=true to get session IDs per server (adds sessions: string[])",
						includeSessionDetails:
							"Add ?includeSessionDetails=true to get full session info (adds sessionDetails: { id, title, updatedAt }[])",
						includeProjects:
							"Add ?includeProjects=true to get project info (adds project: { id, directory, name })",
					},
					examples: {
						basic: "/api/opencode/servers",
						withSessions: "/api/opencode/servers?includeSessions=true",
						withDetails: "/api/opencode/servers?includeSessionDetails=true",
						withProjects: "/api/opencode/servers?includeProjects=true",
						combined: "/api/opencode/servers?includeSessionDetails=true&includeProjects=true",
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
