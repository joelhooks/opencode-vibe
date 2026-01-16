/**
 * Server Discovery API Route
 *
 * Discovers running opencode servers by scanning processes.
 * Uses lsof to find processes listening on ports with "bun" or "opencode" in the command.
 * Verifies each candidate by hitting /project endpoint and captures the directory.
 *
 * Returns: Array<{ port: number; pid: number; directory: string }>
 *
 * This enables routing messages to the correct server based on directory!
 *
 * Performance optimizations:
 * - Parallel verification of all candidate ports
 * - 2s timeout on lsof command
 * - 300ms timeout on each verification request
 * - Results cached for 2s via Cache-Control header
 */

import { exec } from "child_process"
import { NextResponse } from "next/server"
import { promisify } from "util"
import {
	addServer,
	type ManualServer,
	readRegistry,
	removeServer,
	verifyManualServer,
} from "@/lib/manual-server-registry"

const execAsync = promisify(exec)

interface DiscoveredServer {
	port: number
	pid: number
	directory: string
	sessions?: string[] // Session IDs hosted by this server
	source: "local" | "manual"
	url?: string
	name?: string
	proxyPort?: number
}

interface CandidatePort {
	port: number
	pid: number
}

/**
 * Verify a port is actually an opencode server and get its directory + sessions
 * Returns null if not a valid opencode server
 */
async function verifyOpencodeServer(candidate: CandidatePort): Promise<DiscoveredServer | null> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), 500)

	try {
		// Fetch project info
		const res = await fetch(`http://127.0.0.1:${candidate.port}/project/current`, {
			signal: controller.signal,
		})
		clearTimeout(timeoutId)

		if (!res.ok) return null

		const project = await res.json()
		const directory = project.worktree

		if (!directory || directory === "/" || directory.length <= 1) {
			return null
		}

		// Fetch session list
		let sessions: string[] | undefined
		try {
			const sessionTimeout = setTimeout(() => controller.abort(), 300)
			const sessionRes = await fetch(`http://127.0.0.1:${candidate.port}/session`, {
				signal: controller.signal,
			})
			clearTimeout(sessionTimeout)

			if (sessionRes.ok) {
				const sessionList = await sessionRes.json()
				sessions = Array.isArray(sessionList)
					? sessionList.map((s: { id: string }) => s.id)
					: undefined
			}
		} catch {
			// Session fetch failed - not critical, continue without sessions
			sessions = undefined
		}

		return {
			port: candidate.port,
			pid: candidate.pid,
			directory,
			sessions,
			source: "local",
		}
	} catch {
		clearTimeout(timeoutId)
		return null
	}
}

async function verifyAndTransformManualServers(
	manualServers: ManualServer[],
): Promise<DiscoveredServer[]> {
	const results = await Promise.all(
		manualServers.map(async (server) => {
			const verified = await verifyManualServer(server, 2000)
			if (!verified) return null

			const resolvedServer: DiscoveredServer = {
				port: verified.proxyPort,
				pid: 0,
				directory: verified.directory,
				sessions: verified.sessions,
				source: "manual" as const,
				url: server.url,
				name: server.name,
				proxyPort: verified.proxyPort,
			}
			return resolvedServer
		}),
	)

	return results.filter((s) => s !== null)
}

/**
 * Run promises with limited concurrency
 */
async function promiseAllSettledLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
	const results: T[] = []
	let index = 0

	async function worker() {
		while (index < tasks.length) {
			const currentIndex = index++
			const task = tasks[currentIndex]
			if (task) {
				try {
					results[currentIndex] = await task()
				} catch {
					// Swallow errors, results[currentIndex] stays undefined
				}
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
	return results
}

export async function GET() {
	const startTime = Date.now()

	try {
		const [localServers, manualServers] = await Promise.all([
			discoverLocalServers(),
			discoverManualServers(),
		])

		const servers = [...localServers, ...manualServers]

		const duration = Date.now() - startTime
		if (duration > 500) {
			console.warn(`[opencode/servers] Slow discovery: ${duration}ms`)
		}

		return NextResponse.json(servers, {
			headers: {
				"Cache-Control": "private, max-age=2",
			},
		})
	} catch (error) {
		const duration = Date.now() - startTime
		console.error("[opencode/servers] Discovery failed:", {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			duration: `${duration}ms`,
		})

		return NextResponse.json(
			{
				error: "Server discovery failed",
				message: error instanceof Error ? error.message : "Unknown error",
				duration: `${duration}ms`,
			},
			{ status: 500 },
		)
	}
}

async function discoverLocalServers(): Promise<DiscoveredServer[]> {
	const { stdout } = await execAsync(
		`lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E 'bun|opencode' | awk '{print $2, $9}'`,
		{ timeout: 2000 },
	).catch((error) => {
		if (error.stdout !== undefined) {
			return { stdout: error.stdout || "" }
		}
		console.error("[opencode/servers] lsof failed:", error.message)
		throw error
	})

	const candidates: CandidatePort[] = []
	const seen = new Set<number>()

	for (const line of stdout.trim().split("\n")) {
		if (!line) continue
		const [pid, address] = line.split(" ")
		const portMatch = address?.match(/:(\d+)$/)
		if (!portMatch) continue

		const port = parseInt(portMatch[1], 10)
		if (seen.has(port)) continue
		seen.add(port)

		candidates.push({ port, pid: parseInt(pid, 10) })
	}

	const tasks = candidates.map((c) => () => verifyOpencodeServer(c))
	const results = await promiseAllSettledLimit(tasks, 5)
	return results.filter((s): s is DiscoveredServer => s !== null)
}

async function discoverManualServers(): Promise<DiscoveredServer[]> {
	const manualServers = await readRegistry()
	return verifyAndTransformManualServers(manualServers)
}

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const { url, name } = body as { url?: string; name?: string }

		if (!url) {
			return NextResponse.json({ error: "url is required" }, { status: 400 })
		}

		const server = await addServer(url, name)

		return NextResponse.json(
			{
				url: server.url,
				name: server.name,
				proxyPort: server.proxyPort,
				addedAt: server.addedAt,
			},
			{ status: 201 },
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error"

		if (message.includes("already registered") || message.includes("Invalid URL")) {
			return NextResponse.json({ error: message }, { status: 400 })
		}

		console.error("[opencode/servers] POST failed:", error)
		return NextResponse.json({ error: message }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const url = searchParams.get("url")

		if (!url) {
			return NextResponse.json({ error: "url query param is required" }, { status: 400 })
		}

		const removed = await removeServer(url)

		if (!removed) {
			return NextResponse.json({ error: "Server not found" }, { status: 404 })
		}

		return new NextResponse(null, { status: 204 })
	} catch (error) {
		console.error("[opencode/servers] DELETE failed:", error)
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Unknown error" },
			{ status: 500 },
		)
	}
}
