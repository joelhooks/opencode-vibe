/**
 * Server Discovery Tests (Node.js-only)
 *
 * Tests for lsof-based server discovery using Effect layers.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { Discovery, type DiscoveredServer } from "./types.js"

// Mock child_process exec
const mockExec = vi.fn()
vi.mock("node:child_process", () => ({
	exec: mockExec,
}))

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch as any

// Import after mocks are set up
const { DiscoveryNodeLive } = await import("./node.js")

describe("DiscoveryNodeLive", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("discovers servers from lsof output", async () => {
		// Mock lsof output
		const lsofOutput = `
12345 *:4056
12346 *:4057
`.trim()

		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(null, { stdout: lsofOutput, stderr: "" })
			return {} as any
		})

		// Mock verification requests
		mockFetch
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ worktree: "/Users/joel/Code/project1" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ worktree: "/Users/joel/Code/project2" }), {
					status: 200,
				}),
			)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))

		expect(servers).toEqual([
			{ port: 4056, pid: 12345, directory: "/Users/joel/Code/project1" },
			{ port: 4057, pid: 12346, directory: "/Users/joel/Code/project2" },
		])
	})

	test("handles empty lsof output", async () => {
		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(null, { stdout: "", stderr: "" })
			return {} as any
		})

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))
		expect(servers).toEqual([])
	})

	test("handles lsof command failure", async () => {
		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(new Error("lsof not found"), { stdout: "", stderr: "" })
			return {} as any
		})

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))
		expect(servers).toEqual([])
	})

	test("filters out invalid verification responses", async () => {
		const lsofOutput = `
12345 *:4056
12346 *:4057
12347 *:4058
`.trim()

		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(null, { stdout: lsofOutput, stderr: "" })
			return {} as any
		})

		// Mock verification - one succeeds, two fail
		mockFetch
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ worktree: "/Users/joel/Code/project1" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
			.mockRejectedValueOnce(new Error("Connection refused"))

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))

		expect(servers).toEqual([{ port: 4056, pid: 12345, directory: "/Users/joel/Code/project1" }])
	})

	test("rejects invalid directories", async () => {
		const lsofOutput = `
12345 *:4056
12346 *:4057
12347 *:4058
`.trim()

		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(null, { stdout: lsofOutput, stderr: "" })
			return {} as any
		})

		// Mock verification with invalid directories
		mockFetch
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ worktree: "/Users/joel/Code/project1" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ worktree: "/" }), { status: 200 })) // Root - invalid
			.mockResolvedValueOnce(new Response(JSON.stringify({ worktree: "" }), { status: 200 })) // Empty - invalid

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))

		expect(servers).toEqual([{ port: 4056, pid: 12345, directory: "/Users/joel/Code/project1" }])
	})

	test("deduplicates ports", async () => {
		// lsof can return same port multiple times (e.g., IPv4 + IPv6)
		const lsofOutput = `
12345 *:4056
12345 *:4056
12346 *:4057
`.trim()

		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(null, { stdout: lsofOutput, stderr: "" })
			return {} as any
		})

		mockFetch
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ worktree: "/Users/joel/Code/project1" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ worktree: "/Users/joel/Code/project2" }), {
					status: 200,
				}),
			)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))

		// Should only verify port 4056 once
		expect(mockFetch).toHaveBeenCalledTimes(2)
		expect(servers).toHaveLength(2)
	})

	test("handles grep exit code 1 (no matches)", async () => {
		// grep returns exit code 1 when no matches found - this is OK
		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			const error = new Error("grep exit code 1") as any
			error.stdout = ""
			callback(error, null)
			return {} as any
		})

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))
		expect(servers).toEqual([])
	})

	test("verifies with 500ms timeout", async () => {
		const lsofOutput = `12345 *:4056`

		mockExec.mockImplementation((cmd: any, options: any, callback: any) => {
			callback(null, { stdout: lsofOutput, stderr: "" })
			return {} as any
		})

		// Mock fetch that respects AbortController
		mockFetch.mockImplementation(
			(url: any, options: any) =>
				new Promise((resolve, reject) => {
					// Set up abort handler
					if (options?.signal) {
						options.signal.addEventListener("abort", () => {
							reject(new Error("Aborted"))
						})
					}
					// Never resolve - will be aborted by timeout
				}),
		)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const servers = await Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))

		// Should timeout and return empty (verification failed)
		expect(servers).toEqual([])
	})
})
