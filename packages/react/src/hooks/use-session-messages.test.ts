/**
 * useSessionMessages Tests - TDD approach
 *
 * Tests written FIRST before implementation.
 * Validates convenience hook that extracts just messages array from useSessionAtom.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSessionMessages } from "./use-session-messages.js"
import type { EnrichedMessage } from "@opencode-vibe/core/world/types"

// Mock useSession (which is aliased as useSessionAtom in index.ts)
vi.mock("./use-session.js", () => ({
	useSession: vi.fn(),
}))

const useSession = vi.mocked(await import("./use-session.js").then((m) => m.useSession))

describe("useSessionMessages", () => {
	const mockMessages: EnrichedMessage[] = [
		{
			id: "msg-1",
			sessionID: "session-1",
			role: "user",
			time: { created: Date.now() },
			parts: [],
			isStreaming: false,
		},
		{
			id: "msg-2",
			sessionID: "session-1",
			role: "assistant",
			time: { created: Date.now() },
			parts: [],
			isStreaming: false,
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("returns messages array from EnrichedSession", () => {
		useSession.mockReturnValue({
			id: "session-1",
			title: "Test Session",
			directory: "/test",
			time: { created: 0, updated: 0 },
			status: "running",
			isActive: true,
			messages: mockMessages,
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: Date.now(),
		})

		const { result } = renderHook(() => useSessionMessages("session-1"))

		expect(result.current).toEqual(mockMessages)
		expect(result.current).toHaveLength(2)
		expect(result.current[0]?.id).toBe("msg-1")
	})

	it("returns empty array when sessionId is null", () => {
		useSession.mockReturnValue({
			id: "",
			title: "",
			directory: "",
			time: { created: 0, updated: 0 },
			status: "completed",
			isActive: false,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: 0,
		})

		const { result } = renderHook(() => useSessionMessages(null))

		expect(result.current).toEqual([])
	})

	it("returns empty array when sessionId is undefined", () => {
		useSession.mockReturnValue({
			id: "",
			title: "",
			directory: "",
			time: { created: 0, updated: 0 },
			status: "completed",
			isActive: false,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: 0,
		})

		const { result } = renderHook(() => useSessionMessages(undefined))

		expect(result.current).toEqual([])
	})

	it("returns empty array when EnrichedSession has empty messages", () => {
		useSession.mockReturnValue({
			id: "session-2",
			title: "Empty Session",
			directory: "/test",
			time: { created: 0, updated: 0 },
			status: "completed",
			isActive: false,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: 0,
		})

		const { result } = renderHook(() => useSessionMessages("session-2"))

		expect(result.current).toEqual([])
	})

	it("calls useSession with correct sessionId", () => {
		useSession.mockReturnValue({
			id: "session-3",
			title: "Test",
			directory: "/test",
			time: { created: 0, updated: 0 },
			status: "completed",
			isActive: false,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: 0,
		})

		renderHook(() => useSessionMessages("session-3"))

		expect(useSession).toHaveBeenCalledWith("session-3")
		expect(useSession).toHaveBeenCalledTimes(1)
	})

	it("has correct type signature returning EnrichedMessage[]", () => {
		useSession.mockReturnValue({
			id: "session-1",
			title: "Test",
			directory: "/test",
			time: { created: 0, updated: 0 },
			status: "running",
			isActive: true,
			messages: mockMessages,
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: Date.now(),
		})

		const { result } = renderHook(() => useSessionMessages("session-1"))

		// Type check: result should be EnrichedMessage[]
		const messages: EnrichedMessage[] = result.current
		expect(Array.isArray(messages)).toBe(true)
	})

	it("updates when messages change", () => {
		const firstMessage = mockMessages[0]
		if (!firstMessage) throw new Error("Test setup error")
		const initialMessages: EnrichedMessage[] = [firstMessage]
		const updatedMessages: EnrichedMessage[] = mockMessages

		useSession.mockReturnValue({
			id: "session-1",
			title: "Test",
			directory: "/test",
			time: { created: 0, updated: 0 },
			status: "running",
			isActive: true,
			messages: initialMessages,
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: Date.now(),
		})

		const { result, rerender } = renderHook(() => useSessionMessages("session-1"))

		expect(result.current).toHaveLength(1)

		// Update mock to return new messages
		useSession.mockReturnValue({
			id: "session-1",
			title: "Test",
			directory: "/test",
			time: { created: 0, updated: 0 },
			status: "running",
			isActive: true,
			messages: updatedMessages,
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: Date.now(),
		})

		rerender()

		expect(result.current).toHaveLength(2)
	})
})
