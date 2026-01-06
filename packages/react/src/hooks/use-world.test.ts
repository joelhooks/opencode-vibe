/**
 * useWorld Tests - TDD approach
 *
 * Tests written FIRST before implementation.
 * Validates React binding to Core's World Stream API.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useWorld, __resetWorldStream } from "./use-world.js"
import type { WorldStreamHandle, WorldState } from "@opencode-vibe/core/world"

// Mock createWorldStream - must match the import path in use-world.ts
vi.mock("@opencode-vibe/core/world/stream", () => ({
	createWorldStream: vi.fn(),
}))

const createWorldStream = vi.mocked(
	await import("@opencode-vibe/core/world/stream").then((m) => m.createWorldStream),
)

describe("useWorld", () => {
	const emptyState: WorldState = {
		sessions: [],
		activeSessionCount: 0,
		activeSession: null,
		connectionStatus: "connecting",
		lastUpdated: 0,
		byDirectory: new Map(),
		stats: { total: 0, active: 0, streaming: 0 },
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
	}

	const connectedState: WorldState = {
		...emptyState,
		connectionStatus: "connected",
		lastUpdated: Date.now(),
	}

	let subscribeCallback: ((state: WorldState) => void) | undefined

	beforeEach(() => {
		// Reset singleton for each test
		__resetWorldStream()
		subscribeCallback = undefined

		const mockStream: WorldStreamHandle = {
			subscribe: (callback) => {
				// Fire immediately with initial state (BehaviorSubject pattern)
				subscribeCallback = callback
				callback(emptyState)
				return () => {}
			},
			getSnapshot: async () => emptyState,
			dispose: async () => {},
			[Symbol.asyncIterator]: vi.fn(),
		}

		createWorldStream.mockReturnValue(mockStream)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("returns WorldState type", () => {
		const { result } = renderHook(() => useWorld())

		expect(result.current).toMatchObject({
			sessions: expect.any(Array),
			activeSessionCount: expect.any(Number),
			activeSession: null,
			connectionStatus: expect.any(String),
			lastUpdated: expect.any(Number),
			byDirectory: expect.any(Map),
			stats: expect.objectContaining({
				total: expect.any(Number),
				active: expect.any(Number),
				streaming: expect.any(Number),
			}),
		})
	})

	it("returns initial state on first render", () => {
		const { result } = renderHook(() => useWorld())

		expect(result.current.connectionStatus).toBe("connecting")
		expect(result.current.sessions).toEqual([])
	})

	it("caches state from subscribe callback for synchronous getSnapshot", () => {
		// This test verifies the caching mechanism that makes useSyncExternalStore work.
		// The subscribe callback fires immediately with current state (BehaviorSubject pattern)
		// and caches it for getSnapshot to return synchronously.

		let capturedCallback: ((state: WorldState) => void) | undefined

		const mockStream: WorldStreamHandle = {
			subscribe: (callback: (state: WorldState) => void) => {
				// Capture the callback for later verification
				capturedCallback = callback

				// Fire immediately with initial state (BehaviorSubject pattern)
				callback(emptyState)

				return () => {}
			},
			getSnapshot: async () => emptyState,
			dispose: async () => {},
			[Symbol.asyncIterator]: vi.fn(),
		}

		createWorldStream.mockReturnValue(mockStream)

		const { result } = renderHook(() => useWorld())

		// Initial state should be cached and returned
		expect(result.current.connectionStatus).toBe("connecting")

		// Verify the callback was captured (subscribe was called with a function)
		expect(capturedCallback).toBeDefined()
		expect(typeof capturedCallback).toBe("function")
	})

	it("provides empty state for SSR (getServerSnapshot)", () => {
		const { result } = renderHook(() => useWorld())

		// Should have a valid state structure (not undefined/null)
		expect(result.current).toBeDefined()
		expect(result.current.sessions).toEqual([])
	})

	it("subscribes to stream on mount", () => {
		const mockSubscribe = vi.fn((callback: (state: WorldState) => void) => {
			callback(emptyState)
			return () => {}
		})

		const mockStream: WorldStreamHandle = {
			subscribe: mockSubscribe,
			getSnapshot: async () => emptyState,
			dispose: async () => {},
			[Symbol.asyncIterator]: vi.fn(),
		}

		createWorldStream.mockReturnValue(mockStream)

		renderHook(() => useWorld())

		// Should have called subscribe (at least once - strict mode may call twice)
		expect(mockSubscribe).toHaveBeenCalled()
		expect(mockSubscribe).toHaveBeenCalledWith(expect.any(Function))
	})

	it("cleans up subscription on unmount", () => {
		const mockUnsubscribe = vi.fn()

		const mockStream: WorldStreamHandle = {
			subscribe: (callback) => {
				callback(emptyState)
				return mockUnsubscribe
			},
			getSnapshot: async () => emptyState,
			dispose: async () => {},
			[Symbol.asyncIterator]: vi.fn(),
		}

		createWorldStream.mockReturnValue(mockStream)

		const { unmount } = renderHook(() => useWorld())

		// Unmount the hook
		unmount()

		// Unsubscribe should have been called
		expect(mockUnsubscribe).toHaveBeenCalled()
	})

	it("reads initial instances from OpencodeSSRPlugin when available", () => {
		// Reset for clean state
		__resetWorldStream()

		// Simulate OpencodeSSRPlugin injecting config
		const mockInstances = [
			{ port: 3000, directory: "/path/to/project", baseUrl: "/api/opencode/3000" },
			{ port: 3001, directory: "/path/to/other", baseUrl: "/api/opencode/3001" },
		]

		// @ts-ignore - setting window.__OPENCODE for test
		window.__OPENCODE = {
			baseUrl: "/api/opencode",
			directory: "/path/to/project",
			instances: mockInstances,
		}

		const mockStream: WorldStreamHandle = {
			subscribe: (callback) => {
				callback(emptyState)
				return () => {}
			},
			getSnapshot: async () => emptyState,
			dispose: async () => {},
			[Symbol.asyncIterator]: vi.fn(),
		}

		createWorldStream.mockReturnValue(mockStream)

		renderHook(() => useWorld())

		// createWorldStream should have been called with initialInstances
		expect(createWorldStream).toHaveBeenCalledWith({
			initialInstances: expect.arrayContaining([
				expect.objectContaining({
					port: 3000,
					directory: "/path/to/project",
					baseUrl: "/api/opencode/3000",
					status: "connected",
				}),
				expect.objectContaining({
					port: 3001,
					directory: "/path/to/other",
					baseUrl: "/api/opencode/3001",
					status: "connected",
				}),
			]),
		})

		// Cleanup
		// @ts-ignore
		delete window.__OPENCODE
	})

	it("handles missing window.__OPENCODE gracefully", () => {
		// Reset for clean state
		__resetWorldStream()

		// Ensure no config
		// @ts-ignore
		delete window.__OPENCODE

		const mockStream: WorldStreamHandle = {
			subscribe: (callback) => {
				callback(emptyState)
				return () => {}
			},
			getSnapshot: async () => emptyState,
			dispose: async () => {},
			[Symbol.asyncIterator]: vi.fn(),
		}

		createWorldStream.mockReturnValue(mockStream)

		renderHook(() => useWorld())

		// createWorldStream should have been called with undefined initialInstances
		expect(createWorldStream).toHaveBeenCalledWith({ initialInstances: undefined })
	})
})
