/**
 * useMessages Tests - World Stream Migration
 *
 * TDD: Tests written FIRST
 * Tests the migration of useMessages from Zustand to World Stream
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import type { WorldState, EnrichedMessage, EnrichedSession } from "@opencode-vibe/core/world"

// Mock useWorld hook
vi.mock("../use-world.js", () => ({
	useWorld: vi.fn(),
}))

import { useWorld } from "../use-world.js"
import { useMessages } from "./use-messages.js"

const mockUseWorld = vi.mocked(useWorld)

describe("useMessages (World Stream migration)", () => {
	const createMockMessage = (id: string, sessionID = "ses_123"): EnrichedMessage =>
		({
			id,
			sessionID,
			role: "user",
			time: { created: Date.now() },
			parts: [],
			isStreaming: false,
		}) as EnrichedMessage

	const createMockSession = (sessionId: string, messages: EnrichedMessage[]): EnrichedSession => ({
		id: sessionId,
		title: "Test Session",
		directory: "/test",
		time: { created: Date.now(), updated: Date.now() },
		status: "idle",
		isActive: false,
		messages,
		unreadCount: 0,
		contextUsagePercent: 0,
		lastActivityAt: Date.now(),
	})

	const createMockWorldState = (sessions: EnrichedSession[]): WorldState => ({
		sessions,
		activeSessionCount: 0,
		activeSession: null,
		connectionStatus: "connected",
		lastUpdated: Date.now(),
		byDirectory: new Map(),
		stats: { total: sessions.length, active: 0, streaming: 0 },
		// Instance layer
		instances: [],
		instanceByPort: new Map(),
		instancesByDirectory: new Map(),
		connectedInstanceCount: 0,
		// Project layer
		projects: [],
		projectByDirectory: new Map(),
		// Routing layer
		sessionToInstance: new Map(),
	})

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns EnrichedMessage[] type (backward compat)", () => {
		const messages = [createMockMessage("msg_1")]
		const session = createMockSession("ses_123", messages)
		mockUseWorld.mockReturnValue(createMockWorldState([session]))

		const { result } = renderHook(() => useMessages("ses_123"))

		// Type assertion - ensures return type is correct
		const msgs: EnrichedMessage[] = result.current
		expect(msgs).toEqual(messages)
	})

	it("returns empty array if session not found", () => {
		mockUseWorld.mockReturnValue(createMockWorldState([]))

		const { result } = renderHook(() => useMessages("ses_nonexistent"))

		expect(result.current).toEqual([])
		expect(result.current).toBeInstanceOf(Array)
	})

	it("returns messages from session when found", () => {
		const messages = [
			createMockMessage("msg_1"),
			createMockMessage("msg_2"),
			createMockMessage("msg_3"),
		]
		const session = createMockSession("ses_123", messages)
		mockUseWorld.mockReturnValue(createMockWorldState([session]))

		const { result } = renderHook(() => useMessages("ses_123"))

		expect(result.current).toEqual(messages)
		expect(result.current).toHaveLength(3)
	})

	it("updates when world state changes", () => {
		const initialMessages = [createMockMessage("msg_1")]
		const initialSession = createMockSession("ses_123", initialMessages)
		mockUseWorld.mockReturnValue(createMockWorldState([initialSession]))

		const { result, rerender } = renderHook(() => useMessages("ses_123"))

		expect(result.current).toHaveLength(1)
		expect(result.current[0]?.id).toBe("msg_1")

		// Simulate new message added
		const updatedMessages = [createMockMessage("msg_1"), createMockMessage("msg_2")]
		const updatedSession = createMockSession("ses_123", updatedMessages)
		mockUseWorld.mockReturnValue(createMockWorldState([updatedSession]))
		rerender()

		expect(result.current).toHaveLength(2)
		expect(result.current[1]?.id).toBe("msg_2")
	})

	it("memoizes result to prevent unnecessary re-renders", () => {
		const messages = [createMockMessage("msg_1")]
		const session = createMockSession("ses_123", messages)
		const worldState = createMockWorldState([session])
		mockUseWorld.mockReturnValue(worldState)

		const { result, rerender } = renderHook(() => useMessages("ses_123"))

		const firstResult = result.current
		expect(firstResult).toHaveLength(1)

		// Rerender with SAME world state (same session reference)
		rerender()

		const secondResult = result.current
		// Should be same reference (memoized)
		expect(secondResult).toBe(firstResult)
	})

	it("returns different array reference when messages actually change", () => {
		const messages1 = [createMockMessage("msg_1")]
		const session1 = createMockSession("ses_123", messages1)
		mockUseWorld.mockReturnValue(createMockWorldState([session1]))

		const { result, rerender } = renderHook(() => useMessages("ses_123"))

		const firstResult = result.current
		expect(firstResult).toHaveLength(1)

		// DIFFERENT messages array
		const messages2 = [createMockMessage("msg_1"), createMockMessage("msg_2")]
		const session2 = createMockSession("ses_123", messages2)
		mockUseWorld.mockReturnValue(createMockWorldState([session2]))
		rerender()

		const secondResult = result.current
		// Should be different reference (messages changed)
		expect(secondResult).not.toBe(firstResult)
		expect(secondResult).toHaveLength(2)
	})

	it("handles switching between sessions", () => {
		const session1 = createMockSession("ses_123", [createMockMessage("msg_1", "ses_123")])
		const session2 = createMockSession("ses_456", [
			createMockMessage("msg_2", "ses_456"),
			createMockMessage("msg_3", "ses_456"),
		])
		mockUseWorld.mockReturnValue(createMockWorldState([session1, session2]))

		const { result, rerender } = renderHook(({ sessionId }) => useMessages(sessionId), {
			initialProps: { sessionId: "ses_123" },
		})

		expect(result.current).toHaveLength(1)
		expect(result.current[0]?.id).toBe("msg_1")

		// Switch to different session
		rerender({ sessionId: "ses_456" })

		expect(result.current).toHaveLength(2)
		expect(result.current[0]?.id).toBe("msg_2")
		expect(result.current[1]?.id).toBe("msg_3")
	})

	it("handles session with no messages", () => {
		const session = createMockSession("ses_123", [])
		mockUseWorld.mockReturnValue(createMockWorldState([session]))

		const { result } = renderHook(() => useMessages("ses_123"))

		expect(result.current).toEqual([])
		expect(result.current).toHaveLength(0)
	})

	it("maintains backward compatibility with Zustand version (always returns array)", () => {
		// Old version returned EMPTY_MESSAGES constant when not found
		// New version should return empty array (but can be different instance)
		mockUseWorld.mockReturnValue(createMockWorldState([]))

		const { result } = renderHook(() => useMessages("ses_nonexistent"))

		expect(Array.isArray(result.current)).toBe(true)
		expect(result.current).toHaveLength(0)
	})
})
