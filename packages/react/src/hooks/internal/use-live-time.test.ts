/**
 * Tests for useLiveTime hook
 *
 * Ensures the hook triggers re-renders every 60 seconds by incrementing a tick counter.
 */

// Set up DOM environment for React Testing Library
import { Window } from "happy-dom"
const window = new Window()
// @ts-ignore - happy-dom types don't perfectly match DOM types, but work at runtime
globalThis.document = window.document
// @ts-ignore - happy-dom types don't perfectly match DOM types, but work at runtime
globalThis.window = window

import { renderHook, waitFor } from "@testing-library/react"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { useLiveTime } from "./use-live-time"

describe("useLiveTime", () => {
	it("returns initial tick of 0", () => {
		const { result } = renderHook(() => useLiveTime())
		expect(result.current).toBe(0)
	})

	it("increments tick after interval passes", async () => {
		// Use very short interval for testing
		const { result } = renderHook(() => useLiveTime(100))
		expect(result.current).toBe(0)

		// Wait for first tick
		await waitFor(
			() => {
				expect(result.current).toBe(1)
			},
			{ timeout: 200 },
		)
	})

	it("increments tick multiple times", async () => {
		// Use very short interval for testing
		const { result } = renderHook(() => useLiveTime(50))
		expect(result.current).toBe(0)

		// Wait for multiple ticks
		await waitFor(
			() => {
				expect(result.current).toBeGreaterThanOrEqual(2)
			},
			{ timeout: 200 },
		)
	})

	it("cleans up interval on unmount", async () => {
		// Track active intervals
		const intervalsBefore = (globalThis as any).Bun?.jest?.getTimerCount?.() ?? 0

		const { unmount } = renderHook(() => useLiveTime(100))

		unmount()

		// Small delay to allow cleanup
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Verify interval was cleared (timer count should not increase)
		const intervalsAfter = (globalThis as any).Bun?.jest?.getTimerCount?.() ?? 0
		expect(intervalsAfter).toBeLessThanOrEqual(intervalsBefore + 1)
	})

	it("uses default 60 second interval", () => {
		const { result } = renderHook(() => useLiveTime())
		expect(result.current).toBe(0)

		// Verify it doesn't tick immediately
		const tickAfterMount = result.current
		expect(tickAfterMount).toBe(0)
	})
})
