/**
 * Server Discovery Logic
 *
 * Discovers running opencode servers by scanning processes.
 * Extracted from API route so it can be called directly during SSR
 * without causing self-fetch deadlock.
 */

import { exec } from "child_process"
import { promisify } from "util"
import type { DiscoveredServer, DiscoveredSession, DiscoveredProject } from "../types/events.js"

const execAsync = promisify(exec)

// Re-export canonical type
export type { DiscoveredServer }

/**
 * Options for server discovery
 */
export interface DiscoveryOptions {
	/** Include session IDs for each server */
	includeSessions?: boolean
	/** Include full session details (id, title, updatedAt) */
	includeSessionDetails?: boolean
	/** Include project info */
	includeProjects?: boolean
	/** Timeout for verification requests in ms (default: 500) */
	timeout?: number
}

interface CandidatePort {
	port: number
	pid: number
}

/**
 * Verify a port is actually an opencode server and get its directory
 * Returns null if not a valid opencode server
 */
async function verifyOpencodeServer(
	candidate: CandidatePort,
	options: DiscoveryOptions = {},
): Promise<DiscoveredServer | null> {
	const timeout = options.timeout ?? 500
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeout)

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

		const server: DiscoveredServer = {
			port: candidate.port,
			pid: candidate.pid,
			directory,
		}

		// Optionally include project info
		if (options.includeProjects) {
			server.project = {
				id: project.id || "unknown",
				directory,
				name: directory.split("/").pop() || directory,
			}
		}

		// Optionally fetch sessions
		if (options.includeSessions || options.includeSessionDetails) {
			try {
				const sessionController = new AbortController()
				const sessionTimeout = setTimeout(() => sessionController.abort(), 300)
				const sessionRes = await fetch(`http://127.0.0.1:${candidate.port}/session`, {
					signal: sessionController.signal,
				})
				clearTimeout(sessionTimeout)

				if (sessionRes.ok) {
					const sessionList = await sessionRes.json()
					if (Array.isArray(sessionList)) {
						// Always include IDs if either option is set
						server.sessions = sessionList.map((s: { id: string }) => s.id)

						// Include full details if requested
						if (options.includeSessionDetails) {
							server.sessionDetails = sessionList.map(
								(s: { id: string; title?: string; time?: { updated?: number } }) => ({
									id: s.id,
									title: s.title || "Untitled",
									updatedAt: s.time?.updated || 0,
								}),
							)
						}
					}
				}
			} catch {
				// Session fetch failed - not critical, continue without sessions
			}
		}

		return server
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

/**
 * Discover all running OpenCode servers
 * Can be called directly during SSR without HTTP self-fetch
 *
 * @param options - Discovery options
 * @param options.includeSessions - Fetch session IDs for each server (default: false)
 * @param options.timeout - Verification timeout in ms (default: 500)
 */
export async function discoverServers(options: DiscoveryOptions = {}): Promise<DiscoveredServer[]> {
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
		const tasks = candidates.map((c) => () => verifyOpencodeServer(c, options))
		const results = await promiseAllSettledLimit(tasks, 5)
		return results.filter((s): s is DiscoveredServer => s !== null)
	} catch {
		return []
	}
}
