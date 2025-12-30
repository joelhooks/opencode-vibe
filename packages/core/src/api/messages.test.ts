/**
 * Messages API Tests
 *
 * Tests for Promise-based wrappers around MessageAtom Effect programs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { messages } from "./messages.js"
import type { Message } from "../types/index.js"

/**
 * Mock message factory
 */
function createMockMessage(overrides?: Partial<Message>): Message {
	return {
		id: "msg_123",
		role: "user",
		sessionID: "ses_123",
		time: {
			created: Date.now(),
			completed: Date.now(),
		},
		...overrides,
	}
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
						{ info: createMockMessage({ id: "msg_1" }), parts: [] },
						{ info: createMockMessage({ id: "msg_2" }), parts: [] },
					],
				}),
			),
		},
	})),
}))

describe("messages API", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("list", () => {
		it("should fetch messages for a session", async () => {
			const result = await messages.list("ses_123", "/test/dir")

			expect(result).toHaveLength(2)
			expect(result[0]?.id).toBe("msg_1")
			expect(result[1]?.id).toBe("msg_2")
		})

		it("should work without directory parameter", async () => {
			const result = await messages.list("ses_123")

			expect(result).toHaveLength(2)
		})
	})

	describe("get", () => {
		it("should fetch a single message by ID", async () => {
			const result = await messages.get("ses_123", "msg_1", "/test/dir")

			expect(result).not.toBeNull()
			if (result) {
				expect(result.id).toBe("msg_1")
			}
		})

		it("should return null when message not found", async () => {
			const result = await messages.get("ses_123", "nonexistent")

			expect(result).toBeNull()
		})
	})
})
