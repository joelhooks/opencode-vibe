/**
 * useWorldContextUsage Tests - TDD approach
 *
 * Characterization tests for context usage selector derived from useWorld().
 * Hook was already implemented correctly - these tests document behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useWorldContextUsage } from "./use-world-context-usage.js"
import type { EnrichedSession, WorldState } from "@opencode-vibe/core/world"
import type { ContextUsage } from "@opencode-vibe/core/world/types"
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

describe("useWorldContextUsage", () => {
	const now = Date.now()

	const mockContextUsage: ContextUsage = {
		used: 45000,
		limit: 100000,
		percentage: 45,
		isNearLimit: false,
		tokens: {
			input: 30000,
			output: 10000,
			cached: 5000,
		},
		lastUpdated: now,
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
		contextUsage: mockContextUsage,
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
		// No contextUsage - testing undefined case
	}

	const mockWorldState = createMockWorldState([mockSession1, mockSession2])

	beforeEach(() => {
		vi.clearAllMocks()
		// Default: return mock world state
		useWorldMock.mockReturnValue(mockWorldState)
	})

	it("returns ContextUsage | undefined type", () => {
		const { result } = renderHook(() => useWorldContextUsage("session-1"))

		// Should return a ContextUsage object or undefined
		expect(result.current === undefined || typeof result.current === "object").toBe(true)
	})

	it("returns contextUsage when session found and has contextUsage", () => {
		const { result } = renderHook(() => useWorldContextUsage("session-1"))

		expect(result.current).toEqual(mockContextUsage)
		expect(result.current?.used).toBe(45000)
		expect(result.current?.percentage).toBe(45)
	})

	it("returns undefined when session has no contextUsage", () => {
		const { result } = renderHook(() => useWorldContextUsage("session-2"))

		expect(result.current).toBeUndefined()
	})

	it("returns undefined when session not found", () => {
		const { result } = renderHook(() => useWorldContextUsage("non-existent-session"))

		expect(result.current).toBeUndefined()
	})

	it("updates when contextUsage changes", () => {
		const { result, rerender } = renderHook(() => useWorldContextUsage("session-1"))

		// Initial state
		expect(result.current?.percentage).toBe(45)

		// Update contextUsage
		const updatedContextUsage: ContextUsage = {
			used: 85000,
			limit: 100000,
			percentage: 85,
			isNearLimit: true,
			tokens: {
				input: 70000,
				output: 12000,
				cached: 3000,
			},
			lastUpdated: now,
		}

		const updatedSession: EnrichedSession = {
			...mockSession1,
			contextUsagePercent: 85,
			contextUsage: updatedContextUsage,
		}

		const updatedWorldState = createMockWorldState([updatedSession, mockSession2])

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should reflect updated state
		expect(result.current?.percentage).toBe(85)
		expect(result.current?.isNearLimit).toBe(true)
	})

	it("returns undefined when session is removed", () => {
		const { result, rerender } = renderHook(() => useWorldContextUsage("session-1"))

		// Initial state - session exists
		expect(result.current).toEqual(mockContextUsage)

		// Remove session from world state
		const updatedWorldState = createMockWorldState([mockSession2]) // session-1 removed

		useWorldMock.mockReturnValue(updatedWorldState)

		// Force re-render
		rerender()

		// Should return undefined
		expect(result.current).toBeUndefined()
	})

	it("memoizes result to prevent unnecessary re-renders", () => {
		const { result, rerender } = renderHook(() => useWorldContextUsage("session-1"))

		const firstResult = result.current

		// Re-render without changing world state
		rerender()

		// Should return same reference (memoized)
		expect(result.current).toBe(firstResult)
	})

	it("subscribes to world state changes via useWorld", () => {
		renderHook(() => useWorldContextUsage("session-1"))

		// Should call useWorld to subscribe
		expect(useWorldMock).toHaveBeenCalledTimes(1)
	})
})
