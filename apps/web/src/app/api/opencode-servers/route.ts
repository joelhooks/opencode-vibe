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
import { promisify } from "util"
import { NextResponse } from "next/server"

const execAsync = promisify(exec)

interface DiscoveredServer {
	port: number
	pid: number
	directory: string
}

interface CandidatePort {
	port: number
	pid: number
}

/**
 * Verify a port is actually an opencode server and get its directory
 * Returns null if not a valid opencode server
 */
async function verifyOpencodeServer(candidate: CandidatePort): Promise<DiscoveredServer | null> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), 500)

	try {
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

		return {
			port: candidate.port,
			pid: candidate.pid,
			directory,
		}
	} catch {
		clearTimeout(timeoutId)
		return null
	}
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
			try {
				results[currentIndex] = await tasks[currentIndex]()
			} catch {
				// Swallow errors, results[currentIndex] stays undefined
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
	return results
}

export async function GET() {
	const startTime = Date.now()

	try {
		// Find all listening TCP ports for bun/opencode processes
		const { stdout } = await execAsync(
			`lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E 'bun|opencode' | awk '{print $2, $9}'`,
			{ timeout: 2000 },
		).catch((error) => {
			// lsof returns exit code 1 when grep finds no matches - that's OK
			if (error.stdout !== undefined) {
				return { stdout: error.stdout || "" }
			}
			console.error("[opencode-servers] lsof failed:", error.message)
			throw error
		})

		// Parse candidates
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

		// Verify candidates with limited concurrency (max 5 at a time)
		const tasks = candidates.map((c) => () => verifyOpencodeServer(c))
		const results = await promiseAllSettledLimit(tasks, 5)
		const servers = results.filter((s): s is DiscoveredServer => s !== null)

		const duration = Date.now() - startTime
		if (duration > 500) {
			console.warn(
				`[opencode-servers] Slow discovery: ${duration}ms for ${candidates.length} candidates`,
			)
		}

		return NextResponse.json(servers, {
			headers: {
				"Cache-Control": "private, max-age=2",
			},
		})
	} catch (error) {
		const duration = Date.now() - startTime
		console.error("[opencode-servers] Discovery failed:", {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			duration: `${duration}ms`,
		})

		// Return 500 with error details in dev
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
