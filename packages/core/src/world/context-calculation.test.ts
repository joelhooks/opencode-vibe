/**
 * Context calculation tests
 *
 * Validates the correct formula:
 * used = input + output + reasoning + cache.read (excludes cache.write)
 * usableContext = contextLimit - Math.min(outputLimit, 32000)
 * percentage = Math.round((used / usableContext) * 100)
 */

import { describe, test, expect } from "vitest"

interface TokenUsage {
	input: number
	output: number
	reasoning?: number
	cache?: {
		read: number
		write: number
	}
}

interface ModelLimits {
	context: number
	output: number
}

/**
 * Calculate context usage percentage
 *
 * @param tokens - Token usage from message
 * @param limits - Model limits
 * @returns Percentage of usable context used
 */
function calculateContextPercentage(tokens: TokenUsage, limits: ModelLimits): number {
	// CRITICAL: cache.write is billing-only, does NOT consume context
	const used = tokens.input + tokens.output + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0)

	// Reserve space for output, capped at 32K
	const outputReserve = Math.min(limits.output, 32000)
	const usableContext = limits.context - outputReserve

	return Math.round((used / usableContext) * 100)
}

describe("Context Calculation", () => {
	test("excludes cache.write from context usage", () => {
		const tokens: TokenUsage = {
			input: 1000,
			output: 500,
			reasoning: 2000,
			cache: { read: 5000, write: 3000 }, // write should be ignored
		}
		const limits: ModelLimits = {
			context: 200000,
			output: 16000,
		}

		const percentage = calculateContextPercentage(tokens, limits)

		// used = 1000 + 500 + 2000 + 5000 = 8500 (NOT 11500)
		// usableContext = 200000 - 16000 = 184000
		// percentage = Math.round((8500 / 184000) * 100) = 5
		expect(percentage).toBe(5)
	})

	test("accounts for output reserve", () => {
		const tokens: TokenUsage = {
			input: 1000,
			output: 500,
			cache: { read: 0, write: 0 },
		}
		const limits: ModelLimits = {
			context: 200000,
			output: 16000,
		}

		const percentage = calculateContextPercentage(tokens, limits)

		// used = 1500
		// usableContext = 200000 - 16000 = 184000
		// percentage = Math.round((1500 / 184000) * 100) = 1
		expect(percentage).toBe(1)
	})

	test("caps output reserve at 32K", () => {
		const tokens: TokenUsage = {
			input: 10000,
			output: 5000,
		}
		const limits: ModelLimits = {
			context: 200000,
			output: 50000, // Unrealistically high
		}

		const percentage = calculateContextPercentage(tokens, limits)

		// used = 15000
		// usableContext = 200000 - min(50000, 32000) = 168000
		// percentage = Math.round((15000 / 168000) * 100) = 9
		expect(percentage).toBe(9)
	})

	test("handles missing reasoning tokens", () => {
		const tokens: TokenUsage = {
			input: 1000,
			output: 500,
			// reasoning omitted (older models)
		}
		const limits: ModelLimits = {
			context: 200000,
			output: 16000,
		}

		const percentage = calculateContextPercentage(tokens, limits)

		// used = 1500
		// percentage = 1
		expect(percentage).toBe(1)
	})

	test("handles missing cache", () => {
		const tokens: TokenUsage = {
			input: 1000,
			output: 500,
		}
		const limits: ModelLimits = {
			context: 200000,
			output: 16000,
		}

		const percentage = calculateContextPercentage(tokens, limits)

		// used = 1500
		// percentage = 1
		expect(percentage).toBe(1)
	})

	test("real-world scenario: Claude 3.7 with caching", () => {
		const tokens: TokenUsage = {
			input: 2500,
			output: 1200,
			reasoning: 0,
			cache: { read: 12000, write: 8000 },
		}
		const limits: ModelLimits = {
			context: 200000,
			output: 16000,
		}

		const percentage = calculateContextPercentage(tokens, limits)

		// used = 2500 + 1200 + 0 + 12000 = 15700 (NOT 23700!)
		// usableContext = 200000 - 16000 = 184000
		// percentage = Math.round((15700 / 184000) * 100) = 9
		expect(percentage).toBe(9)
	})
})
