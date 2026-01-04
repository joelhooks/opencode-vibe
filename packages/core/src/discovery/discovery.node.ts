/**
 * Node.js Discovery Implementation
 *
 * CRITICAL: This file MUST be in a separate entry point to avoid
 * bundler including child_process in browser bundle.
 *
 * Uses lsof to discover running OpenCode servers by scanning for
 * bun/opencode processes listening on TCP ports.
 *
 * @module discovery/discovery.node
 */

import { Effect, Layer } from "effect"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { Discovery, type DiscoveredServer, type DiscoveryOptions } from "./types.js"

const execAsync = promisify(exec)

interface CandidatePort {
	port: number
	pid: number
}

/**
 * Verify a port is actually an opencode server and get its directory
 * Returns null if not a valid opencode server
 */
function verifyOpencodeServer(
	candidate: CandidatePort,
	options: DiscoveryOptions = {},
): Effect.Effect<DiscoveredServer | null> {
	return Effect.gen(function* () {
		const timeout = options.timeout ?? 500
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeout)

		try {
			const res = yield* Effect.tryPromise(() =>
				fetch(`http://127.0.0.1:${candidate.port}/project/current`, {
					signal: controller.signal,
				}),
			)
			clearTimeout(timeoutId)

			if (!res.ok) return null

			const project = yield* Effect.tryPromise(() => res.json())
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
				const sessionEffect = Effect.gen(function* () {
					const sessionController = new AbortController()
					const sessionTimeout = setTimeout(() => sessionController.abort(), 300)
					const sessionRes = yield* Effect.tryPromise(() =>
						fetch(`http://127.0.0.1:${candidate.port}/session`, {
							signal: sessionController.signal,
						}),
					)
					clearTimeout(sessionTimeout)

					if (sessionRes.ok) {
						const sessionList = yield* Effect.tryPromise(() => sessionRes.json())
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
				})

				// Session fetch is non-critical - ignore failures
				yield* Effect.catchAll(sessionEffect, () => Effect.succeed(undefined))
			}

			return server
		} catch {
			clearTimeout(timeoutId)
			return null
		}
	}).pipe(
		// Graceful degradation - verification failures return null
		Effect.catchAll(() => Effect.succeed(null)),
	)
}

/**
 * Run effects with limited concurrency
 */
function effectAllLimit<A>(effects: Effect.Effect<A>[], limit: number): Effect.Effect<A[]> {
	return Effect.gen(function* () {
		const results: A[] = []
		let index = 0

		const worker = Effect.gen(function* () {
			while (index < effects.length) {
				const currentIndex = index++
				const effect = effects[currentIndex]
				if (effect) {
					const result = yield* Effect.catchAll(effect, () => Effect.succeed(undefined as A))
					results[currentIndex] = result
				}
			}
		})

		yield* Effect.all(
			Array.from({ length: Math.min(limit, effects.length) }, () => worker),
			{ concurrency: "unbounded" },
		)

		return results
	})
}

/**
 * Node.js Discovery Layer
 *
 * Provides Discovery service using lsof for process scanning.
 * Use in Node.js/CLI environments.
 *
 * USAGE:
 * ```typescript
 * import { DiscoveryNodeLive } from "@opencode-vibe/core/discovery/node"
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* Discovery
 *   const servers = yield* discovery.discover({ includeSessions: true })
 *   console.log(servers)
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))
 * ```
 */
export const DiscoveryNodeLive: Layer.Layer<Discovery> = Layer.succeed(Discovery, {
	_tag: "Discovery" as const,
	/**
	 * Discover running OpenCode servers using lsof
	 */
	discover: (options?: DiscoveryOptions): Effect.Effect<DiscoveredServer[]> =>
		Effect.gen(function* () {
			// Find all listening TCP ports for bun/opencode processes
			const execResult = yield* Effect.tryPromise(() =>
				execAsync(
					`lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E 'bun|opencode' | awk '{print $2, $9}'`,
					{ timeout: 2000 },
				),
			).pipe(
				// lsof returns exit code 1 when grep finds no matches - that's OK
				Effect.catchAll((error: any) => {
					if (error.stdout !== undefined) {
						return Effect.succeed({ stdout: error.stdout || "" })
					}
					return Effect.fail(error)
				}),
			)

			const stdout = execResult.stdout

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
			const tasks = candidates.map((c) => verifyOpencodeServer(c, options))
			const results = yield* effectAllLimit(tasks, 5)
			return results.filter((s): s is DiscoveredServer => s !== null)
		}).pipe(
			// Graceful degradation - discovery failures return empty array
			Effect.catchAll(() => Effect.succeed([])),
		),
})
