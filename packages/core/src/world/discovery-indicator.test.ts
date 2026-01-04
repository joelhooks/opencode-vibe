/**
 * Discovery Indicator Integration Test
 *
 * Verifies the discovering → connected/disconnected state transitions
 */

import { describe, expect, it } from "vitest"
import { Registry, connectionStatusAtom } from "./atoms.js"
import { WorldSSE } from "./sse.js"

describe("Discovery Indicator", () => {
	it("sets discovering status on start when no serverUrl provided", () => {
		const registry = Registry.make()
		const sse = new WorldSSE(registry, {})

		// Initial state
		expect(registry.get(connectionStatusAtom)).toBe("disconnected")

		// Start discovery (no serverUrl = auto-discovery)
		sse.start()

		// Should transition to discovering
		expect(registry.get(connectionStatusAtom)).toBe("discovering")

		sse.stop()
	})

	it("sets connecting status on start when serverUrl is provided", () => {
		const registry = Registry.make()
		const sse = new WorldSSE(registry, {
			serverUrl: "http://localhost:1999",
		})

		// Initial state
		expect(registry.get(connectionStatusAtom)).toBe("disconnected")

		// Start with direct serverUrl
		sse.start()

		// Should skip discovery and go straight to connecting
		expect(registry.get(connectionStatusAtom)).toBe("connecting")

		sse.stop()
	})

	it("transitions from discovering to connecting/connected/disconnected after discovery completes", async () => {
		const registry = Registry.make()
		const sse = new WorldSSE(registry, {
			discoveryIntervalMs: 100, // Fast polling for test
		})

		sse.start()
		expect(registry.get(connectionStatusAtom)).toBe("discovering")

		// Wait for discovery loop to run
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Should transition from discovering to one of: connecting, connected, or disconnected
		// (depends on whether servers were found in the environment)
		const status = registry.get(connectionStatusAtom)
		expect(["connecting", "connected", "disconnected"]).toContain(status)
		expect(status).not.toBe("discovering") // Should have transitioned away from discovering

		sse.stop()
	})
})
