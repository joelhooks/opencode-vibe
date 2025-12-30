/**
 * Sessions API Tests
 *
 * Tests for Promise-based wrappers around SessionAtom Effect programs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { sessions } from "./sessions.js"
import type { Session } from "../types/index.js"

/**
 * Mock session factory
 */
function createMockSession(overrides?: Partial<Session>): Session {
	return {
		id: "ses_123",
		title: "Test Session",
		directory: "/test/project",
		time: {
			created: Date.now(),
			updated: Date.now(),
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
			list: vi.fn(() =>
				Promise.resolve({
					data: [
						createMockSession({
							id: "ses_1",
							title: "Session 1",
							time: { created: 1000, updated: 2000 },
						}),
						createMockSession({
							id: "ses_2",
							title: "Session 2",
							time: { created: 1000, updated: 1000 },
						}),
					],
				}),
			),
			get: vi.fn(({ path }: { path: { id: string } }) =>
				Promise.resolve({
					data: createMockSession({ id: path.id, title: `Session ${path.id}` }),
				}),
			),
		},
	})),
}))

describe("sessions API", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("list", () => {
		it("should fetch sessions and return sorted by updated time descending", async () => {
			const result = await sessions.list("/test/dir")

			expect(result).toHaveLength(2)
			// Should be sorted newest first
			expect(result[0]?.id).toBe("ses_1")
			expect(result[1]?.id).toBe("ses_2")
		})

		it("should work without directory parameter", async () => {
			const result = await sessions.list()

			expect(result).toHaveLength(2)
		})
	})

	describe("get", () => {
		it("should fetch a single session by ID", async () => {
			const result = await sessions.get("ses_123", "/test/dir")

			expect(result).not.toBeNull()
			if (result) {
				expect(result.id).toBe("ses_123")
				expect(result.title).toBe("Session ses_123")
			}
		})

		it("should work without directory parameter", async () => {
			const result = await sessions.get("ses_456")

			expect(result).not.toBeNull()
			if (result) {
				expect(result.id).toBe("ses_456")
			}
		})
	})
})
