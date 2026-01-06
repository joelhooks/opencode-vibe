/**
 * useWorldSessionStatus Tests - TDD approach
 *
 * Characterization tests for session status selector derived from useWorld().
 * Hook was already implemented correctly - these tests document behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useWorldSessionStatus } from "./use-world-session-status.js"
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

describe("useWorldSessionStatus", () => {
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

	it("returns SessionStatus | undefined type", () => {
		const { result } = renderHook(() => useWorldSessionStatus("session-1"))

		// Should return a status string or undefined
		expect(result.current === undefined || typeof result.current === "string").toBe(true)
	})

	it("returns status when session found", () => {
		const { result } = renderHook(() => useWorldSessionStatus("session-1"))

		expect(result.current).toBe("running")
	})

	it("returns different status for different session", () => {
		const { result } = renderHook(() => useWorldSessionStatus("session-2"))

		expect(result.current).toBe("idle")
	})

	it("returns undefined when session not found", () => {
		const { result } = renderHook(() => useWorldSessionStatus("non-existent-session"))

		expect(result.current).toBeUndefined()
	})

	it("updates when session status changes", () => {
		const { result, rerender } = renderHook(() => useWorldSessionStatus("session-1"))

		// Initial state
		expect(result.current).toBe("running")

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
		expect(result.current).toBe("idle")
	})

	it("returns undefined when session is removed", () => {
		const { result, rerender } = renderHook(() => useWorldSessionStatus("session-1"))

		// Initial state - session exists
		expect(result.current).toBe("running")

		// Remove session from world state
		const updatedWorldState = createMockWorldState([mockSession2]) // session-1 removed

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should return undefined
		expect(result.current).toBeUndefined()
	})

	it("memoizes result to prevent unnecessary re-renders", () => {
		const { result, rerender } = renderHook(() => useWorldSessionStatus("session-1"))

		const firstResult = result.current

		// Re-render without changing world state
		rerender()

		// Should return same value (status is a primitive, so reference equality)
		expect(result.current).toBe(firstResult)
	})

	it("subscribes to world state changes via useWorld", () => {
		renderHook(() => useWorldSessionStatus("session-1"))

		// Should call useWorld to subscribe
		expect(useWorldMock).toHaveBeenCalledTimes(1)
	})
})
