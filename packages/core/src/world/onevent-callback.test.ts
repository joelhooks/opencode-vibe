/**
 * onEvent Callback Tests - SKIPPED (SwarmDb deferred)
 *
 * These tests were for SwarmDb event routing which was deferred in ADR-019 Phase 0c.
 * The pluggable event source functionality (routeEventToRegistry) was removed because:
 * 1. SwarmDb was not part of original router unification scope
 * 2. No active SwarmDb callers exist in current codebase
 * 3. SSE event flow is complete and functional
 *
 * When SwarmDb is re-added, these tests should be re-enabled and the event routing
 * logic should be added to handle non-SSE event sources.
 *
 * See: docs/adr/019-hierarchical-event-subscriptions.md section "Outstanding TODOs #8"
 */

import { describe, it, expect, vi } from "vitest"
import { createMergedWorldStream } from "./merged-stream.js"
import type { EventSource, SourceEvent } from "./event-source.js"
import { Effect, Stream } from "effect"
import type { SSEEventInfo } from "./types.js"

/**
 * Create a mock EventSource for testing
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

/**
 * Wait for condition with timeout
 */
async function waitForCondition(check: () => boolean, timeoutMs = 1000): Promise<void> {
	const startTime = Date.now()
	while (!check()) {
		if (Date.now() - startTime > timeoutMs) {
			return // Timeout
		}
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

describe.skip("onEvent callback for swarm-db events (DEFERRED - see ADR-019)", () => {
	it("onEvent callback IS invoked for swarm-db events (working behavior)", async () => {
		const now = Date.now()

		// Mock swarm.db source with a worker.spawned event
		const swarmDbSource = createMockSource("swarm-db", [
			{
				type: "worker.spawned",
				data: {
					worker_id: "worker-123",
					epic_id: "epic-456",
					task_id: "task-789",
					project_key: "/test",
				},
				timestamp: now,
				sequence: 1,
			},
		])

		// Track onEvent calls
		const onEventCalls: SSEEventInfo[] = []
		const onEventCallback = vi.fn((event: SSEEventInfo) => {
			onEventCalls.push(event)
		})

		const stream = createMergedWorldStream({
			sources: [swarmDbSource],
			onEvent: onEventCallback,
		})

		// Wait for event to be processed
		await waitForCondition(() => onEventCalls.length > 0, 500)

		// ACTUAL BEHAVIOR: onEvent IS called for swarm-db events (the fix works!)
		expect(onEventCallback).toHaveBeenCalled()
		expect(onEventCalls.length).toBeGreaterThan(0)

		// Verify event structure is correct
		const event = onEventCalls[0]
		expect(event.type).toBe("worker.spawned")
		expect(event.source).toBe("swarm-db")
		expect(event.properties).toEqual({
			worker_id: "worker-123",
			epic_id: "epic-456",
			task_id: "task-789",
			project_key: "/test",
		})

		await stream.dispose()
	})

	it("onEvent callback IS invoked for SSE events (working behavior - for comparison)", async () => {
		// This test documents that onEvent DOES work for SSE events
		// We're using a mock source named "sse" to simulate SSE events

		const now = Date.now()

		const sseSource = createMockSource("sse", [
			{
				type: "session.created",
				data: {
					id: "sess-123",
					title: "Test Session",
					directory: "/test",
					time: { created: now, updated: now },
				},
				timestamp: now,
			},
		])

		const onEventCalls: SSEEventInfo[] = []
		const onEventCallback = vi.fn((event: SSEEventInfo) => {
			onEventCalls.push(event)
		})

		const stream = createMergedWorldStream({
			sources: [sseSource],
			onEvent: onEventCallback,
		})

		// Wait for event to be processed
		await waitForCondition(() => onEventCalls.length > 0, 500)

		// SSE events SHOULD trigger the callback (this works)
		expect(onEventCallback).toHaveBeenCalled()
		expect(onEventCalls.length).toBeGreaterThan(0)

		// Verify the event has correct structure
		const firstEvent = onEventCalls[0]
		expect(firstEvent).toHaveProperty("type", "session.created")
		expect(firstEvent).toHaveProperty("source", "sse")
		expect(firstEvent).toHaveProperty("properties")

		await stream.dispose()
	})

	it("onEvent callback receives multiple swarm-db events with correct source tags", async () => {
		const now = Date.now()

		// Multiple events from swarm-db source
		const swarmDbSource = createMockSource("swarm-db", [
			{
				type: "worker.spawned",
				data: {
					worker_id: "worker-abc",
					epic_id: "epic-def",
				},
				timestamp: now,
			},
			{
				type: "worker.progress",
				data: {
					worker_id: "worker-abc",
					progress: 50,
				},
				timestamp: now + 100,
			},
			{
				type: "worker.completed",
				data: {
					worker_id: "worker-abc",
					status: "success",
				},
				timestamp: now + 200,
			},
		])

		const onEventCalls: SSEEventInfo[] = []

		const stream = createMergedWorldStream({
			sources: [swarmDbSource],
			onEvent: (event: SSEEventInfo) => {
				onEventCalls.push(event)
			},
		})

		// Wait for all events to be processed
		await waitForCondition(() => onEventCalls.length >= 3, 500)

		// All events should be received
		expect(onEventCalls.length).toBeGreaterThanOrEqual(3)

		// All should have swarm-db source tag
		expect(onEventCalls.every((e) => e.source === "swarm-db")).toBe(true)

		// Verify each event has correct type
		expect(onEventCalls[0].type).toBe("worker.spawned")
		expect(onEventCalls[1].type).toBe("worker.progress")
		expect(onEventCalls[2].type).toBe("worker.completed")

		await stream.dispose()
	})
})
