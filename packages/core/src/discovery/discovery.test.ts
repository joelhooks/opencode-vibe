/**
 * Discovery Browser Layer Tests
 *
 * TDD - Tests written first, then implementation.
 *
 * Tests the DiscoveryBrowserLive layer implementation:
 * - Fetch from /api/opencode/servers with DiscoveryOptions as query params
 * - Transform to DiscoveredServer[]
 * - Graceful degradation on errors
 * - Support all DiscoveryOptions
 *
 * CHARACTERIZATION TESTS for Schedule.repeat polling loop:
 * - Polling interval timing
 * - Graceful shutdown on dispose
 * - Error handling and recovery
 */

import { describe, expect, test } from "vitest"
import { Effect, Schedule, Duration, TestClock, TestContext, Fiber } from "effect"
import { Discovery, type DiscoveredServer } from "./types.js"
import { DiscoveryBrowserLive, makeTestLayer } from "./discovery.js"

describe("Discovery Browser - One-shot discovery", () => {
	test("discover() returns servers from API", async () => {
		// Mock API response
		const mockFetch = async () =>
			Response.json([
				{ port: 4056, pid: 12345, directory: "/Users/joel/Code/project1" },
				{ port: 4057, pid: 12346, directory: "/Users/joel/Code/project2" },
			])

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([
			{
				port: 4056,
				pid: 12345,
				directory: "/Users/joel/Code/project1",
			},
			{
				port: 4057,
				pid: 12346,
				directory: "/Users/joel/Code/project2",
			},
		])
	})

	test("discover() returns empty array on fetch failure", async () => {
		// Mock fetch failure
		const mockFetch = async () => {
			throw new Error("Network error")
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([])
	})

	test("discover() returns empty array on non-ok response", async () => {
		// Mock 500 error
		const mockFetch = async () => new Response("Internal Server Error", { status: 500 })

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([])
	})

	test("discover() returns empty array on invalid JSON", async () => {
		// Mock invalid JSON response
		const mockFetch = async () => new Response("not json", { status: 200 })

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([])
	})

	test("discover() handles empty array response", async () => {
		// Mock empty array
		const mockFetch = async () => Response.json([])

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([])
	})

	test("discover() calls correct endpoint", async () => {
		let calledUrl: string | undefined

		const mockFetch = async (input: RequestInfo | URL) => {
			calledUrl = input.toString()
			return Response.json([])
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(calledUrl).toBe("/api/opencode/servers")
	})

	test("discover() filters out servers with invalid data", async () => {
		// Mock response with invalid entries
		const mockFetch = async () =>
			Response.json([
				{ port: 4056, pid: 12345, directory: "/Users/joel/Code/project1" },
				{ port: "invalid", pid: 12346, directory: "/Users/joel/Code/project2" }, // Invalid port
				{ port: 4058, directory: "/Users/joel/Code/project3" }, // Missing pid - INVALID
				{ port: 4059, pid: 12348 }, // Missing directory - INVALID
			])

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover()
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([
			{
				port: 4056,
				pid: 12345,
				directory: "/Users/joel/Code/project1",
			},
		])
	})
})

describe("Discovery Browser - DiscoveryOptions support", () => {
	test("passes includeSessions as query param", async () => {
		let calledUrl: string | undefined

		const mockFetch = async (input: RequestInfo | URL) => {
			calledUrl = input.toString()
			return Response.json([])
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover({ includeSessions: true })
		})

		const testLayer = makeTestLayer(mockFetch as any)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(calledUrl).toBe("/api/opencode/servers?includeSessions=true")
	})

	test("passes includeSessionDetails as query param", async () => {
		let calledUrl: string | undefined

		const mockFetch = async (input: RequestInfo | URL) => {
			calledUrl = input.toString()
			return Response.json([])
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover({ includeSessionDetails: true })
		})

		const testLayer = makeTestLayer(mockFetch as any)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(calledUrl).toBe("/api/opencode/servers?includeSessionDetails=true")
	})

	test("passes includeProjects as query param", async () => {
		let calledUrl: string | undefined

		const mockFetch = async (input: RequestInfo | URL) => {
			calledUrl = input.toString()
			return Response.json([])
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover({ includeProjects: true })
		})

		const testLayer = makeTestLayer(mockFetch as any)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(calledUrl).toBe("/api/opencode/servers?includeProjects=true")
	})

	test("passes timeout as query param", async () => {
		let calledUrl: string | undefined

		const mockFetch = async (input: RequestInfo | URL) => {
			calledUrl = input.toString()
			return Response.json([])
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover({ timeout: 1000 })
		})

		const testLayer = makeTestLayer(mockFetch as any)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(calledUrl).toBe("/api/opencode/servers?timeout=1000")
	})

	test("passes multiple options as query params", async () => {
		let calledUrl: string | undefined

		const mockFetch = async (input: RequestInfo | URL) => {
			calledUrl = input.toString()
			return Response.json([])
		}

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover({
				includeSessions: true,
				includeProjects: true,
				timeout: 500,
			})
		})

		const testLayer = makeTestLayer(mockFetch as any)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(calledUrl).toBe(
			"/api/opencode/servers?includeSessions=true&includeProjects=true&timeout=500",
		)
	})

	test("returns servers with optional metadata when requested", async () => {
		const mockFetch = async () =>
			Response.json([
				{
					port: 4056,
					pid: 12345,
					directory: "/Users/joel/Code/project1",
					sessions: ["sess-1", "sess-2"],
					sessionDetails: [
						{ id: "sess-1", title: "Session 1", updatedAt: 1000 },
						{ id: "sess-2", title: "Session 2", updatedAt: 2000 },
					],
					project: {
						id: "proj-1",
						directory: "/Users/joel/Code/project1",
						name: "project1",
					},
				},
			])

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			return yield* discovery.discover({
				includeSessions: true,
				includeSessionDetails: true,
				includeProjects: true,
			})
		})

		const testLayer = makeTestLayer(mockFetch as any)
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		expect(result).toEqual([
			{
				port: 4056,
				pid: 12345,
				directory: "/Users/joel/Code/project1",
				sessions: ["sess-1", "sess-2"],
				sessionDetails: [
					{ id: "sess-1", title: "Session 1", updatedAt: 1000 },
					{ id: "sess-2", title: "Session 2", updatedAt: 2000 },
				],
				project: {
					id: "proj-1",
					directory: "/Users/joel/Code/project1",
					name: "project1",
				},
			},
		])
	})
})

// ============================================================================
// CHARACTERIZATION TESTS: Schedule.repeat polling loop
// ============================================================================

describe("Discovery Browser - Polling Loop (Schedule.repeat)", () => {
	/**
	 * Test 1: Polling interval timing
	 *
	 * CURRENT PATTERN (world/sse.ts):
	 * while (running) {
	 *   // discover
	 *   yield* Effect.sleep(intervalMs)
	 * }
	 *
	 * TARGET PATTERN:
	 * discovery.discover().pipe(
	 *   Effect.repeat(Schedule.spaced(Duration.millis(intervalMs)))
	 * )
	 */
	test("polls at configured interval using Schedule.spaced", async () => {
		let callCount = 0
		const calls: number[] = []

		const mockFetch = async () => {
			callCount++
			calls.push(Date.now())
			return Response.json([])
		}

		const testLayer = makeTestLayer(mockFetch as any)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery

			// Poll with 100ms interval, collect 3 calls using recurs(2) for 2 repeats
			yield* discovery.discover().pipe(
				Effect.repeat(
					Schedule.spaced(Duration.millis(100)).pipe(
						Schedule.intersect(Schedule.recurs(2)), // Initial + 2 repeats = 3 total
					),
				),
			)

			return callCount
		})

		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		// Should have called discover 3 times (initial + 2 repeats)
		expect(result).toBe(3)
		expect(callCount).toBe(3)

		// Verify timing: calls should be ~100ms apart
		if (calls.length >= 3) {
			const interval1 = calls[1]! - calls[0]!
			const interval2 = calls[2]! - calls[1]!

			// Allow 50ms tolerance for test timing
			expect(interval1).toBeGreaterThanOrEqual(90)
			expect(interval1).toBeLessThanOrEqual(150)
			expect(interval2).toBeGreaterThanOrEqual(90)
			expect(interval2).toBeLessThanOrEqual(150)
		}
	})

	/**
	 * Test 2: Graceful shutdown on dispose
	 *
	 * CURRENT PATTERN:
	 * - Sets running = false
	 * - while(running) exits naturally
	 * - Fiber.interrupt cleans up
	 *
	 * TARGET PATTERN:
	 * - Effect.repeat is interruptible
	 * - Fiber.interrupt stops the loop
	 */
	test("stops polling when fiber is interrupted", async () => {
		let callCount = 0

		const mockFetch = async () => {
			callCount++
			return Response.json([])
		}

		const testLayer = makeTestLayer(mockFetch as any)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery

			// Start infinite polling loop
			const pollEffect = discovery
				.discover()
				.pipe(Effect.repeat(Schedule.spaced(Duration.millis(50))))

			// Run in fiber so we can interrupt it
			const fiber = yield* Effect.fork(pollEffect)

			// Let it run for ~150ms (should call 3-4 times)
			yield* Effect.sleep(Duration.millis(150))

			// Interrupt the fiber
			yield* Fiber.interrupt(fiber)

			return callCount
		})

		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		// Should have called 3-4 times before interruption
		expect(result).toBeGreaterThanOrEqual(3)
		expect(result).toBeLessThanOrEqual(5)

		// Wait a bit more - call count should not increase after interrupt
		const callCountAfter = callCount
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect(callCount).toBe(callCountAfter)
	})

	/**
	 * Test 3: Error handling - continues polling after errors
	 *
	 * CURRENT PATTERN:
	 * discoverServers().pipe(
	 *   Effect.catchAll(() => Effect.succeed([]))
	 * )
	 * - Swallows errors, returns empty array
	 * - Loop continues
	 *
	 * TARGET PATTERN:
	 * - Same graceful degradation
	 * - Effect.repeat continues even if individual calls fail
	 */
	test("continues polling after discovery errors", async () => {
		let callCount = 0
		const errors: Error[] = []

		const mockFetch = async () => {
			callCount++
			// Fail first 2 calls, succeed on 3rd
			if (callCount <= 2) {
				const error = new Error(`Network error ${callCount}`)
				errors.push(error)
				throw error
			}
			return Response.json([{ port: 4056, pid: 99999, directory: "/test" }])
		}

		const testLayer = makeTestLayer(mockFetch as any)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery
			const results: DiscoveredServer[][] = []

			// Poll 3 times, collecting results
			yield* discovery.discover().pipe(
				Effect.tap((servers) => Effect.sync(() => results.push(servers))),
				Effect.repeat(Schedule.intersect(Schedule.spaced(Duration.millis(50)), Schedule.recurs(2))),
			)

			return results
		})

		const results = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		// Should have made 3 calls
		expect(callCount).toBe(3)

		// First 2 should return empty array (error caught)
		expect(results[0]).toEqual([])
		expect(results[1]).toEqual([])

		// Third should return server
		expect(results[2]).toEqual([
			{
				port: 4056,
				pid: 99999,
				directory: "/test",
			},
		])
	})

	/**
	 * Test 4: Composable schedules - exponential backoff
	 *
	 * TARGET PATTERN:
	 * Schedule.exponential(1s) |> Schedule.either(Schedule.spaced(30s))
	 */
	test("supports composable retry schedules", async () => {
		let callCount = 0

		const mockFetch = async () => {
			callCount++
			return Response.json([])
		}

		const testLayer = makeTestLayer(mockFetch as any)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery

			// Exponential: 100ms, 200ms, 400ms, capped at 500ms
			const schedule = Schedule.exponential(Duration.millis(100)).pipe(
				Schedule.either(Schedule.spaced(Duration.millis(500))),
				Schedule.intersect(Schedule.recurs(3)), // 4 calls total (initial + 3 repeats)
			)

			yield* discovery.discover().pipe(Effect.repeat(schedule))

			return callCount
		})

		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))

		// Should have called 4 times (initial + 3 repeats)
		expect(result).toBe(4)
	})

	/**
	 * Test 5: TestClock for deterministic timing tests
	 *
	 * Use Effect's TestClock to avoid flaky timing tests
	 */
	test("uses TestClock for deterministic interval testing", async () => {
		let callCount = 0

		const mockFetch = async () => {
			callCount++
			return Response.json([])
		}

		const testLayer = makeTestLayer(mockFetch as any)

		const program = Effect.gen(function* () {
			const discovery = yield* Discovery

			// Start polling with 1 second interval
			const pollEffect = discovery
				.discover()
				.pipe(Effect.repeat(Schedule.spaced(Duration.seconds(1))))

			const fiber = yield* Effect.fork(pollEffect)

			// Advance test clock by 3 seconds
			yield* TestClock.adjust(Duration.seconds(3))

			yield* Fiber.interrupt(fiber)

			return callCount
		})

		const result = await Effect.runPromise(
			program.pipe(Effect.provide(testLayer), Effect.provide(TestContext.TestContext)),
		)

		// With TestClock, exactly 4 calls (t=0, t=1, t=2, t=3)
		expect(result).toBe(4)
	})
})
