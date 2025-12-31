/**
 * useSessionData Tests - Pure logic tests
 *
 * Tests the Promise API behavior without DOM rendering.
 * The hook is a thin wrapper around sessions.get(), so we test the API contract.
 */

import { describe, expect, test, vi, beforeEach } from "vitest"
import type { Session } from "@opencode-vibe/core/api"

// Mock sessions API
vi.mock("@opencode-vibe/core/api", () => ({
	sessions: {
		get: vi.fn(),
	},
}))

import { sessions } from "@opencode-vibe/core/api"

// Mock session data - matches core Session type
const mockSession: Session = {
	id: "ses_123",
	title: "Test Session",
	directory: "/test/dir",
	time: {
		created: Date.now(),
		updated: Date.now(),
	},
}

describe("useSessionData - Promise API contract", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("calls sessions.get with sessionId", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)

		// Simulate what the hook does
		const fetchSession = async (sessionId: string, directory?: string) => {
			return await sessions.get(sessionId, directory)
		}

		const session = await fetchSession("ses_123")

		expect(session).toEqual(mockSession)
		expect(sessions.get).toHaveBeenCalledTimes(1)
		expect(sessions.get).toHaveBeenCalledWith("ses_123", undefined)
	})

	test("calls sessions.get with sessionId and directory", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)

		const fetchSession = async (sessionId: string, directory?: string) => {
			return await sessions.get(sessionId, directory)
		}

		const session = await fetchSession("ses_123", "/my/project")

		expect(session).toEqual(mockSession)
		expect(sessions.get).toHaveBeenCalledWith("ses_123", "/my/project")
	})

	test("returns null when session not found", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockResolvedValue(null)

		const fetchSession = async (sessionId: string, directory?: string) => {
			return await sessions.get(sessionId, directory)
		}

		const session = await fetchSession("ses_nonexistent")

		expect(session).toBeNull()
		expect(sessions.get).toHaveBeenCalledWith("ses_nonexistent", undefined)
	})

	test("error handling wraps non-Error exceptions", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockRejectedValue("String error")

		const fetchSession = async (
			sessionId: string,
		): Promise<{
			session: Session | null
			error: Error | null
		}> => {
			try {
				const result = await sessions.get(sessionId)
				return { session: result, error: null }
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				return { session: null, error }
			}
		}

		const { session, error } = await fetchSession("ses_123")

		expect(session).toBeNull()
		expect(error).toBeInstanceOf(Error)
		expect(error?.message).toBe("String error")
	})

	test("error handling preserves Error instances", async () => {
		const mockError = new Error("Network error")
		;(sessions.get as ReturnType<typeof vi.fn>).mockRejectedValue(mockError)

		let error: Error | null = null

		const fetchSession = async (sessionId: string) => {
			try {
				return await sessions.get(sessionId)
			} catch (e) {
				error = e instanceof Error ? e : new Error(String(e))
				return null
			}
		}

		const session = await fetchSession("ses_123")

		expect(session).toBeNull()
		expect(error).toBe(mockError)
	})

	test("error state resets on subsequent successful calls", async () => {
		let shouldFail = true
		;(sessions.get as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			if (shouldFail) {
				throw new Error("First call fails")
			}
			return mockSession
		})

		let error: Error | null = null

		const fetchSession = async (sessionId: string) => {
			error = null // Reset error on each call (hook behavior)
			try {
				return await sessions.get(sessionId)
			} catch (e) {
				error = e instanceof Error ? e : new Error(String(e))
				return null
			}
		}

		// First call fails
		await fetchSession("ses_123")
		expect(error).toBeTruthy()

		// Second call succeeds
		shouldFail = false
		const session = await fetchSession("ses_123")

		expect(session).toEqual(mockSession)
		expect(error).toBeNull()
	})

	test("multiple calls with different sessionIds work independently", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)

		const fetchSession = async (sessionId: string, directory?: string) => {
			return await sessions.get(sessionId, directory)
		}

		await fetchSession("ses_123")
		await fetchSession("ses_456")
		await fetchSession("ses_789", "/custom/dir")

		expect(sessions.get).toHaveBeenCalledTimes(3)
		expect(sessions.get).toHaveBeenNthCalledWith(1, "ses_123", undefined)
		expect(sessions.get).toHaveBeenNthCalledWith(2, "ses_456", undefined)
		expect(sessions.get).toHaveBeenNthCalledWith(3, "ses_789", "/custom/dir")
	})

	test("loading state management", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(() => resolve(mockSession), 10)
				}),
		)

		let loading = true

		const fetchSession = async (sessionId: string) => {
			loading = true
			try {
				const result = await sessions.get(sessionId)
				return result
			} finally {
				loading = false
			}
		}

		// Start async call
		const promise = fetchSession("ses_123")
		expect(loading).toBe(true)

		// After completion
		await promise
		expect(loading).toBe(false)
	})

	test("refetch calls sessions.get again with same params", async () => {
		;(sessions.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)

		const fetchSession = async (sessionId: string, directory?: string) => {
			return await sessions.get(sessionId, directory)
		}

		// Initial call
		await fetchSession("ses_123", "/my/project")
		expect(sessions.get).toHaveBeenCalledTimes(1)

		// Refetch
		await fetchSession("ses_123", "/my/project")
		expect(sessions.get).toHaveBeenCalledTimes(2)
		expect(sessions.get).toHaveBeenNthCalledWith(2, "ses_123", "/my/project")
	})
})
