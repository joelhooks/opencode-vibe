/**
 * useContextUsage Tests - Store selector tests
 *
 * Tests the hook logic without DOM rendering.
 * Hook is a pure selector - test by calling store directly.
 */

import { describe, expect, test, beforeEach } from "vitest"
import { useOpencodeStore } from "../../store"
import { formatTokens } from "./use-context-usage"

describe("useContextUsage - store integration", () => {
	beforeEach(() => {
		// Reset store before each test
		useOpencodeStore.setState({ directories: {} })
	})

	test("returns default state when no usage exists", () => {
		const directory = "/test/project"
		useOpencodeStore.getState().initDirectory(directory)

		const usage = useOpencodeStore.getState().directories[directory]?.contextUsage["session-1"]

		expect(usage).toBeUndefined()
		// Hook returns default via ?? operator
		const defaultUsage = usage ?? {
			used: 0,
			limit: 200000,
			percentage: 0,
			isNearLimit: false,
			tokens: {
				input: 0,
				output: 0,
				cached: 0,
			},
			lastUpdated: 0,
		}
		expect(defaultUsage.used).toBe(0)
		expect(defaultUsage.limit).toBe(200000)
	})

	test("returns context usage from store when it exists", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		// Manually set context usage using setState (store calculates this from message events)
		useOpencodeStore.setState((state) => {
			const dir = state.directories[directory]
			if (dir) {
				dir.contextUsage["session-1"] = {
					used: 10000,
					limit: 200000,
					percentage: 5,
					isNearLimit: false,
					tokens: {
						input: 8000,
						output: 2000,
						cached: 1000,
					},
					lastUpdated: Date.now(),
				}
			}
		})

		const usage = useOpencodeStore.getState().directories[directory]?.contextUsage["session-1"]

		expect(usage?.used).toBe(10000)
		expect(usage?.percentage).toBe(5)
		expect(usage?.isNearLimit).toBe(false)
	})

	test("updates when context usage changes in store", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		const initialUsage = store.directories[directory]?.contextUsage["session-1"]
		expect(initialUsage).toBeUndefined()

		// Update context usage using setState
		useOpencodeStore.setState((state) => {
			const dir = state.directories[directory]
			if (dir) {
				dir.contextUsage["session-1"] = {
					used: 180000,
					limit: 200000,
					percentage: 90,
					isNearLimit: true,
					tokens: {
						input: 150000,
						output: 30000,
						cached: 10000,
					},
					lastUpdated: Date.now(),
				}
			}
		})

		const updatedUsage =
			useOpencodeStore.getState().directories[directory]?.contextUsage["session-1"]

		expect(updatedUsage?.used).toBe(180000)
		expect(updatedUsage?.percentage).toBe(90)
		expect(updatedUsage?.isNearLimit).toBe(true)
	})
})

describe("formatTokens", () => {
	test("formats small numbers as-is", () => {
		expect(formatTokens(0)).toBe("0")
		expect(formatTokens(100)).toBe("100")
		expect(formatTokens(999)).toBe("999")
	})

	test("formats thousands with K suffix", () => {
		expect(formatTokens(1000)).toBe("1.0K")
		expect(formatTokens(1500)).toBe("1.5K")
		expect(formatTokens(25000)).toBe("25.0K")
	})

	test("formats millions with M suffix", () => {
		expect(formatTokens(1000000)).toBe("1.0M")
		expect(formatTokens(2500000)).toBe("2.5M")
	})
})
