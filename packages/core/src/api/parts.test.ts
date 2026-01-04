/**
 * Parts API Tests
 *
 * Tests for Promise-based wrappers around PartAtom Effect programs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { parts } from "./parts.js"
import type { Part } from "../types/index.js"

/**
 * Mock part factory
 */
function createMockPart(overrides?: Partial<Part>): Part {
	return {
		id: "part_123",
		sessionID: "ses_123",
		messageID: "msg_123",
		type: "text",
		text: "Hello",
		...overrides,
	} as Part
}

/**
 * Mock createClient for testing
 */
vi.mock("../client/index.js", () => ({
	createClient: vi.fn(() => ({
		session: {
			messages: vi.fn(() =>
				Promise.resolve({
					data: [
						{
							info: { id: "msg_1" },
							parts: [createMockPart({ id: "part_1", messageID: "msg_1" })],
						},
						{
							info: { id: "msg_2" },
							parts: [createMockPart({ id: "part_2", messageID: "msg_2" })],
						},
					],
				}),
			),
		},
	})),
}))

describe("parts API", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("list", () => {
		it("should fetch parts for a session", async () => {
			const result = await parts.list("ses_123", "/test/dir")

			expect(result).toHaveLength(2)
			expect(result[0]?.id).toBe("part_1")
			expect(result[1]?.id).toBe("part_2")
		})

		it("should work without directory parameter", async () => {
			const result = await parts.list("ses_123")

			expect(result).toHaveLength(2)
		})
	})

	describe("get", () => {
		it("should fetch a single part by ID", async () => {
			const result = await parts.get("ses_123", "part_1", "/test/dir")

			expect(result).not.toBeNull()
			if (result) {
				expect(result.id).toBe("part_1")
			}
		})

		it("should return null when part not found", async () => {
			const result = await parts.get("ses_123", "nonexistent")

			expect(result).toBeNull()
		})
	})
})
