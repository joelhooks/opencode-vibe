/**
 * Providers API Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { providers } from "./providers.js"
import type { Provider } from "../atoms/providers.js"

/**
 * Mock globalClient for testing
 */
vi.mock("../client/index.js", () => ({
	globalClient: {
		provider: {
			list: vi.fn(() =>
				Promise.resolve({
					data: {
						all: [
							{
								id: "anthropic",
								name: "Anthropic",
								models: { "claude-3-5-sonnet": { name: "Claude 3.5 Sonnet" } },
							},
							{ id: "openai", name: "OpenAI", models: { "gpt-4": { name: "GPT-4" } } },
						],
					},
				}),
			),
		},
	},
}))

describe("providers API", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("list", () => {
		it("should fetch providers", async () => {
			const result = await providers.list()

			expect(result).toHaveLength(2)
			expect(result[0]?.id).toBe("anthropic")
			expect(result[0]?.models).toHaveLength(1)
			expect(result[1]?.id).toBe("openai")
		})
	})
})
