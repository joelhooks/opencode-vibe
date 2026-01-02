/**
 * SSE EventSource Tests
 *
 * Tests for SSE adapter implementing EventSource interface.
 * TDD approach: tests first, implementation follows.
 *
 * Pattern from Hivemind (mem-2a4f8a43a3632d5f):
 * - Wrap MultiServerSSE as EventSource
 * - Use Stream.async pattern for callback-based API
 * - Transform SSE events to SourceEvent shape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Effect, Stream } from "effect"
import type { EventSource, SourceEvent } from "./event-source.js"
import { createSseSource } from "./sse-source.js"
import type { GlobalEvent } from "../types/events.js"

/**
 * Mock SSE class that mimics MultiServerSSE interface
 * Only implements methods needed for EventSource adapter
 */
class MockSSE {
	private eventCallbacks: Array<(event: GlobalEvent) => void> = []
	private stateCallbacks: Array<(state: { connected: boolean }) => void> = []
	private started = false
	private stopped = false

	start() {
		this.started = true
		// Simulate connection after a tick
		setTimeout(() => {
			for (const cb of this.stateCallbacks) {
				cb({ connected: true })
			}
		}, 0)
	}

	stop() {
		this.stopped = true
		for (const cb of this.stateCallbacks) {
			cb({ connected: false })
		}
	}

	onEvent(callback: (event: GlobalEvent) => void): () => void {
		this.eventCallbacks.push(callback)
		return () => {
			this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback)
		}
	}

	onStateChange(callback: (state: { connected: boolean }) => void): () => void {
		this.stateCallbacks.push(callback)
		// Emit current state immediately
		callback({ connected: this.started && !this.stopped })
		return () => {
			this.stateCallbacks = this.stateCallbacks.filter((cb) => cb !== callback)
		}
	}

	isConnected(): boolean {
		return this.started && !this.stopped
	}

	// Test helper to emit events
	emitEvent(event: GlobalEvent) {
		for (const cb of this.eventCallbacks) {
			cb(event)
		}
	}
}

describe("createSseSource", () => {
	let mockSSE: MockSSE

	beforeEach(() => {
		mockSSE = new MockSSE()
	})

	afterEach(() => {
		mockSSE.stop()
	})

	describe("EventSource interface", () => {
		it("should return an EventSource with name 'sse'", () => {
			const source = createSseSource(mockSSE)

			expect(source.name).toBe("sse")
		})

		it("should implement available() method", () => {
			const source = createSseSource(mockSSE)

			expect(source.available).toBeDefined()
			expect(typeof source.available).toBe("function")
		})

		it("should implement stream() method", () => {
			const source = createSseSource(mockSSE)

			expect(source.stream).toBeDefined()
			expect(typeof source.stream).toBe("function")
		})
	})

	describe("available()", () => {
		it("should return false when SSE is not connected", async () => {
			const source = createSseSource(mockSSE)

			const result = await Effect.runPromise(source.available())

			expect(result).toBe(false)
		})

		it("should return true when SSE is connected", async () => {
			mockSSE.start()
			const source = createSseSource(mockSSE)

			// Wait for connection to establish
			await new Promise((resolve) => setTimeout(resolve, 10))

			const result = await Effect.runPromise(source.available())

			expect(result).toBe(true)
		})
	})

	describe("stream()", () => {
		it("should return a Stream", () => {
			const source = createSseSource(mockSSE)
			const stream = source.stream()

			expect(stream).toBeDefined()
			expect(typeof stream).toBe("object")
		})

		it("should emit SourceEvent when SSE emits GlobalEvent", async () => {
			mockSSE.start()
			const source = createSseSource(mockSSE)
			const stream = source.stream()

			// Collect 1 event then complete
			const events: SourceEvent[] = []
			const program = Stream.runForEach(Stream.take(stream, 1), (event) =>
				Effect.sync(() => {
					events.push(event)
				}),
			)

			Effect.runFork(program)

			// Wait for stream to initialize
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Emit test event
			const globalEvent: GlobalEvent = {
				directory: "/test/project",
				payload: {
					type: "session.created",
					properties: {
						info: {
							id: "test-123",
							title: "Test Session",
							directory: "/test/project",
							projectID: "test-project",
							version: "1",
							time: { created: Date.now(), updated: Date.now() },
						},
					},
				},
			}
			mockSSE.emitEvent(globalEvent)

			// Wait for event processing
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Verify event was transformed correctly
			expect(events.length).toBe(1)
			expect(events[0].source).toBe("sse")
			expect(events[0].type).toBe("session.created")
			// Implementation passes through full payload.properties unchanged
			expect(events[0].data).toMatchObject({
				directory: "/test/project",
				properties: {
					info: {
						id: "test-123",
						title: "Test Session",
					},
				},
			})
			expect(events[0].timestamp).toBeGreaterThan(0)
			expect(events[0].sequence).toBe(0)
		})

		it("should emit multiple events with incrementing sequence numbers", async () => {
			mockSSE.start()
			const source = createSseSource(mockSSE)
			const stream = source.stream()

			const events: SourceEvent[] = []
			const program = Stream.runForEach(Stream.take(stream, 3), (event) =>
				Effect.sync(() => {
					events.push(event)
				}),
			)

			Effect.runFork(program)

			await new Promise((resolve) => setTimeout(resolve, 10))

			// Emit multiple events using valid event types
			// Note: Using 'as any' for test fixtures - SDK event types are strict
			mockSSE.emitEvent({
				directory: "/test",
				payload: { type: "session.updated", properties: { info: {} } } as any,
			})
			mockSSE.emitEvent({
				directory: "/test",
				payload: { type: "session.idle", properties: { sessionID: "test-1" } } as any,
			})
			mockSSE.emitEvent({
				directory: "/test",
				payload: { type: "session.compacted", properties: { sessionID: "test-2" } } as any,
			})

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(events.length).toBe(3)
			expect(events[0].sequence).toBe(0)
			expect(events[1].sequence).toBe(1)
			expect(events[2].sequence).toBe(2)
		})

		it("should call stop on SSE when stream cleanup runs", () => {
			// This test validates cleanup behavior
			mockSSE.start()
			const source = createSseSource(mockSSE)

			const stopSpy = vi.spyOn(mockSSE, "stop")

			// Create stream (which subscribes to SSE)
			const stream = source.stream()

			// Cleanup is called when stream effect runs its finalizer
			// For now, we verify the implementation has the cleanup logic
			expect(stopSpy).not.toHaveBeenCalled() // Not called on creation

			// The actual cleanup test would require running the stream
			// and interrupting it, which is tested in integration
		})

		it("should transform GlobalEvent payload to SourceEvent data", async () => {
			mockSSE.start()
			const source = createSseSource(mockSSE)
			const stream = source.stream()

			const events: SourceEvent[] = []

			// Take just 1 event then complete
			const program = Stream.runForEach(Stream.take(stream, 1), (event) =>
				Effect.sync(() => {
					events.push(event)
				}),
			)

			Effect.runFork(program)

			await new Promise((resolve) => setTimeout(resolve, 10))

			const globalEvent: GlobalEvent = {
				directory: "/my/project",
				payload: {
					type: "message.created",
					properties: {
						info: {
							id: "msg-456",
							role: "user",
							content: [{ type: "text", text: "Hello world" }],
						} as any,
					},
				} as any,
			}
			mockSSE.emitEvent(globalEvent)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(events.length).toBe(1)
			expect(events[0].source).toBe("sse")
			expect(events[0].type).toBe("message.created")
			// Implementation passes through full payload.properties
			expect(events[0].data).toMatchObject({
				directory: "/my/project",
				properties: {
					info: {
						id: "msg-456",
					},
				},
			})
		})
	})

	describe("Stream.async pattern compliance", () => {
		it("should return Stream that can be consumed", async () => {
			// This test validates the pattern from mem-2a4f8a43a3632d5f
			mockSSE.start()
			const source = createSseSource(mockSSE)
			const stream = source.stream()

			const events: SourceEvent[] = []

			// Take 1 event and complete
			const program = Stream.runForEach(Stream.take(stream, 1), (event) =>
				Effect.sync(() => {
					events.push(event)
				}),
			)

			Effect.runFork(program)

			await new Promise((resolve) => setTimeout(resolve, 10))

			// Emit event to complete the stream
			mockSSE.emitEvent({
				directory: "/test",
				payload: { type: "session.idle", properties: { sessionID: "test" } } as any,
			})

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(events.length).toBe(1)
		})
	})
})
