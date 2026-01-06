/**
 * useWorldCompactionState Tests - TDD approach
 *
 * Characterization tests for compaction state selector derived from useWorld().
 * Hook was already implemented correctly - these tests document behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useWorldCompactionState } from "./use-world-compaction-state.js"
import type { EnrichedSession, WorldState } from "@opencode-vibe/core/world"
import type { CompactionState } from "@opencode-vibe/core/world/types"
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

describe("useWorldCompactionState", () => {
	const now = Date.now()

	const mockCompactionState: CompactionState = {
		isCompacting: true,
		progress: 45,
		isAutomatic: false,
		startedAt: now - 60000,
	}

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
		compactionState: mockCompactionState,
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
		// No compactionState - testing undefined case
	}

	const mockWorldState = createMockWorldState([mockSession1, mockSession2])

	beforeEach(() => {
		vi.clearAllMocks()
		// Default: return mock world state
		useWorldMock.mockReturnValue(mockWorldState)
	})

	it("returns CompactionState | undefined type", () => {
		const { result } = renderHook(() => useWorldCompactionState("session-1"))

		// Should return a CompactionState object or undefined
		expect(result.current === undefined || typeof result.current === "object").toBe(true)
	})

	it("returns compactionState when session found and has compactionState", () => {
		const { result } = renderHook(() => useWorldCompactionState("session-1"))

		expect(result.current).toEqual(mockCompactionState)
		expect(result.current?.isCompacting).toBe(true)
		expect(result.current?.progress).toBe(45)
	})

	it("returns undefined when session has no compactionState", () => {
		const { result } = renderHook(() => useWorldCompactionState("session-2"))

		expect(result.current).toBeUndefined()
	})

	it("returns undefined when session not found", () => {
		const { result } = renderHook(() => useWorldCompactionState("non-existent-session"))

		expect(result.current).toBeUndefined()
	})

	it("updates when compactionState changes", () => {
		const { result, rerender } = renderHook(() => useWorldCompactionState("session-1"))

		// Initial state
		expect(result.current?.progress).toBe(45)
		expect(result.current?.isAutomatic).toBe(false)

		// Update compactionState
		const updatedCompactionState: CompactionState = {
			isCompacting: true,
			progress: 85,
			isAutomatic: true,
			startedAt: now - 30000,
		}

		const updatedSession: EnrichedSession = {
			...mockSession1,
			compactionState: updatedCompactionState,
		}

		const updatedWorldState = createMockWorldState([updatedSession, mockSession2])

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should reflect updated state
		expect(result.current?.progress).toBe(85)
		expect(result.current?.isAutomatic).toBe(true)
	})

	it("returns undefined when session is removed", () => {
		const { result, rerender } = renderHook(() => useWorldCompactionState("session-1"))

		// Initial state - session exists
		expect(result.current).toEqual(mockCompactionState)

		// Remove session from world state
		const updatedWorldState = createMockWorldState([mockSession2]) // session-1 removed

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should return undefined
		expect(result.current).toBeUndefined()
	})

	it("updates when compaction completes (isCompacting becomes false)", () => {
		const { result, rerender } = renderHook(() => useWorldCompactionState("session-1"))

		// Initial state - compacting
		expect(result.current?.isCompacting).toBe(true)

		// Compaction completes
		const completedCompactionState: CompactionState = {
			isCompacting: false,
			progress: 100,
			isAutomatic: false,
			startedAt: now - 120000,
		}

		const updatedSession: EnrichedSession = {
			...mockSession1,
			compactionState: completedCompactionState,
		}

		const updatedWorldState = createMockWorldState([updatedSession, mockSession2])

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should reflect completed state
		expect(result.current?.isCompacting).toBe(false)
		expect(result.current?.progress).toBe(100)
	})

	it("memoizes result to prevent unnecessary re-renders", () => {
		const { result, rerender } = renderHook(() => useWorldCompactionState("session-1"))

		const firstResult = result.current

		// Re-render without changing world state
		rerender()

		// Should return same reference (memoized)
		expect(result.current).toBe(firstResult)
	})

	it("subscribes to world state changes via useWorld", () => {
		renderHook(() => useWorldCompactionState("session-1"))

		// Should call useWorld to subscribe
		expect(useWorldMock).toHaveBeenCalledTimes(1)
	})
})
