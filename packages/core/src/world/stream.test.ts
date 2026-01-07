/**
 * Tests for world stream
 *
 * Tests the self-contained createWorldStream API that handles
 * discovery and SSE connections internally.
 *
 * Uses dependency injection instead of mocks for better isolation.
 */

import { describe, expect, it, vi } from "vitest"
import { connectionStatusAtom, Registry } from "./atoms.js"
import type { WorldSSE } from "./sse.js"
import { createMergedWorldStream } from "./merged-stream.js"

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

describe("createWorldStream with dependency injection", () => {
	it("creates a stream handle with all methods", async () => {
		const registry = Registry.make()
		const sse = createTestSSE(registry)

		const stream = createMergedWorldStream({ registry, sse })
		sse.start()

		expect(typeof stream.subscribe).toBe("function")
		expect(typeof stream.getSnapshot).toBe("function")
		expect(typeof stream[Symbol.asyncIterator]).toBe("function")
		expect(typeof stream.dispose).toBe("function")

		await stream.dispose()
	})

	describe("connection lifecycle", () => {
		it("properly transitions through connecting → connected", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })

			// Initially disconnected
			const initial = await stream.getSnapshot()
			expect(initial.connectionStatus).toBe("disconnected")

			// Start SSE
			sse.start()

			// Should be connected (our test SSE sets both states synchronously)
			const afterStart = await stream.getSnapshot()
			expect(afterStart.connectionStatus).toBe("connected")

			await stream.dispose()
		})

		it("transitions to disconnected on stop", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })
			sse.start()

			const before = await stream.getSnapshot()
			expect(before.connectionStatus).toBe("connected")

			sse.stop()

			const after = await stream.getSnapshot()
			expect(after.connectionStatus).toBe("disconnected")

			await stream.dispose()
		})
	})

	describe("getSnapshot", () => {
		it("returns current world state", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })
			const snapshot = await stream.getSnapshot()

			expect(snapshot.sessions).toEqual([])
			expect(snapshot.activeSessionCount).toBe(0)
			expect(snapshot.connectionStatus).toBeDefined()

			await stream.dispose()
		})
	})

	describe("subscribe", () => {
		it("returns unsubscribe function", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })
			const callback = vi.fn()

			const unsubscribe = stream.subscribe(callback)
			expect(typeof unsubscribe).toBe("function")

			unsubscribe()
			await stream.dispose()
		})
	})

	describe("async iterator", () => {
		it("yields initial world state", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })
			const iterator = stream[Symbol.asyncIterator]()

			// Get first value
			const first = await iterator.next()

			expect(first.done).toBe(false)
			expect(first.value.sessions).toBeDefined()
			expect(first.value.activeSessionCount).toBe(0)

			await stream.dispose()
		})
	})

	describe("dispose", () => {
		it("cleans up resources", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })
			sse.start()

			// Get initial snapshot
			const before = await stream.getSnapshot()
			expect(before.connectionStatus).toBe("connected")

			// Dispose
			await stream.dispose()

			// Connection should be disconnected
			const after = await stream.getSnapshot()
			expect(after.connectionStatus).toBe("disconnected")
		})
	})

	describe("getRegistry", () => {
		it("exposes atom registry for external event routing", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })

			// Should expose the registry
			const exposedRegistry = stream.getRegistry()
			expect(exposedRegistry).toBe(registry)

			await stream.dispose()
		})

		it("registry can be used to update atoms externally", async () => {
			const registry = Registry.make()
			const sse = createTestSSE(registry)

			const stream = createMergedWorldStream({ registry, sse })
			const exposedRegistry = stream.getRegistry()

			// Simulate external event router updating connection status
			exposedRegistry.set(connectionStatusAtom, "connected")

			// Should be reflected in snapshot
			const snapshot = await stream.getSnapshot()
			expect(snapshot.connectionStatus).toBe("connected")

			await stream.dispose()
		})
	})
})
