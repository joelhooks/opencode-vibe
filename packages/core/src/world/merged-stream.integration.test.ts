/**
 * Merged Stream Integration Tests - SKIPPED (SwarmDb deferred)
 *
 * These tests were for SwarmDb + SSE event interleaving which was deferred in ADR-019 Phase 0c.
 * The pluggable event source functionality (routeEventToRegistry) was removed because:
 * 1. SwarmDb was not part of original router unification scope
 * 2. No active SwarmDb callers exist in current codebase
 * 3. SSE event flow is complete and functional
 *
 * When SwarmDb is re-added, these tests should be re-enabled and the event routing
 * logic should be added to handle non-SSE event sources.
 *
 * See: docs/adr/019-hierarchical-event-subscriptions.md section "Outstanding TODOs #8"
 *
 * Original description:
 * Tests the full integration of merged streams with WorldStore:
 * - SSE + swarm.db event interleaving
 * - Graceful degradation when sources unavailable
 * - SSE-only mode (backward compatibility)
 * - Event ordering guarantees
 *
 * Pattern from Hivemind (mem-762db21e90dc3ad0):
 * - Lightweight consumer pattern with routeEventToStore
 * - Subscribe + timeout pattern for async state changes
 * - Type guards for safety
 */

import { describe, it, expect } from "vitest"
import { Effect, Stream, Schedule, pipe } from "effect"
import { createMergedWorldStream } from "./merged-stream.js"
import type { EventSource, SourceEvent } from "./event-source.js"

/**
 * Create a mock EventSource for testing
 *
 * Creates a stream that emits events with delays but NEVER completes.
 * This keeps the consumer alive and prevents Effect cleanup from clearing atoms.
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
			pipe(
				// Initial delay to give test setup time
				Effect.sleep("50 millis"),
				Effect.andThen(() =>
					pipe(
						Stream.fromIterable(
							events.map((e) => ({
								...e,
								source: name,
							})),
						),
						// Add spacing between events
						Stream.schedule(Schedule.spaced("10 millis")),
						// Concat with an infinite stream that never emits
						// This prevents the stream from completing
						Stream.concat(Stream.never),
					),
				),
				Stream.unwrap,
			),
	}
}

/**
 * Wait for condition in store with timeout
 * Pattern from Hivemind (mem-762db21e90dc3ad0)
 */
async function waitForCondition<T>(
	subscribe: (callback: (state: T) => void) => () => void,
	predicate: (state: T) => boolean,
	timeoutMs = 2000,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let callCount = 0
		const unsubscribe = subscribe((state) => {
			callCount++
			if (predicate(state)) {
				unsubscribe()
				resolve()
			}
		})
		// Fallback timeout - reject instead of resolve to catch issues
		setTimeout(() => {
			unsubscribe()
			reject(
				new Error(
					`waitForCondition timed out after ${timeoutMs}ms (predicate never true, ${callCount} updates received)`,
				),
			)
		}, timeoutMs)
	})
}

describe.skip("Merged Stream Integration Tests - DEFERRED: SwarmDb event routing removed in ADR-019 Phase 0c", () => {
	describe("SSE + swarm.db event interleaving", () => {
		it("merges events from SSE and swarm.db into WorldStore", async () => {
			const now = Date.now()

			// Mock SSE source
			const sseSource = createMockSource("sse", [
				{
					type: "session.created",
					data: {
						id: "sess-sse-1",
						title: "SSE Session",
						directory: "/sse",
						time: { created: now, updated: now },
					},
					timestamp: now,
					sequence: 1,
				},
			])

			// Mock swarm.db source
			const swarmDbSource = createMockSource("swarm-db", [
				{
					type: "session.created",
					data: {
						id: "sess-db-1",
						title: "SwarmDb Session",
						directory: "/swarmdb",
						time: { created: now + 10, updated: now + 10 },
					},
					timestamp: now + 10,
					sequence: 1,
				},
			])

			// Inject mock SSE to prevent real WorldSSE from starting
			const mockSSE = {
				start: () => {},
				stop: () => {},
				getConnectedPorts: () => [],
			} as any

			const stream = createMergedWorldStream({
				sources: [sseSource, swarmDbSource],
				sse: mockSSE,
			})

			// Debug: check initial state
			const initialState = await stream.getSnapshot()
			console.log("Initial sessions:", initialState.sessions.length)

			// Wait for both sessions to appear in WorldStore
			try {
				await waitForCondition(stream.subscribe, (state) => {
					console.log(
						"Checking state, sessions:",
						state.sessions.length,
						state.sessions.map((s) => s.id),
					)
					const sseSession = state.sessions.find((s) => s.id === "sess-sse-1")
					const dbSession = state.sessions.find((s) => s.id === "sess-db-1")
					return !!sseSession && !!dbSession
				})
			} catch (error) {
				console.error("waitForCondition failed:", error)
				throw error
			}

			console.log("waitForCondition resolved, waiting for consumer...")
			// WORKAROUND: Give consumer time to finish
			// Atoms get cleared between subscription callback and getSnapshot without this
			await new Promise((resolve) => setTimeout(resolve, 100))

			console.log("Getting snapshot after delay...")
			const state = await stream.getSnapshot()
			console.log(
				"Snapshot sessions:",
				state.sessions.length,
				state.sessions.map((s) => s.id),
			)

			// Verify both sessions are in the store
			const sseSession = state.sessions.find((s) => s.id === "sess-sse-1")
			const dbSession = state.sessions.find((s) => s.id === "sess-db-1")

			expect(sseSession).toBeDefined()
			expect(sseSession?.directory).toBe("/sse")

			expect(dbSession).toBeDefined()
			expect(dbSession?.directory).toBe("/swarmdb")

			await stream.dispose()
		})

		it("interleaves session.updated events from multiple sources", async () => {
			const now = Date.now()

			const source1 = createMockSource("source1", [
				{
					type: "session.created",
					data: {
						id: "sess-001",
						title: "Initial",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "session.updated",
					data: {
						id: "sess-001",
						title: "Updated from source2",
						directory: "/updated",
						time: { created: now, updated: now + 20 },
					},
					timestamp: now + 20,
				},
			])

			const stream = createMergedWorldStream({
				sources: [source1, source2],
			})

			// Wait for updated session
			await waitForCondition(stream.subscribe, (state) => {
				const sess = state.sessions.find((s) => s.id === "sess-001")
				return sess?.directory === "/updated"
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-001")

			expect(session).toBeDefined()
			expect(session?.title).toBe("Updated from source2")
			expect(session?.directory).toBe("/updated")

			await stream.dispose()
		})

		it("routes message.created events from multiple sources", async () => {
			const now = Date.now()

			// First create a session so messages have somewhere to belong
			const sessionSource = createMockSource("session-source", [
				{
					type: "session.created",
					data: {
						id: "sess-xyz",
						title: "Test Session",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source1 = createMockSource("source1", [
				{
					type: "message.created",
					data: {
						id: "msg-001",
						sessionID: "sess-xyz",
						role: "user",
						content: [{ type: "text", text: "From source1" }],
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "message.created",
					data: {
						id: "msg-002",
						sessionID: "sess-xyz",
						role: "assistant",
						content: [{ type: "text", text: "From source2" }],
						time: { created: now + 10, updated: now + 10 },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [sessionSource, source1, source2],
			})

			// Wait for both messages to appear in session
			await waitForCondition(stream.subscribe, (state) => {
				const session = state.sessions.find((s) => s.id === "sess-xyz")
				return (session?.messages.length ?? 0) === 2
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-xyz")

			expect(session).toBeDefined()
			expect(session?.messages).toHaveLength(2)
			expect(session?.messages.find((m) => m.id === "msg-001")).toBeDefined()
			expect(session?.messages.find((m) => m.id === "msg-002")).toBeDefined()

			await stream.dispose()
		})

		it("routes part.updated events from multiple sources", async () => {
			const now = Date.now()

			// Create session -> message -> parts hierarchy
			const sessionSource = createMockSource("session-source", [
				{
					type: "session.created",
					data: {
						id: "sess-parts",
						title: "Parts Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const messageSource = createMockSource("message-source", [
				{
					type: "message.created",
					data: {
						id: "msg-xyz",
						sessionID: "sess-parts",
						role: "assistant",
						content: [{ type: "text", text: "Test" }],
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source1 = createMockSource("source1", [
				{
					type: "part.created",
					data: {
						id: "part-001",
						sessionID: "sess-parts",
						messageID: "msg-xyz",
						type: "tool",
						tool: "bash",
						state: { status: "pending" },
					},
					timestamp: now,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "part.updated",
					data: {
						id: "part-001",
						sessionID: "sess-parts",
						messageID: "msg-xyz",
						type: "tool",
						tool: "bash",
						state: { status: "completed" },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [sessionSource, messageSource, source1, source2],
			})

			// Wait for updated part to appear in message
			await waitForCondition(stream.subscribe, (state) => {
				const session = state.sessions.find((s) => s.id === "sess-parts")
				const message = session?.messages.find((m) => m.id === "msg-xyz")
				const part = message?.parts.find((p) => p.id === "part-001")
				return part?.type === "tool" && part.state?.status === "completed"
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-parts")
			const message = session?.messages.find((m) => m.id === "msg-xyz")
			const part = message?.parts.find((p) => p.id === "part-001")

			expect(part).toBeDefined()
			expect(part?.type).toBe("tool")
			if (part?.type === "tool") {
				expect(part.state?.status).toBe("completed")
			}

			await stream.dispose()
		})

		it("marks session as active when receiving message events", async () => {
			const now = Date.now()

			// Create session (no explicit status - defaults to "completed")
			const sessionSource = createMockSource("session-source", [
				{
					type: "session.created",
					data: {
						id: "sess-implicit-active",
						title: "Implicit Active Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			// Message event arrives - session should become active
			const messageSource = createMockSource("message-source", [
				{
					type: "message.created",
					data: {
						id: "msg-active-1",
						sessionID: "sess-implicit-active",
						role: "assistant",
						time: { created: now + 10, updated: now + 10 },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [sessionSource, messageSource],
			})

			// Wait for message to appear
			await waitForCondition(stream.subscribe, (state) => {
				const session = state.sessions.find((s) => s.id === "sess-implicit-active")
				return session?.messages.length === 1
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-implicit-active")

			expect(session).toBeDefined()
			// Session should be marked active because we received events for it
			expect(session?.isActive).toBe(true)
			expect(session?.status).toBe("running")

			await stream.dispose()
		})

		it("marks session as active when receiving part events", async () => {
			const now = Date.now()

			// Create session and message
			const sessionSource = createMockSource("session-source", [
				{
					type: "session.created",
					data: {
						id: "sess-part-active",
						title: "Part Active Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const messageSource = createMockSource("message-source", [
				{
					type: "message.created",
					data: {
						id: "msg-part-1",
						sessionID: "sess-part-active",
						role: "assistant",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			// Part event arrives - session should become active
			const partSource = createMockSource("part-source", [
				{
					type: "part.updated",
					data: {
						id: "part-streaming",
						sessionID: "sess-part-active",
						messageID: "msg-part-1",
						type: "text",
						text: "Hello...",
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [sessionSource, messageSource, partSource],
			})

			// Wait for part to appear
			await waitForCondition(stream.subscribe, (state) => {
				const session = state.sessions.find((s) => s.id === "sess-part-active")
				const message = session?.messages.find((m) => m.id === "msg-part-1")
				return message?.parts.length === 1
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-part-active")

			expect(session).toBeDefined()
			// Session should be marked active because we received part events
			expect(session?.isActive).toBe(true)
			expect(session?.status).toBe("running")

			await stream.dispose()
		})

		it("routes session.status events from multiple sources", async () => {
			const now = Date.now()

			// Create session first
			const sessionSource = createMockSource("session-source", [
				{
					type: "session.created",
					data: {
						id: "sess-status-1",
						title: "Status Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source1 = createMockSource("source1", [
				{
					type: "session.status",
					data: {
						sessionID: "sess-status-1",
						status: "running",
					},
					timestamp: now,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "session.status",
					data: {
						sessionID: "sess-status-1",
						status: "completed",
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [sessionSource, source1, source2],
			})

			// Wait for status update to appear in enriched session
			await waitForCondition(stream.subscribe, (state) => {
				const session = state.sessions.find((s) => s.id === "sess-status-1")
				return session?.status === "completed"
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-status-1")

			expect(session).toBeDefined()
			expect(session?.status).toBe("completed")

			await stream.dispose()
		})
	})

	describe("graceful degradation", () => {
		it("continues working when swarm.db is unavailable", async () => {
			const now = Date.now()

			// SSE source (available)
			const sseSource = createMockSource("sse", [
				{
					type: "session.created",
					data: {
						id: "sess-sse-only",
						title: "SSE Only",
						directory: "/sse",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			// SwarmDb source (unavailable)
			const swarmDbSource = createMockSource(
				"swarm-db",
				[
					{
						type: "session.created",
						data: {
							id: "sess-should-not-appear",
							title: "Should Not Appear",
							directory: "/nowhere",
							time: { created: now, updated: now },
						},
						timestamp: now,
					},
				],
				false, // NOT available
			)

			const stream = createMergedWorldStream({
				sources: [sseSource, swarmDbSource],
			})

			// Wait for SSE session to appear
			await waitForCondition(stream.subscribe, (state) => {
				return !!state.sessions.find((s) => s.id === "sess-sse-only")
			})

			const state = await stream.getSnapshot()

			// SSE session should be present
			const sseSession = state.sessions.find((s) => s.id === "sess-sse-only")
			expect(sseSession).toBeDefined()

			// SwarmDb session should NOT be present
			const dbSession = state.sessions.find((s) => s.id === "sess-should-not-appear")
			expect(dbSession).toBeUndefined()

			await stream.dispose()
		})

		it("handles all sources unavailable gracefully", async () => {
			const source1 = createMockSource("source1", [], false)
			const source2 = createMockSource("source2", [], false)

			const stream = createMergedWorldStream({
				sources: [source1, source2],
			})

			// Should not crash, just have empty state
			const state = await stream.getSnapshot()

			expect(state.sessions).toHaveLength(0)
			// Sessions is the top-level property; messages are nested within sessions

			await stream.dispose()
		})

		it("recovers when source becomes available mid-stream", async () => {
			// This test documents current behavior: sources are checked once at stream creation
			// If we want hot-reloading of sources, that would be a future enhancement

			const now = Date.now()
			let isAvailable = false

			const dynamicSource: EventSource = {
				name: "dynamic",
				available: () => Effect.succeed(isAvailable),
				stream: () =>
					Stream.fromIterable([
						{
							source: "dynamic",
							type: "session.created",
							data: {
								id: "sess-dynamic",
								title: "Dynamic",
								directory: "/dynamic",
								time: { created: now, updated: now },
							},
							timestamp: now,
						},
					]),
			}

			const stream = createMergedWorldStream({
				sources: [dynamicSource],
			})

			// Source is unavailable at creation
			const state1 = await stream.getSnapshot()
			expect(state1.sessions.find((s) => s.id === "sess-dynamic")).toBeUndefined()

			// Making source available now won't help - stream was already created
			isAvailable = true

			// Still won't appear (current behavior - availability checked at creation)
			await new Promise((resolve) => setTimeout(resolve, 100))
			const state2 = await stream.getSnapshot()
			expect(state2.sessions.find((s) => s.id === "sess-dynamic")).toBeUndefined()

			await stream.dispose()
		})
	})

	describe("SSE-only mode (backward compatibility)", () => {
		it("works without any additional sources", async () => {
			const stream = createMergedWorldStream({
				sources: [], // No additional sources
			})

			// Should not crash
			expect(stream).toBeDefined()
			expect(stream.subscribe).toBeDefined()
			expect(stream.getSnapshot).toBeDefined()

			const state = await stream.getSnapshot()
			expect(state.sessions).toBeDefined()

			await stream.dispose()
		})

		it("works when sources parameter is omitted", async () => {
			const stream = createMergedWorldStream({
				// sources parameter omitted entirely
			})

			expect(stream).toBeDefined()

			const state = await stream.getSnapshot()
			expect(state.sessions).toBeDefined()

			await stream.dispose()
		})

		it("maintains existing WorldStore API", async () => {
			const now = Date.now()

			const source = createMockSource("test", [
				{
					type: "session.created",
					data: {
						id: "sess-api-test",
						title: "API Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const stream = createMergedWorldStream({
				sources: [source],
			})

			// Test subscribe API
			let callbackFired = false
			const unsubscribe = stream.subscribe(() => {
				callbackFired = true
			})

			await waitForCondition(stream.subscribe, (state) => {
				return !!state.sessions.find((s) => s.id === "sess-api-test")
			})

			expect(callbackFired).toBe(true)
			unsubscribe()

			// Test getSnapshot API
			const snapshot = await stream.getSnapshot()
			expect(snapshot.sessions.find((s) => s.id === "sess-api-test")).toBeDefined()

			// Test async iterator API
			const iterator = stream[Symbol.asyncIterator]()
			const firstIteration = await iterator.next()
			expect(firstIteration.done).toBe(false)
			expect(firstIteration.value.sessions).toBeDefined()

			await stream.dispose()
		})
	})

	describe("event ordering", () => {
		it("maintains sequence numbers from sources", async () => {
			const source = createMockSource("sequenced", [
				{
					type: "session.created",
					data: {
						id: "sess-seq-1",
						title: "First",
						directory: "/test",
						time: { created: 100, updated: 100 },
					},
					timestamp: 100,
					sequence: 1,
				},
				{
					type: "session.created",
					data: {
						id: "sess-seq-2",
						title: "Second",
						directory: "/test",
						time: { created: 200, updated: 200 },
					},
					timestamp: 200,
					sequence: 2,
				},
			])

			const stream = createMergedWorldStream({
				sources: [source],
			})

			// Verify events from stream() preserve sequence
			// Take only 2 events since the stream is infinite
			const events = await Effect.runPromise(
				stream.stream().pipe(
					Stream.take(2),
					Stream.runCollect,
					Effect.map((chunk) => Array.from(chunk)),
				),
			)

			expect(events[0].sequence).toBe(1)
			expect(events[1].sequence).toBe(2)

			await stream.dispose()
		})

		it("handles concurrent events from multiple sources", async () => {
			// This test documents that Stream.mergeAll provides concurrent emission
			// but does NOT guarantee cross-source ordering (that's by design)

			const source1 = createMockSource("source1", [
				{
					type: "session.created",
					data: {
						id: "sess-a",
						title: "A",
						directory: "/test",
						time: { created: 100, updated: 100 },
					},
					timestamp: 100,
					sequence: 1,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "session.created",
					data: {
						id: "sess-b",
						title: "B",
						directory: "/test",
						time: { created: 50, updated: 50 }, // Earlier timestamp
					},
					timestamp: 50,
					sequence: 1,
				},
			])

			const stream = createMergedWorldStream({
				sources: [source1, source2],
			})

			// Take only 2 events since the stream is infinite
			const events = await Effect.runPromise(
				stream.stream().pipe(
					Stream.take(2),
					Stream.runCollect,
					Effect.map((chunk) => Array.from(chunk)),
				),
			)

			// Both events should be present
			expect(events).toHaveLength(2)

			// Order is NOT guaranteed across sources (Stream.mergeAll semantics)
			// This is intentional - WorldStore handles deduplication and ordering
			const hasSessionA = events.some((e) => (e.data as any).id === "sess-a")
			const hasSessionB = events.some((e) => (e.data as any).id === "sess-b")

			expect(hasSessionA).toBe(true)
			expect(hasSessionB).toBe(true)

			await stream.dispose()
		})

		it("WorldStore handles event deduplication correctly", async () => {
			const now = Date.now()

			// Send same session twice from different sources
			const source1 = createMockSource("source1", [
				{
					type: "session.created",
					data: {
						id: "sess-dup",
						title: "Original",
						directory: "/test1",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const source2 = createMockSource("source2", [
				{
					type: "session.updated",
					data: {
						id: "sess-dup", // Same ID
						title: "Updated",
						directory: "/test2",
						time: { created: now, updated: now + 10 },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [source1, source2],
			})

			// Wait for update
			await waitForCondition(stream.subscribe, (state) => {
				const sess = state.sessions.find((s) => s.id === "sess-dup")
				return sess?.directory === "/test2"
			})

			const state = await stream.getSnapshot()

			// Should have only one session (deduplicated by WorldStore)
			const sessions = state.sessions.filter((s) => s.id === "sess-dup")
			expect(sessions).toHaveLength(1)

			// Should have the updated version
			expect(sessions[0].title).toBe("Updated")
			expect(sessions[0].directory).toBe("/test2")

			await stream.dispose()
		})
	})

	describe("error handling in integration", () => {
		it("isolates errors from one source without affecting others", async () => {
			const now = Date.now()

			// Good source
			const goodSource = createMockSource("good", [
				{
					type: "session.created",
					data: {
						id: "sess-good",
						title: "Good",
						directory: "/good",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			// Error source
			const errorSource: EventSource = {
				name: "error",
				available: () => Effect.succeed(true),
				stream: () => Stream.fail(new Error("Source error")),
			}

			const stream = createMergedWorldStream({
				sources: [goodSource, errorSource],
			})

			// The merged stream should propagate the error
			// This is current behavior - errors from any source fail the merged stream
			await expect(Effect.runPromise(Stream.runCollect(stream.stream()))).rejects.toThrow(
				"Source error",
			)

			await stream.dispose()
		})

		it("handles malformed session events without crashing consumer", async () => {
			const now = Date.now()

			const source = createMockSource("malformed", [
				{
					type: "session.created",
					data: null, // Invalid data - should be ignored by type guard
					timestamp: now,
				},
				{
					type: "session.created",
					data: {
						id: "sess-valid",
						title: "Valid",
						directory: "/valid",
						time: { created: now + 10, updated: now + 10 },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [source],
			})

			// Wait for valid session (malformed event should be ignored)
			await waitForCondition(stream.subscribe, (state) => {
				return !!state.sessions.find((s) => s.id === "sess-valid")
			})

			const state = await stream.getSnapshot()

			// Valid session should be present
			expect(state.sessions.find((s) => s.id === "sess-valid")).toBeDefined()

			await stream.dispose()
		})

		it("handles malformed message events without crashing consumer", async () => {
			const now = Date.now()

			const sessionSource = createMockSource("session-source", [
				{
					type: "session.created",
					data: {
						id: "sess-malformed-msg",
						title: "Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
					timestamp: now,
				},
			])

			const messageSource = createMockSource("message-source", [
				{
					type: "message.created",
					data: null, // Invalid - should be ignored
					timestamp: now + 5,
				},
				{
					type: "message.created",
					data: {
						id: "msg-valid",
						sessionID: "sess-malformed-msg",
						role: "user",
						content: [{ type: "text", text: "Valid message" }],
						time: { created: now + 10, updated: now + 10 },
					},
					timestamp: now + 10,
				},
			])

			const stream = createMergedWorldStream({
				sources: [sessionSource, messageSource],
			})

			// Wait for valid message
			await waitForCondition(stream.subscribe, (state) => {
				const session = state.sessions.find((s) => s.id === "sess-malformed-msg")
				return (session?.messages.length ?? 0) > 0
			})

			const state = await stream.getSnapshot()
			const session = state.sessions.find((s) => s.id === "sess-malformed-msg")

			expect(session?.messages).toHaveLength(1)
			expect(session?.messages[0].id).toBe("msg-valid")

			await stream.dispose()
		})
	})
})
