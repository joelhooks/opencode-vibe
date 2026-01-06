/**
 * useWorldSessionList Tests - TDD approach
 *
 * Characterization tests for session list selector derived from useWorld().
 * Hook was already implemented correctly - these tests document behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useWorldSessionList } from "./use-world-session-list.js"
import type { EnrichedSession, WorldState } from "@opencode-vibe/core/world"

import type { Mock } from "vitest"

// Mock useWorld
vi.mock("./use-world.js", () => ({
	useWorld: vi.fn(),
}))

import { useWorld } from "./use-world.js"
const useWorldMock = useWorld as Mock

/**
 * Helper to create minimal WorldState mock
 */
function createMockWorldState(sessions: EnrichedSession[]): WorldState {
	const byDirectory = new Map<string, EnrichedSession[]>()
	for (const session of sessions) {
		const existing = byDirectory.get(session.directory) ?? []
		byDirectory.set(session.directory, [...existing, session])
	}

	const activeSession = sessions.find((s) => s.isActive) ?? null

	return {
		sessions,
		activeSessionCount: sessions.filter((s) => s.isActive).length,
		activeSession,
		connectionStatus: "connected",
		lastUpdated: Date.now(),
		byDirectory,
		stats: {
			total: sessions.length,
			active: sessions.filter((s) => s.isActive).length,
			streaming: 0,
		},
		// Instance layer - minimal mocks
		instances: [],
		instanceByPort: new Map(),
		instancesByDirectory: new Map(),
		connectedInstanceCount: 0,
		// Project layer - minimal mocks
		projects: [],
		projectByDirectory: new Map(),
		// Routing layer - minimal mock
		sessionToInstance: new Map(),
	}
}

describe("useWorldSessionList", () => {
	const now = Date.now()

	const mockSession1: EnrichedSession = {
		id: "session-1",
		title: "Test Session 1",
		directory: "/path/to/project",
		time: {
			created: now - 3600000,
			updated: now,
		},
		status: "running",
		isActive: true,
		messages: [],
		unreadCount: 0,
		contextUsagePercent: 45,
		lastActivityAt: now,
	}

	const mockSession2: EnrichedSession = {
		id: "session-2",
		title: "Test Session 2",
		directory: "/path/to/other",
		time: {
			created: now - 7200000,
			updated: now - 1800000,
		},
		status: "idle",
		isActive: false,
		messages: [],
		unreadCount: 2,
		contextUsagePercent: 10,
		lastActivityAt: now - 1800000,
	}

	const mockWorldState = createMockWorldState([mockSession1, mockSession2])

	beforeEach(() => {
		vi.clearAllMocks()
		// Default: return mock world state
		useWorldMock.mockReturnValue(mockWorldState)
	})

	it("returns EnrichedSession[] type", () => {
		const { result } = renderHook(() => useWorldSessionList())

		// Should return an array
		expect(Array.isArray(result.current)).toBe(true)
		expect(result.current.length).toBeGreaterThanOrEqual(0)
	})

	it("returns all sessions from world state", () => {
		const { result } = renderHook(() => useWorldSessionList())

		expect(result.current).toEqual([mockSession1, mockSession2])
		expect(result.current.length).toBe(2)
	})

	it("returns same reference when world state unchanged", () => {
		const { result, rerender } = renderHook(() => useWorldSessionList())

		const firstResult = result.current

		// Re-render without changing world state
		rerender()

		// Should return same array reference (from useWorld)
		expect(result.current).toBe(firstResult)
	})

	it("returns empty array when no sessions exist", () => {
		const emptyWorldState = createMockWorldState([])

		useWorldMock.mockReturnValue(emptyWorldState)

		const { result } = renderHook(() => useWorldSessionList())

		expect(result.current).toEqual([])
		expect(result.current.length).toBe(0)
	})

	it("updates when sessions are added to world state", () => {
		const { result, rerender } = renderHook(() => useWorldSessionList())

		// Initial state - 2 sessions
		expect(result.current.length).toBe(2)

		// Add a session
		const mockSession3: EnrichedSession = {
			id: "session-3",
			title: "Test Session 3",
			directory: "/path/to/third",
			time: {
				created: now,
				updated: now,
			},
			status: "running",
			isActive: true,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 5,
			lastActivityAt: now,
		}

		const updatedWorldState = createMockWorldState([mockSession1, mockSession2, mockSession3])

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should reflect updated state
		expect(result.current.length).toBe(3)
		expect(result.current[2]).toEqual(mockSession3)
	})

	it("updates when sessions are removed from world state", () => {
		const { result, rerender } = renderHook(() => useWorldSessionList())

		// Initial state - 2 sessions
		expect(result.current.length).toBe(2)

		// Remove a session
		const updatedWorldState = createMockWorldState([mockSession2]) // session-1 removed

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should reflect updated state
		expect(result.current.length).toBe(1)
		expect(result.current[0]).toEqual(mockSession2)
	})

	it("updates when session properties change", () => {
		const { result, rerender } = renderHook(() => useWorldSessionList())

		// Initial state
		expect(result.current[0]?.status).toBe("running")

		// Update session status
		const updatedSession: EnrichedSession = {
			...mockSession1,
			status: "idle",
			isActive: false,
		}

		const updatedWorldState = createMockWorldState([updatedSession, mockSession2])

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should reflect updated state
		expect(result.current[0]?.status).toBe("idle")
		expect(result.current[0]?.isActive).toBe(false)
	})

	it("subscribes to world state changes via useWorld", () => {
		renderHook(() => useWorldSessionList())

		// Should call useWorld to subscribe
		expect(useWorldMock).toHaveBeenCalledTimes(1)
	})
})
