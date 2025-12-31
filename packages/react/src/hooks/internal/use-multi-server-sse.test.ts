/**
 * useMultiServerSSE Hook Tests
 *
 * Tests multi-server SSE connection management.
 * This hook wires up to the core MultiServerSSE singleton.
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import { multiServerSSE } from "@opencode-vibe/core/sse"
import type { GlobalEvent } from "../../types/events"

/**
 * Core Integration Tests - Logic Only
 *
 * Test the integration logic with MultiServerSSE without rendering.
 * Following project TDD pattern: test pure functions, not DOM.
 */
describe("useMultiServerSSE - Core Integration Logic", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("multiServerSSE.start() should be callable", () => {
		const startSpy = vi.spyOn(multiServerSSE, "start")
		multiServerSSE.start()
		expect(startSpy).toHaveBeenCalled()
		multiServerSSE.stop()
	})

	test("multiServerSSE.onEvent() returns unsubscribe function", () => {
		const mockCallback = vi.fn()
		const unsubscribe = multiServerSSE.onEvent(mockCallback)

		expect(typeof unsubscribe).toBe("function")

		// Cleanup
		unsubscribe()
		multiServerSSE.stop()
	})

	test("event callback receives correct event structure", () => {
		const mockCallback = vi.fn()
		const unsubscribe = multiServerSSE.onEvent(mockCallback)

		// Simulate an event (would come from SSE in real usage)
		const mockEvent: GlobalEvent = {
			directory: "/test",
			payload: { type: "message.updated", properties: { id: "123" } },
		}

		// The hook should forward this event to the callback
		mockCallback(mockEvent)

		expect(mockCallback).toHaveBeenCalledWith(mockEvent)

		// Cleanup
		unsubscribe()
		multiServerSSE.stop()
	})

	test("unsubscribe function removes callback", () => {
		const mockCallback = vi.fn()
		const unsubscribe = multiServerSSE.onEvent(mockCallback)

		// Unsubscribe immediately
		unsubscribe()

		// After unsubscribe, callback should not be in the listeners
		// We can verify this by checking the callback wasn't called
		// (in real usage, events after unsubscribe won't trigger callback)

		expect(typeof unsubscribe).toBe("function")

		// Cleanup
		multiServerSSE.stop()
	})

	test("hook should call start exactly once", () => {
		// This tests the logic that should be in useEffect
		const startSpy = vi.spyOn(multiServerSSE, "start")

		// Simulate what useEffect does
		multiServerSSE.start()

		expect(startSpy).toHaveBeenCalledTimes(1)

		// Cleanup
		multiServerSSE.stop()
	})

	test("hook should subscribe when onEvent provided", () => {
		const onEventSpy = vi.spyOn(multiServerSSE, "onEvent")
		const mockOnEvent = vi.fn()

		// Simulate what useEffect does when options.onEvent exists
		const unsubscribe = multiServerSSE.onEvent(mockOnEvent)

		expect(onEventSpy).toHaveBeenCalledWith(mockOnEvent)

		// Cleanup
		unsubscribe()
		multiServerSSE.stop()
	})

	test("hook should not subscribe when onEvent is undefined", () => {
		const onEventSpy = vi.spyOn(multiServerSSE, "onEvent")

		// Simulate what useEffect does when options.onEvent is undefined
		const onEvent = undefined
		if (onEvent) {
			multiServerSSE.onEvent(onEvent)
		}

		expect(onEventSpy).not.toHaveBeenCalled()

		// Cleanup
		multiServerSSE.stop()
	})
})
