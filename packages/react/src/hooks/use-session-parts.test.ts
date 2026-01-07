/**
 * useSessionParts Tests - TDD approach
 *
 * Tests written FIRST before implementation.
 * Validates convenience wrapper around useSessionAtom that returns flattened parts array.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSessionParts } from "./use-session-parts.js"
import type { EnrichedSession } from "@opencode-vibe/core/world/types"

// Mock useSession
vi.mock("./use-session.js", () => ({
	useSession: vi.fn(),
}))

const { useSession } = await import("./use-session.js")
const mockUseSession = useSession as ReturnType<typeof vi.fn>

describe("useSessionParts", () => {
	const createMockMessage = (id: string, parts: any[] = []): any => ({
		id,
		sessionID: "test-session",
		role: "assistant",
		time: { created: Date.now() },
		parts,
		isStreaming: false,
	})

	const emptySession: EnrichedSession = {
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
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("returns flattened parts array from all messages", () => {
		const mockPart1 = {
			id: "part-1",
			sessionID: "test-session",
			messageID: "msg-1",
			type: "text",
			text: "Hello",
			time: { start: Date.now() },
		}

		const mockPart2 = {
			id: "part-2",
			sessionID: "test-session",
			messageID: "msg-2",
			type: "text",
			text: "World",
			time: { start: Date.now() },
		}

		mockUseSession.mockReturnValue({
			...emptySession,
			id: "test-session",
			messages: [createMockMessage("msg-1", [mockPart1]), createMockMessage("msg-2", [mockPart2])],
		})

		const { result } = renderHook(() => useSessionParts("test-session"))

		expect(result.current).toEqual([mockPart1, mockPart2])
		expect(result.current).toHaveLength(2)
	})

	it("returns empty array when session has no messages", () => {
		mockUseSession.mockReturnValue({
			...emptySession,
			id: "test-session",
		})

		const { result } = renderHook(() => useSessionParts("test-session"))

		expect(result.current).toEqual([])
		expect(result.current).toHaveLength(0)
	})

	it("returns empty array when messages have no parts", () => {
		mockUseSession.mockReturnValue({
			...emptySession,
			id: "test-session",
			messages: [createMockMessage("msg-1", []), createMockMessage("msg-2", [])],
		})

		const { result } = renderHook(() => useSessionParts("test-session"))

		expect(result.current).toEqual([])
	})

	it("returns empty array when sessionId is null", () => {
		mockUseSession.mockReturnValue(emptySession)

		const { result } = renderHook(() => useSessionParts(null))

		expect(result.current).toEqual([])
	})

	it("returns empty array when sessionId is undefined", () => {
		mockUseSession.mockReturnValue(emptySession)

		const { result } = renderHook(() => useSessionParts(undefined))

		expect(result.current).toEqual([])
	})

	it("delegates to useSession with correct sessionId", () => {
		const mockPart = {
			id: "part-1",
			sessionID: "specific-session",
			messageID: "msg-1",
			type: "text",
			text: "Test",
			time: { start: Date.now() },
		}

		mockUseSession.mockReturnValue({
			...emptySession,
			id: "specific-session",
			messages: [createMockMessage("msg-1", [mockPart])],
		})

		renderHook(() => useSessionParts("specific-session"))

		expect(useSession).toHaveBeenCalledWith("specific-session")
		expect(useSession).toHaveBeenCalledTimes(1)
	})

	it("flattens parts from multiple messages correctly", () => {
		const part1a = { id: "part-1a", type: "text", messageID: "msg-1" }
		const part1b = { id: "part-1b", type: "text", messageID: "msg-1" }
		const part2a = { id: "part-2a", type: "text", messageID: "msg-2" }

		mockUseSession.mockReturnValue({
			...emptySession,
			id: "test-session",
			messages: [
				createMockMessage("msg-1", [part1a, part1b]),
				createMockMessage("msg-2", [part2a]),
			],
		})

		const { result } = renderHook(() => useSessionParts("test-session"))

		expect(result.current).toEqual([part1a, part1b, part2a])
		expect(result.current).toHaveLength(3)
	})

	it("maintains message order when flattening parts", () => {
		const part1 = { id: "part-1", messageID: "msg-1" }
		const part2 = { id: "part-2", messageID: "msg-2" }
		const part3 = { id: "part-3", messageID: "msg-3" }

		mockUseSession.mockReturnValue({
			...emptySession,
			id: "test-session",
			messages: [
				createMockMessage("msg-1", [part1]),
				createMockMessage("msg-2", [part2]),
				createMockMessage("msg-3", [part3]),
			],
		})

		const { result } = renderHook(() => useSessionParts("test-session"))

		expect(result.current[0]).toEqual(part1)
		expect(result.current[1]).toEqual(part2)
		expect(result.current[2]).toEqual(part3)
	})
})
