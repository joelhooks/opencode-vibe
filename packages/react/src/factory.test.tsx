/**
 * Tests for generateOpencodeHelpers factory
 *
 * Focus: Prevent infinite loop regressions from unstable references
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { generateOpencodeHelpers } from "./factory"
import { useOpencodeStore } from "./store"
import type { OpencodeConfig } from "./next-ssr-plugin"

const TEST_CONFIG: OpencodeConfig = {
	baseUrl: "/api/opencode/4056",
	directory: "/test/dir",
}

describe("factory hooks - stable references", () => {
	beforeEach(() => {
		// Reset store between tests
		useOpencodeStore.setState({
			directories: {},
		})
	})

	it("useMessages returns stable empty array when no messages", () => {
		const { useMessages } = generateOpencodeHelpers(TEST_CONFIG)

		// Initialize directory with empty messages
		useOpencodeStore.getState().initDirectory(TEST_CONFIG.directory)

		const { result, rerender } = renderHook(() => useMessages("ses_123"))

		const firstResult = result.current
		expect(firstResult).toEqual([])

		// Re-render should return SAME reference (not new array)
		rerender()
		const secondResult = result.current
		expect(secondResult).toBe(firstResult) // Same reference
	})

	it("useSessionList returns stable empty array when no sessions", () => {
		const { useSessionList } = generateOpencodeHelpers(TEST_CONFIG)

		// Initialize directory
		useOpencodeStore.getState().initDirectory(TEST_CONFIG.directory)

		const { result, rerender } = renderHook(() => useSessionList())

		const firstResult = result.current
		expect(firstResult).toEqual([])

		// Re-render should return SAME reference
		rerender()
		const secondResult = result.current
		expect(secondResult).toBe(firstResult)
	})

	it("useCompactionState returns stable default object", () => {
		const { useCompactionState } = generateOpencodeHelpers(TEST_CONFIG)

		// Initialize directory
		useOpencodeStore.getState().initDirectory(TEST_CONFIG.directory)

		const { result, rerender } = renderHook(() => useCompactionState("ses_123"))

		const firstResult = result.current
		expect(firstResult.isCompacting).toBe(false)

		// Re-render should return SAME object reference
		rerender()
		const secondResult = result.current
		expect(secondResult).toBe(firstResult)
	})

	it("useContextUsage returns stable default object", () => {
		const { useContextUsage } = generateOpencodeHelpers(TEST_CONFIG)

		// Initialize directory
		useOpencodeStore.getState().initDirectory(TEST_CONFIG.directory)

		const { result, rerender } = renderHook(() => useContextUsage("ses_123"))

		const firstResult = result.current
		expect(firstResult.used).toBe(0)

		// Re-render should return SAME object reference
		rerender()
		const secondResult = result.current
		expect(secondResult).toBe(firstResult)
	})
})
