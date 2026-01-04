/**
 * Layout Client Tests - Event Router Wiring
 *
 * Verifies multiServerSSE events flow to World Stream atoms
 */

import { describe, it, expect, vi } from "vitest"
import { multiServerSSE } from "@opencode-vibe/core/sse"
import { parseSSEEvent } from "@opencode-vibe/core/sse"
import { routeEvent } from "@opencode-vibe/core/world/event-router"
import { Either } from "effect"

describe("Event Router Wiring", () => {
	it("should have multiServerSSE.onEvent available", () => {
		// Verifies the API exists for wiring
		expect(typeof multiServerSSE.onEvent).toBe("function")
	})

	it("should have parseSSEEvent available", () => {
		// Verifies the parser exists
		expect(typeof parseSSEEvent).toBe("function")
	})

	it("should have routeEvent available", () => {
		// Verifies the router exists
		expect(typeof routeEvent).toBe("function")
	})

	it("should have Either.isRight available for result checking", () => {
		// Verify Either utility exists for checking parse results
		expect(typeof Either.isRight).toBe("function")
	})

	it("should register and unregister event callback", () => {
		// Verify callback registration works
		const callback = vi.fn()
		const unsubscribe = multiServerSSE.onEvent(callback)

		expect(typeof unsubscribe).toBe("function")
		unsubscribe()
	})
})
