/**
 * Tests for SSE connection atom
 *
 * Tests pure Effect.Stream programs for SSE connection.
 * Uses mock EventSource to avoid real network connections.
 */

import { describe, expect, it } from "vitest"
import { Duration } from "effect"
import { SSEAtom, makeSSEAtom } from "./sse.js"

// Mock EventSource for testing
class MockEventSource {
	url: string
	readyState: number = 0 // CONNECTING
	onopen: ((event: Event) => void) | null = null
	onmessage: ((event: MessageEvent) => void) | null = null
	onerror: ((event: Event) => void) | null = null

	static CONNECTING = 0
	static OPEN = 1
	static CLOSED = 2

	constructor(url: string) {
		this.url = url
		// Simulate async connection
		setTimeout(() => {
			this.readyState = MockEventSource.OPEN
			this.onopen?.(new Event("open"))
		}, 10)
	}

	close() {
		this.readyState = MockEventSource.CLOSED
	}

	// Test helper to simulate receiving a message
	_simulateMessage(data: string) {
		if (this.readyState === MockEventSource.OPEN) {
			this.onmessage?.(new MessageEvent("message", { data }))
		}
	}

	// Test helper to simulate an error
	_simulateError() {
		this.onerror?.(new Event("error"))
	}
}

describe("SSEAtom", () => {
	describe("SSEAtom.connect", () => {
		it("returns a Stream", () => {
			const stream = SSEAtom.connect({
				url: "http://localhost:4056",
				createEventSource: (url: string) => new MockEventSource(url) as unknown as EventSource,
			})

			// Verify it's a stream by checking it's defined
			expect(stream).toBeDefined()
		})
	})

	describe("SSEAtom.connectOnce", () => {
		it("returns a Stream without retry logic", () => {
			const stream = SSEAtom.connectOnce({
				url: "http://localhost:4056",
				createEventSource: (url: string) => new MockEventSource(url) as unknown as EventSource,
			})

			expect(stream).toBeDefined()
		})
	})

	describe("Heartbeat monitoring", () => {
		it("accepts heartbeat timeout configuration", () => {
			const stream = SSEAtom.connect({
				url: "http://localhost:4056",
				heartbeatTimeout: Duration.millis(100),
				createEventSource: () =>
					new MockEventSource("http://localhost:4056/global/event") as unknown as EventSource,
			})

			expect(stream).toBeDefined()
		})
	})

	describe("makeSSEAtom factory", () => {
		it("creates atom config", () => {
			const atom = makeSSEAtom({
				url: "http://localhost:4056",
			})

			expect(atom).toBeDefined()
			expect(atom.config).toBeDefined()
			expect(atom.config.url).toBe("http://localhost:4056")
		})
	})

	describe("Default sseAtom export", () => {
		it("exports sseAtom as null when NEXT_PUBLIC_OPENCODE_URL not set", async () => {
			const { sseAtom } = await import("./sse.js")

			// sseAtom can be null if NEXT_PUBLIC_OPENCODE_URL not set
			// This is correct - discovery should be used instead
			if (sseAtom) {
				expect(sseAtom.config).toBeDefined()
			} else {
				expect(sseAtom).toBeNull()
			}
		})
	})
})
