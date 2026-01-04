/**
 * Sessions API Tests
 *
 * Tests for Promise-based wrappers around SessionAtom Effect programs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { sessions, getStatus, listWithStatus } from "./sessions.js"
import type { Session, Part, Message, SessionStatus } from "../types/index.js"

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
			status: vi.fn(() =>
				Promise.resolve({
					data: {
						ses_1: { type: "busy" },
						// ses_2 not in map = idle
					},
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

	describe("listWithStatus", () => {
		it("should fetch sessions and status in parallel and join them", async () => {
			const result = await sessions.listWithStatus("/test/dir")

			expect(result).toHaveLength(2)
			// Should normalize backend status to SessionStatus
			expect(result[0]?.session.id).toBe("ses_1")
			expect(result[0]?.status).toBe("running") // { type: "busy" } → "running"
			// Session not in status map should get "completed" (idle)
			expect(result[1]?.session.id).toBe("ses_2")
			expect(result[1]?.status).toBe("completed") // no status → "completed"
		})

		it("should work without directory parameter", async () => {
			const result = await sessions.listWithStatus()

			expect(result).toHaveLength(2)
			expect(result[0]?.status).toBe("running") // { type: "busy" } → "running"
			expect(result[1]?.status).toBe("completed") // no status → "completed"
		})

		it("should handle empty session list", async () => {
			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() => Promise.resolve({ data: [] })),
					status: vi.fn(() => Promise.resolve({ data: {} })),
				},
			})

			const result = await sessions.listWithStatus("/empty/dir")

			expect(result).toHaveLength(0)
		})

		it("should handle missing status response", async () => {
			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() =>
						Promise.resolve({
							data: [createMockSession({ id: "ses_1" })],
						}),
					),
					status: vi.fn(() => Promise.resolve({ data: null })),
				},
			})

			const result = await sessions.listWithStatus("/test/dir")

			expect(result).toHaveLength(1)
			// Should default to "completed" when status map is null/undefined
			expect(result[0]?.status).toBe("completed")
		})

		it("should normalize retry status to running", async () => {
			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() =>
						Promise.resolve({
							data: [createMockSession({ id: "ses_retry" })],
						}),
					),
					status: vi.fn(() =>
						Promise.resolve({
							data: {
								ses_retry: {
									type: "retry",
									attempt: 2,
									message: "Retrying...",
									next: Date.now() + 5000,
								},
							},
						}),
					),
				},
			})

			const result = await sessions.listWithStatus("/test/dir")

			expect(result).toHaveLength(1)
			expect(result[0]?.status).toBe("running") // retry → running
		})

		it("should normalize idle status to completed", async () => {
			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() =>
						Promise.resolve({
							data: [createMockSession({ id: "ses_idle" })],
						}),
					),
					status: vi.fn(() =>
						Promise.resolve({
							data: {
								ses_idle: { type: "idle" },
							},
						}),
					),
				},
			})

			const result = await sessions.listWithStatus("/test/dir")

			expect(result).toHaveLength(1)
			expect(result[0]?.status).toBe("completed") // idle → completed
		})

		it("should filter to recent sessions only (last 4 hours)", async () => {
			const now = Date.now()
			const fiveHoursAgo = now - 5 * 60 * 60 * 1000
			const threeHoursAgo = now - 3 * 60 * 60 * 1000

			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() =>
						Promise.resolve({
							data: [
								createMockSession({
									id: "ses_old",
									time: { created: 1000, updated: fiveHoursAgo },
								}),
								createMockSession({
									id: "ses_recent",
									time: { created: 1000, updated: threeHoursAgo },
								}),
							],
						}),
					),
					status: vi.fn(() => Promise.resolve({ data: {} })),
				},
			})

			const result = await sessions.listWithStatus("/test/dir", { recentOnly: true })

			expect(result).toHaveLength(1)
			expect(result[0]?.session.id).toBe("ses_recent")
		})

		it("should respect limit option", async () => {
			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() =>
						Promise.resolve({
							data: [
								createMockSession({ id: "ses_1" }),
								createMockSession({ id: "ses_2" }),
								createMockSession({ id: "ses_3" }),
							],
						}),
					),
					status: vi.fn(() => Promise.resolve({ data: {} })),
				},
			})

			const result = await sessions.listWithStatus("/test/dir", { limit: 2 })

			expect(result).toHaveLength(2)
			expect(result[0]?.session.id).toBe("ses_1")
			expect(result[1]?.session.id).toBe("ses_2")
		})

		it("should combine recentOnly and limit options", async () => {
			const now = Date.now()
			const threeHoursAgo = now - 3 * 60 * 60 * 1000
			const twoHoursAgo = now - 2 * 60 * 60 * 1000
			const oneHourAgo = now - 1 * 60 * 60 * 1000

			const { createClient } = await import("../client/index.js")
			const mockClient = createClient as any
			mockClient.mockReturnValueOnce({
				session: {
					list: vi.fn(() =>
						Promise.resolve({
							data: [
								createMockSession({ id: "ses_1", time: { created: 1000, updated: threeHoursAgo } }),
								createMockSession({ id: "ses_2", time: { created: 1000, updated: twoHoursAgo } }),
								createMockSession({ id: "ses_3", time: { created: 1000, updated: oneHourAgo } }),
							],
						}),
					),
					status: vi.fn(() => Promise.resolve({ data: {} })),
				},
			})

			const result = await sessions.listWithStatus("/test/dir", { recentOnly: true, limit: 2 })

			expect(result).toHaveLength(2)
			// All 3 are recent, but limited to 2
			expect(result[0]?.session.id).toBe("ses_1")
			expect(result[1]?.session.id).toBe("ses_2")
		})
	})
})

describe("getStatus", () => {
	it("should return 'running' when sessionStatusMap has running status", async () => {
		const session: Session = createMockSession({ id: "ses_1" })
		const parts: Part[] = []
		const sessionStatusMap: Record<string, SessionStatus> = { ses_1: "running" }

		const status = await getStatus("ses_1", session, parts, sessionStatusMap)

		expect(status).toBe("running")
	})

	it("should return 'running' when task part is running", async () => {
		const session: Session = createMockSession({ id: "ses_1" })
		const parts: Part[] = [
			{
				id: "part_1",
				sessionID: "ses_1",
				messageID: "msg_1",
				type: "tool",
				tool: "task",
				state: { status: "running" },
			},
		]
		const sessionStatusMap: Record<string, SessionStatus> = {}

		const status = await getStatus("ses_1", session, parts, sessionStatusMap)

		expect(status).toBe("running")
	})

	it("should return 'completed' when no running indicators", async () => {
		const session: Session = createMockSession({ id: "ses_1" })
		const parts: Part[] = []
		const sessionStatusMap: Record<string, SessionStatus> = {}

		const status = await getStatus("ses_1", session, parts, sessionStatusMap)

		expect(status).toBe("completed")
	})

	it("should respect options.includeSubAgents=false", async () => {
		const session: Session = createMockSession({ id: "ses_1" })
		const parts: Part[] = [
			{
				id: "part_1",
				sessionID: "ses_1",
				messageID: "msg_1",
				type: "tool",
				tool: "task",
				state: { status: "running" },
			},
		]
		const sessionStatusMap: Record<string, SessionStatus> = {}

		const status = await getStatus("ses_1", session, parts, sessionStatusMap, {
			includeSubAgents: false,
		})

		expect(status).toBe("completed")
	})
})

describe("listWithStatus", () => {
	it("should return sessions with computed status", async () => {
		const sessions: Session[] = [
			createMockSession({ id: "ses_1", title: "Session 1" }),
			createMockSession({ id: "ses_2", title: "Session 2" }),
		]
		// Parts array - in real usage, caller filters by session
		// For this API, we expect sessionStatusMap to be the primary signal
		const parts: Part[] = []
		const sessionStatusMap: Record<string, SessionStatus> = { ses_1: "running" }

		const result = await listWithStatus(sessions, parts, sessionStatusMap)

		expect(result).toHaveLength(2)
		expect(result[0]?.session.id).toBe("ses_1")
		expect(result[0]?.status).toBe("running")
		expect(result[1]?.session.id).toBe("ses_2")
		expect(result[1]?.status).toBe("completed")
	})

	it("should handle empty sessions array", async () => {
		const result = await listWithStatus([], [], {})

		expect(result).toHaveLength(0)
	})
})
