/**
 * Routing utilities tests - TDD RED phase
 *
 * CRITICAL: Tests sessionToInstance map routing (REQUIRED for live interaction).
 * NO FALLBACK logic - fail explicitly if instance unknown.
 */

import { describe, it, expect } from "vitest"
import { getInstanceForSession, getInstanceForProject, getRouteUrl } from "./routing.js"
import type { WorldState, Instance } from "./types.js"

// Helper to create minimal WorldState for testing
function createMockWorldState(overrides: Partial<WorldState> = {}): WorldState {
	return {
		sessions: [],
		activeSessionCount: 0,
		activeSession: null,
		connectionStatus: "connected",
		lastUpdated: Date.now(),
		byDirectory: new Map(),
		statuses: new Map(),
		stats: { total: 0, active: 0, streaming: 0 },
		instances: [],
		instanceByPort: new Map(),
		instancesByDirectory: new Map(),
		connectedInstanceCount: 0,
		projects: [],
		projectByDirectory: new Map(),
		sessionToInstance: new Map(),
		...overrides,
	}
}

// Helper to create mock Instance
function createMockInstance(overrides: Partial<Instance> = {}): Instance {
	return {
		port: 3000,
		pid: 12345,
		directory: "/path/to/project",
		status: "connected",
		baseUrl: "http://localhost:3000",
		lastSeen: Date.now(),
		...overrides,
	}
}

describe("getInstanceForSession", () => {
	it("returns instance when sessionId exists in sessionToInstance map", () => {
		const instance = createMockInstance({ port: 3001, directory: "/project-a" })
		const worldState = createMockWorldState({
			sessionToInstance: new Map([["session-123", instance]]),
		})

		const result = getInstanceForSession(worldState, "session-123")

		expect(result).toBe(instance)
	})

	it("returns null when sessionId NOT in sessionToInstance map", () => {
		const worldState = createMockWorldState({
			sessionToInstance: new Map(),
		})

		const result = getInstanceForSession(worldState, "unknown-session")

		expect(result).toBeNull()
	})

	it("returns null when sessionToInstance map is empty", () => {
		const worldState = createMockWorldState()

		const result = getInstanceForSession(worldState, "any-session")

		expect(result).toBeNull()
	})

	it("handles multiple sessions mapped to different instances", () => {
		const instance1 = createMockInstance({ port: 3001, directory: "/project-a" })
		const instance2 = createMockInstance({ port: 3002, directory: "/project-b" })
		const worldState = createMockWorldState({
			sessionToInstance: new Map([
				["session-a", instance1],
				["session-b", instance2],
			]),
		})

		expect(getInstanceForSession(worldState, "session-a")).toBe(instance1)
		expect(getInstanceForSession(worldState, "session-b")).toBe(instance2)
	})
})

describe("getInstanceForProject", () => {
	it("returns first connected instance when directory has instances", () => {
		const instance1 = createMockInstance({ port: 3001, status: "connected" })
		const instance2 = createMockInstance({ port: 3002, status: "connected" })
		const worldState = createMockWorldState({
			instancesByDirectory: new Map([["/project-a", [instance1, instance2]]]),
		})

		const result = getInstanceForProject(worldState, "/project-a")

		expect(result).toBe(instance1)
	})

	it("returns null when directory has NO instances", () => {
		const worldState = createMockWorldState({
			instancesByDirectory: new Map(),
		})

		const result = getInstanceForProject(worldState, "/unknown-project")

		expect(result).toBeNull()
	})

	it("returns null when directory instances array is empty", () => {
		const worldState = createMockWorldState({
			instancesByDirectory: new Map([["/project-a", []]]),
		})

		const result = getInstanceForProject(worldState, "/project-a")

		expect(result).toBeNull()
	})

	it("prefers connected instance over disconnected instances", () => {
		const disconnectedInstance = createMockInstance({ port: 3001, status: "disconnected" })
		const connectedInstance = createMockInstance({ port: 3002, status: "connected" })
		const worldState = createMockWorldState({
			instancesByDirectory: new Map([["/project-a", [disconnectedInstance, connectedInstance]]]),
		})

		const result = getInstanceForProject(worldState, "/project-a")

		expect(result).toBe(connectedInstance)
	})

	it("returns first instance even if none are connected (fallback)", () => {
		const disconnectedInstance = createMockInstance({ port: 3001, status: "disconnected" })
		const worldState = createMockWorldState({
			instancesByDirectory: new Map([["/project-a", [disconnectedInstance]]]),
		})

		const result = getInstanceForProject(worldState, "/project-a")

		expect(result).toBe(disconnectedInstance)
	})
})

describe("getRouteUrl", () => {
	it("routes to sessionToInstance map when sessionId provided", () => {
		const instance = createMockInstance({ port: 3001, baseUrl: "http://localhost:3001" })
		const worldState = createMockWorldState({
			sessionToInstance: new Map([["session-123", instance]]),
		})

		const result = getRouteUrl(worldState, { sessionId: "session-123" })

		expect(result).toBe("http://localhost:3001")
	})

	it("returns null when sessionId NOT in sessionToInstance map", () => {
		const worldState = createMockWorldState({
			sessionToInstance: new Map(),
		})

		const result = getRouteUrl(worldState, { sessionId: "unknown-session" })

		expect(result).toBeNull()
	})

	it("routes to instancesByDirectory when only directory provided", () => {
		const instance = createMockInstance({ baseUrl: "http://localhost:3002" })
		const worldState = createMockWorldState({
			instancesByDirectory: new Map([["/project-a", [instance]]]),
		})

		const result = getRouteUrl(worldState, { directory: "/project-a" })

		expect(result).toBe("http://localhost:3002")
	})

	it("returns null when directory NOT in instancesByDirectory", () => {
		const worldState = createMockWorldState({
			instancesByDirectory: new Map(),
		})

		const result = getRouteUrl(worldState, { directory: "/unknown-project" })

		expect(result).toBeNull()
	})

	it("prioritizes sessionId over directory when both provided", () => {
		const sessionInstance = createMockInstance({ port: 3001, baseUrl: "http://localhost:3001" })
		const dirInstance = createMockInstance({ port: 3002, baseUrl: "http://localhost:3002" })
		const worldState = createMockWorldState({
			sessionToInstance: new Map([["session-123", sessionInstance]]),
			instancesByDirectory: new Map([["/project-a", [dirInstance]]]),
		})

		const result = getRouteUrl(worldState, { sessionId: "session-123", directory: "/project-a" })

		expect(result).toBe("http://localhost:3001")
	})

	it("returns null when neither sessionId nor directory provided", () => {
		const worldState = createMockWorldState()

		const result = getRouteUrl(worldState, {})

		expect(result).toBeNull()
	})

	it("falls back to directory when sessionId provided but not found", () => {
		const dirInstance = createMockInstance({ baseUrl: "http://localhost:3002" })
		const worldState = createMockWorldState({
			sessionToInstance: new Map(),
			instancesByDirectory: new Map([["/project-a", [dirInstance]]]),
		})

		const result = getRouteUrl(worldState, {
			sessionId: "unknown-session",
			directory: "/project-a",
		})

		expect(result).toBe("http://localhost:3002")
	})
})
