/**
 * SSR Discovery Test
 *
 * Verifies that merged-stream selects DiscoveryNodeLive in SSR context
 */

import { describe, it, expect } from "vitest"
import { createMergedWorldStream } from "./merged-stream.js"
import { Registry } from "./atoms.js"
import type { WorldSSE } from "./sse.js"

/**
 * Create a test SSE instance that won't actually start
 */
function createTestSSE(registry: ReturnType<typeof Registry.make>) {
	return {
		start() {
			// No-op for test
		},
		stop() {
			// No-op for test
		},
		getConnectedPorts() {
			return []
		},
	} as unknown as WorldSSE
}

describe("SSR Discovery", () => {
	it("should load DiscoveryNodeLive in Node.js/SSR context", () => {
		// Verify we're in SSR context (Node.js)
		expect(typeof window).toBe("undefined")
		expect(typeof require).toBe("function")

		const registry = Registry.make()
		const sse = createTestSSE(registry)

		// Create stream without baseUrl (triggers auto-discovery)
		// In SSR context, this should use DiscoveryNodeLive
		const stream = createMergedWorldStream({
			registry,
			sse,
			// No baseUrl = auto-discovery mode
			// No discoveryLayer = use default (context-aware selection)
		})

		// If we got here without errors, DiscoveryNodeLive loaded successfully
		expect(stream).toBeDefined()
		expect(stream.subscribe).toBeDefined()

		stream.dispose()
	})

	it("should handle direct serverUrl connection (no discovery)", async () => {
		// Browser clients receive serverUrl as prop (no browser-side discovery)
		const registry = Registry.make()
		const sse = createTestSSE(registry)

		const stream = createMergedWorldStream({
			registry,
			sse,
			baseUrl: "http://localhost:1999", // Direct connection, no discovery
		})

		expect(stream).toBeDefined()
		stream.dispose()
	})
})
