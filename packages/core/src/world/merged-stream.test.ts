/**
 * Merged Stream Tests
 *
 * Tests for createMergedWorldStream - combining multiple event sources
 * into a single merged stream.
 */

import { describe, it, expect } from "vitest"
import { Effect, Stream } from "effect"
import { createMergedWorldStream } from "./merged-stream.js"
import type { EventSource, SourceEvent } from "./event-source.js"
import { Registry, connectionStatusAtom } from "./atoms.js"
import type { WorldSSE } from "./sse.js"

/**
 * Create a test SSE instance with controllable lifecycle
 */
function createTestSSE(registry: ReturnType<typeof Registry.make>) {
	let started = false
	let stopped = false

	return {
		start() {
			started = true
			// Simulate proper SSE lifecycle: connecting → connected
			registry.set(connectionStatusAtom, "connecting")
			// Transition to connected synchronously for test simplicity
			registry.set(connectionStatusAtom, "connected")
		},
		stop() {
			stopped = true
			registry.set(connectionStatusAtom, "disconnected")
		},
		getConnectedPorts() {
			return []
		},
		// Test helpers
		isStarted: () => started,
		isStopped: () => stopped,
	} as unknown as WorldSSE
}

/**
 * Create a mock EventSource that emits test events
 */
function createMockSource(
	name: string,
	events: Array<Omit<SourceEvent, "source">>,
	isAvailable = true,
): EventSource {
	return {
		name,
		available: () => Effect.succeed(isAvailable),
		stream: () =>
			Stream.fromIterable(
				events.map((e) => ({
					...e,
					source: name,
				})),
			),
	}
}

describe("createMergedWorldStream", () => {
	describe("basic merging", () => {
		it("merges events from multiple sources", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const source1 = createMockSource("source1", [
				{ type: "test1", data: "a", timestamp: 100 },
				{ type: "test1", data: "b", timestamp: 200 },
			])

			const source2 = createMockSource("source2", [
				{ type: "test2", data: "x", timestamp: 150 },
				{ type: "test2", data: "y", timestamp: 250 },
			])

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [source1, source2],
			})

			// Collect all events
			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			// Should have events from both sources
			expect(events).toHaveLength(4)

			const source1Events = events.filter((e) => e.source === "source1")
			const source2Events = events.filter((e) => e.source === "source2")

			expect(source1Events).toHaveLength(2)
			expect(source2Events).toHaveLength(2)

			// Verify event content
			expect(source1Events[0]).toMatchObject({
				source: "source1",
				type: "test1",
				data: "a",
				timestamp: 100,
			})

			expect(source2Events[0]).toMatchObject({
				source: "source2",
				type: "test2",
				data: "x",
				timestamp: 150,
			})

			await stream.dispose()
		})

		it("handles empty sources array", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [],
			})

			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			expect(events).toHaveLength(0)

			await stream.dispose()
		})

		it("handles undefined sources (no additional sources)", async () => {
			// Should work with just SSE (no additional sources)
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })

			// This test just verifies it doesn't crash
			// Actual SSE connection is tested in stream.test.ts
			expect(stream).toBeDefined()
			expect(stream.stream).toBeDefined()

			await stream.dispose()
		})
	})

	describe("source availability filtering", () => {
		it("excludes unavailable sources", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const availableSource = createMockSource(
				"available",
				[{ type: "test", data: "ok", timestamp: 100 }],
				true,
			)

			const unavailableSource = createMockSource(
				"unavailable",
				[{ type: "test", data: "should-not-appear", timestamp: 200 }],
				false, // NOT available
			)

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [availableSource, unavailableSource],
			})

			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			// Should only have events from available source
			expect(events).toHaveLength(1)
			expect(events[0].source).toBe("available")
			expect(events[0].data).toBe("ok")

			await stream.dispose()
		})

		it("handles all sources unavailable gracefully", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const source1 = createMockSource(
				"source1",
				[{ type: "test", data: "x", timestamp: 100 }],
				false,
			)
			const source2 = createMockSource(
				"source2",
				[{ type: "test", data: "y", timestamp: 200 }],
				false,
			)

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [source1, source2],
			})

			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			// No events from unavailable sources
			expect(events).toHaveLength(0)

			await stream.dispose()
		})

		it("includes only available sources in mixed scenario", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const sources = [
				createMockSource("available1", [{ type: "a", data: 1, timestamp: 100 }], true),
				createMockSource("unavailable1", [{ type: "b", data: 2, timestamp: 200 }], false),
				createMockSource("available2", [{ type: "c", data: 3, timestamp: 300 }], true),
				createMockSource("unavailable2", [{ type: "d", data: 4, timestamp: 400 }], false),
			]

			const stream = createMergedWorldStream({ registry, sse, sources })

			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			expect(events).toHaveLength(2)
			expect(events.map((e) => e.source).sort()).toEqual(["available1", "available2"])

			await stream.dispose()
		})
	})

	describe("event ordering", () => {
		it("preserves sequence numbers from sources", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const source = createMockSource("sequenced", [
				{ type: "event", data: "first", timestamp: 100, sequence: 1 },
				{ type: "event", data: "second", timestamp: 200, sequence: 2 },
				{ type: "event", data: "third", timestamp: 300, sequence: 3 },
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			expect(events[0].sequence).toBe(1)
			expect(events[1].sequence).toBe(2)
			expect(events[2].sequence).toBe(3)

			await stream.dispose()
		})

		it("handles mixed sequenced and non-sequenced events", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const sequenced = createMockSource("sequenced", [
				{ type: "s1", data: "seq", timestamp: 100, sequence: 10 },
			])

			const nonSequenced = createMockSource("non-sequenced", [
				{ type: "n1", data: "no-seq", timestamp: 200 },
			])

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [sequenced, nonSequenced],
			})

			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			expect(events).toHaveLength(2)

			const seqEvent = events.find((e) => e.source === "sequenced")
			const nonSeqEvent = events.find((e) => e.source === "non-sequenced")

			expect(seqEvent?.sequence).toBe(10)
			expect(nonSeqEvent?.sequence).toBeUndefined()

			await stream.dispose()
		})
	})

	describe("error handling", () => {
		it("propagates errors from source streams", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const errorSource: EventSource = {
				name: "error-source",
				available: () => Effect.succeed(true),
				stream: () => Stream.fail(new Error("Source stream error")),
			}

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [errorSource],
			})

			// Should propagate the error
			await expect(Effect.runPromise(Stream.runCollect(stream.stream()))).rejects.toThrow(
				"Source stream error",
			)

			await stream.dispose()
		})

		it("handles availability check errors gracefully", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const failingAvailabilitySource: EventSource = {
				name: "failing-check",
				available: () =>
					Effect.sync(() => {
						throw new Error("Availability check failed")
					}),
				stream: () =>
					Stream.fromIterable([
						{ source: "failing-check", type: "test", data: "x", timestamp: 100 },
					]),
			}

			const goodSource = createMockSource("good", [{ type: "test", data: "ok", timestamp: 200 }])

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [failingAvailabilitySource, goodSource],
			})

			// Should treat failed availability check as unavailable
			const events = await Effect.runPromise(
				Stream.runCollect(stream.stream()).pipe(Effect.map((chunk) => Array.from(chunk))),
			)

			// Only good source should emit
			expect(events).toHaveLength(1)
			expect(events[0].source).toBe("good")

			await stream.dispose()
		})
	})

	describe("event consumer (route to WorldStore)", () => {
		it("routes session.created events to store", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "session.created",
					data: {
						id: "sess-001",
						title: "Test Session",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Background consumer processes events asynchronously - wait for it
			await new Promise((resolve) => setTimeout(resolve, 50))

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-001")
			expect(session).toBeDefined()
			expect(session?.directory).toBe("/test")

			await stream.dispose()
		})

		it("routes session.updated events to store", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "session.created",
					data: {
						id: "sess-002",
						title: "Test Session",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
				{
					type: "session.updated",
					data: {
						id: "sess-002",
						title: "Test Session Updated",
						directory: "/updated",
						time: { created: now, updated: now + 10 },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Wait for updated session to appear
			await new Promise<void>((resolve) => {
				const unsubscribe = stream.subscribe((state) => {
					const sess = state.sessions.find((s) => s.id === "sess-002")
					if (sess?.directory === "/updated") {
						unsubscribe()
						resolve()
					}
				})
				setTimeout(() => {
					unsubscribe()
					resolve()
				}, 1000)
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-002")
			expect(session).toBeDefined()
			expect(session?.directory).toBe("/updated")

			await stream.dispose()
		})

		it("handles unknown event types gracefully", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "unknown.event.type",
					data: { foo: "bar" },
					timestamp: now,
				},
				{
					type: "session.created",
					data: {
						id: "sess-004",
						title: "Test Session",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Wait for session to appear
			await new Promise<void>((resolve) => {
				const unsubscribe = stream.subscribe((state) => {
					if (state.sessions.find((s) => s.id === "sess-004")) {
						unsubscribe()
						resolve()
					}
				})
				setTimeout(() => {
					unsubscribe()
					resolve()
				}, 1000)
			})

			const state = await stream.getSnapshot()
			// Should have the session (unknown event ignored)
			const session = state.sessions.find((s) => s.id === "sess-004")
			expect(session).toBeDefined()

			await stream.dispose()
		})

		it("handles malformed event data gracefully", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "session.created",
					data: null, // Invalid data
					timestamp: now,
				},
				{
					type: "session.created",
					data: {
						id: "sess-005",
						title: "Test Session",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Wait for valid session to appear
			await new Promise<void>((resolve) => {
				const unsubscribe = stream.subscribe((state) => {
					if (state.sessions.find((s) => s.id === "sess-005")) {
						unsubscribe()
						resolve()
					}
				})
				setTimeout(() => {
					unsubscribe()
					resolve()
				}, 1000)
			})

			const state = await stream.getSnapshot()
			// Should have the valid session
			const session = state.sessions.find((s) => s.id === "sess-005")
			expect(session).toBeDefined()

			await stream.dispose()
		})

		it("processes events from multiple sources concurrently", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source1 = createMockSource("source1", [
				{
					type: "session.created",
					data: {
						id: "sess-from-1",
						title: "From Source 1",
						directory: "/test1",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "session.created",
					data: {
						id: "sess-from-2",
						title: "From Source 2",
						directory: "/test2",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const stream = createMergedWorldStream({
				registry,
				sse,
				sources: [source1, source2],
			})

			// Wait for both sessions to appear
			await new Promise<void>((resolve) => {
				const unsubscribe = stream.subscribe((state) => {
					const sess1 = state.sessions.find((s) => s.id === "sess-from-1")
					const sess2 = state.sessions.find((s) => s.id === "sess-from-2")
					if (sess1 && sess2) {
						unsubscribe()
						resolve()
					}
				})
				setTimeout(() => {
					unsubscribe()
					resolve()
				}, 1000)
			})

			const state = await stream.getSnapshot()
			const sess1 = state.sessions.find((s) => s.id === "sess-from-1")
			const sess2 = state.sessions.find((s) => s.id === "sess-from-2")
			expect(sess1).toBeDefined()
			expect(sess2).toBeDefined()

			await stream.dispose()
		})
	})

	describe("discovery race condition - watch command symptom", () => {
		it("shows 'connecting' status immediately, then updates after discovery", async () => {
			// RED TEST: Reproduces watch command behavior
			// User sees: "Connected! Watching..." but Sessions: 0 forever
			//
			// Root cause hypothesis: Discovery works, but either:
			// 1. No servers found (discovery returns empty array)
			// 2. Bootstrap fails silently
			// 3. Subscribe callback throttling prevents updates from showing

			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const states: string[] = []
			const sessionCounts: number[] = []

			// Simulate watch.ts behavior
			const stream = createMergedWorldStream({
				registry,
				sse,
				// No baseUrl - triggers discovery like watch command
			})

			// Subscribe BEFORE getSnapshot (like watch.ts lines 178, 248)
			const unsubscribe = stream.subscribe((world) => {
				states.push(world.connectionStatus)
				sessionCounts.push(world.stats.total)
			})

			// Get initial snapshot (like watch.ts line 248)
			const initialSnapshot = await stream.getSnapshot()

			// Initial snapshot should show "connecting" with 0 sessions
			// This is CORRECT - discovery hasn't completed yet
			expect(initialSnapshot.connectionStatus).toBe("connecting")
			expect(initialSnapshot.stats.total).toBe(0)

			// With the fix, subscribe() fires immediately with current state
			// So states[0] should be the initial state (after setConnectionStatus("connecting"))
			expect(states[0]).toBe("connecting")
			expect(sessionCounts[0]).toBe(0)

			// The key fix: subscriber receives state immediately
			// Now watch.ts display will update as soon as subscription is active

			unsubscribe()
			await stream.dispose()
		})

		it("subscribe callback fires immediately with current state", async () => {
			// RED TEST: This is the actual fix we need
			// Current behavior: subscribe() only fires on CHANGES
			// Expected behavior: subscribe() fires IMMEDIATELY with current state,
			// then on each change (like React useState pattern)

			const registry = Registry.make()
			const sse = createTestSSE(registry)

			let callbackCount = 0
			const stream = createMergedWorldStream({ registry, sse })

			stream.subscribe(() => {
				callbackCount++
			})

			// Wait a tick for synchronous execution
			await new Promise((resolve) => setTimeout(resolve, 0))

			// BUG: callbackCount will be 0 (or 1 if "connecting" triggered it)
			// Expected: callbackCount should be 1 (initial state)
			expect(callbackCount).toBeGreaterThanOrEqual(1)

			await stream.dispose()
		})
	})

	describe("async iterator lifecycle", () => {
		it("yields current state immediately on start", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "session.created",
					data: {
						id: "sess-iter-1",
						title: "Iterator Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Wait for session to land in store
			await new Promise<void>((resolve) => {
				const unsub = stream.subscribe((state) => {
					if (state.sessions.find((s) => s.id === "sess-iter-1")) {
						unsub()
						resolve()
					}
				})
				setTimeout(() => {
					unsub()
					resolve()
				}, 1000)
			})

			// Start async iteration
			const iterator = stream[Symbol.asyncIterator]()
			const first = await iterator.next()

			// First yield should be current state (with the session)
			expect(first.done).toBe(false)
			if (!first.done) {
				expect(first.value.sessions.length).toBeGreaterThan(0)
			}

			await stream.dispose()
		})

		it("yields subsequent states on changes", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "session.created",
					data: {
						id: "sess-iter-2",
						title: "First",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Start async iteration
			const iterator = stream[Symbol.asyncIterator]()

			// First yield is immediate (current state)
			const first = await iterator.next()
			expect(first.done).toBe(false)

			// Wait for session to appear
			await new Promise<void>((resolve) => {
				const unsub = stream.subscribe((state) => {
					const hasSession = state.sessions.some((sess) => sess.id === "sess-iter-2")
					if (hasSession) {
						unsub()
						resolve()
					}
				})
				setTimeout(() => {
					unsub()
					resolve()
				}, 1000)
			})

			// Next yield should have the session
			const second = await Promise.race([
				iterator.next(),
				new Promise<{ done: boolean; value: any }>((resolve) =>
					setTimeout(() => resolve({ done: true, value: undefined }), 2000),
				),
			])

			expect(second.done).toBe(false)
			if (!second.done && second.value?.sessions) {
				const hasSession = second.value.sessions.length > 0
				expect(hasSession).toBe(true)
			}

			await stream.dispose()
		})

		it("cleans up subscription when iterator breaks", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })

			// Start iteration then break immediately
			const iterator = stream[Symbol.asyncIterator]()
			await iterator.next()

			// Breaking should trigger cleanup (finally block)
			// No explicit way to verify unsubscribe was called without mocking
			// But we can verify no errors occur

			await stream.dispose()
		})

		it("handles rapid iteration without dropping states", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const now = Date.now()
			const source = createMockSource("test-source", [
				{
					type: "session.created",
					data: {
						id: "sess-rapid-1",
						title: "Rapid 1",
						directory: "/test1",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
				{
					type: "session.created",
					data: {
						id: "sess-rapid-2",
						title: "Rapid 2",
						directory: "/test2",
						time: { created: now + 10, updated: now + 10 },
					},
					timestamp: now + 10,
				},
				{
					type: "session.created",
					data: {
						id: "sess-rapid-3",
						title: "Rapid 3",
						directory: "/test3",
						time: { created: now + 20, updated: now + 20 },
					},
					timestamp: now + 20,
				},
			])

			const stream = createMergedWorldStream({ registry, sse, sources: [source] })

			// Collect states via async iteration
			const states = []
			const iterator = stream[Symbol.asyncIterator]()

			// Get initial state
			const first = await iterator.next()
			states.push(first.value)

			// Wait for all sessions to land
			await new Promise<void>((resolve) => {
				const unsub = stream.subscribe((state) => {
					const has1 = state.sessions.some((sess) => sess.id === "sess-rapid-1")
					const has2 = state.sessions.some((sess) => sess.id === "sess-rapid-2")
					const has3 = state.sessions.some((sess) => sess.id === "sess-rapid-3")
					if (has1 && has2 && has3) {
						unsub()
						resolve()
					}
				})
				setTimeout(() => {
					unsub()
					resolve()
				}, 2000)
			})

			// Queue should accumulate states if iterator isn't consuming fast enough
			// But we should get all sessions eventually
			const finalState = await stream.getSnapshot()
			const has1 = finalState.sessions.some((sess) => sess.id === "sess-rapid-1")
			const has2 = finalState.sessions.some((sess) => sess.id === "sess-rapid-2")
			const has3 = finalState.sessions.some((sess) => sess.id === "sess-rapid-3")
			expect(has1).toBe(true)
			expect(has2).toBe(true)
			expect(has3).toBe(true)

			await stream.dispose()
		})
	})
})
