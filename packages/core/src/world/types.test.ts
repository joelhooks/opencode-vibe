/**
 * Type tests for world stream types
 */

import { describe, expect, it } from "vitest"
import type {
	EnrichedMessage,
	EnrichedProject,
	EnrichedSession,
	Instance,
	WorldState,
	WorldStreamConfig,
	WorldStreamHandle,
} from "./types.js"

describe("WorldStream Types", () => {
	it("EnrichedSession extends Session with computed properties", () => {
		const enrichedSession: EnrichedSession = {
			id: "ses-123",
			title: "Test Session",
			directory: "/test",
			time: { created: Date.now(), updated: Date.now() },
			status: "running",
			isActive: true,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 45.5,
			lastActivityAt: Date.now(),
		}

		expect(enrichedSession.id).toBe("ses-123")
		expect(enrichedSession.status).toBe("running")
		expect(enrichedSession.isActive).toBe(true)
		expect(enrichedSession.contextUsagePercent).toBe(45.5)
	})

	it("EnrichedMessage extends Message with parts", () => {
		const enrichedMessage: EnrichedMessage = {
			id: "msg-123",
			sessionID: "ses-123",
			role: "assistant",
			time: { created: Date.now() },
			parts: [
				{
					id: "part-1",
					sessionID: "ses-123",
					messageID: "msg-123",
					type: "text",
					text: "Hello",
				},
			],
			isStreaming: true,
		}

		expect(enrichedMessage.parts).toHaveLength(1)
		expect(enrichedMessage.isStreaming).toBe(true)
	})

	it("WorldState has complete structure", () => {
		const worldState: WorldState = {
			sessions: [],
			activeSessionCount: 1,
			activeSession: null,
			connectionStatus: "connected",
			lastUpdated: Date.now(),
			byDirectory: new Map(),
			statuses: new Map(),
			stats: { total: 0, active: 1, streaming: 0 },
			// New instance/project fields
			instances: [],
			instanceByPort: new Map(),
			instancesByDirectory: new Map(),
			connectedInstanceCount: 0,
			projects: [],
			projectByDirectory: new Map(),
			sessionToInstance: new Map(),
		}

		expect(worldState.sessions).toEqual([])
		expect(worldState.activeSessionCount).toBe(1)
		expect(worldState.connectionStatus).toBe("connected")
		expect(worldState.byDirectory).toBeInstanceOf(Map)
		expect(worldState.stats.total).toBe(0)
	})

	it("WorldStreamConfig has reasonable defaults", () => {
		const config: WorldStreamConfig = {}

		// Type checks - config is optional
		expect(config.baseUrl).toBeUndefined()
		expect(config.maxSessions).toBeUndefined()
		expect(config.autoReconnect).toBeUndefined()
	})

	it("WorldStreamHandle has required methods", () => {
		// This is a type-only test - we're just checking the interface compiles
		const handle: Partial<WorldStreamHandle> = {
			subscribe: (callback: (state: WorldState) => void) => () => {},
			getSnapshot: async () => ({
				sessions: [],
				activeSessionCount: 0,
				activeSession: null,
				connectionStatus: "disconnected",
				lastUpdated: Date.now(),
				byDirectory: new Map(),
				stats: { total: 0, active: 0, streaming: 0 },
				// New fields (will fail until types.ts is updated)
				instances: [],
				projects: [],
				instanceByPort: new Map(),
				instancesByDirectory: new Map(),
				projectByDirectory: new Map(),
				sessionToInstance: new Map(),
				connectedInstanceCount: 0,
			}),
			dispose: async () => {},
		}

		expect(handle.subscribe).toBeDefined()
		expect(handle.getSnapshot).toBeDefined()
		expect(handle.dispose).toBeDefined()
	})

	describe("Instance types", () => {
		it("Instance has runtime discovery metadata", () => {
			const instance: Instance = {
				port: 4056,
				pid: 12345,
				directory: "/Users/joel/project",
				status: "connected",
				baseUrl: "http://localhost:4056",
				lastSeen: Date.now(),
			}

			expect(instance.port).toBe(4056)
			expect(instance.pid).toBe(12345)
			expect(instance.status).toBe("connected")
			expect(instance.baseUrl).toBe("http://localhost:4056")
		})

		it("Instance status discriminates connection states", () => {
			const connected: Instance["status"] = "connected"
			const connecting: Instance["status"] = "connecting"
			const disconnected: Instance["status"] = "disconnected"
			const error: Instance["status"] = "error"

			expect([connected, connecting, disconnected, error]).toContain("connected")
		})
	})

	describe("EnrichedProject types", () => {
		it("EnrichedProject extends SDK Project with instances and sessions", () => {
			const enrichedProject: EnrichedProject = {
				// SDK Project fields (minimal required)
				id: "proj-123",
				worktree: "/Users/joel/project",
				time: {
					created: Date.now(),
				},
				// Enriched fields
				instances: [
					{
						port: 4056,
						pid: 12345,
						directory: "/Users/joel/project",
						status: "connected",
						baseUrl: "http://localhost:4056",
						lastSeen: Date.now(),
					},
				],
				activeInstanceCount: 1,
				sessions: [],
				sessionCount: 0,
				activeSessionCount: 0,
				lastActivityAt: Date.now(),
			}

			expect(enrichedProject.id).toBe("proj-123")
			expect(enrichedProject.instances).toHaveLength(1)
			expect(enrichedProject.activeInstanceCount).toBe(1)
			expect(enrichedProject.sessions).toEqual([])
		})

		it("EnrichedProject can have multiple instances", () => {
			const enrichedProject: EnrichedProject = {
				id: "proj-456",
				worktree: "/Users/joel/multi",
				time: { created: Date.now() },
				instances: [
					{
						port: 4056,
						pid: 12345,
						directory: "/Users/joel/multi",
						status: "connected",
						baseUrl: "http://localhost:4056",
						lastSeen: Date.now(),
					},
					{
						port: 4057,
						pid: 12346,
						directory: "/Users/joel/multi",
						status: "connected",
						baseUrl: "http://localhost:4057",
						lastSeen: Date.now(),
					},
				],
				activeInstanceCount: 2,
				sessions: [],
				sessionCount: 0,
				activeSessionCount: 0,
				lastActivityAt: Date.now(),
			}

			expect(enrichedProject.instances).toHaveLength(2)
			expect(enrichedProject.activeInstanceCount).toBe(2)
		})
	})

	describe("WorldState instance/project fields", () => {
		it("WorldState has instance tracking maps", () => {
			const instance1: Instance = {
				port: 4056,
				pid: 12345,
				directory: "/proj1",
				status: "connected",
				baseUrl: "http://localhost:4056",
				lastSeen: Date.now(),
			}

			const instance2: Instance = {
				port: 4057,
				pid: 12346,
				directory: "/proj1",
				status: "connected",
				baseUrl: "http://localhost:4057",
				lastSeen: Date.now(),
			}

			const worldState: WorldState = {
				sessions: [],
				activeSessionCount: 0,
				activeSession: null,
				connectionStatus: "connected",
				lastUpdated: Date.now(),
				byDirectory: new Map(),
				stats: { total: 0, active: 0, streaming: 0 },
				// Instance tracking
				instances: [instance1, instance2],
				instanceByPort: new Map([
					[4056, instance1],
					[4057, instance2],
				]),
				instancesByDirectory: new Map([["/proj1", [instance1, instance2]]]),
				connectedInstanceCount: 2,
				// Project tracking
				projects: [],
				projectByDirectory: new Map(),
				sessionToInstance: new Map(),
			}

			expect(worldState.instances).toHaveLength(2)
			expect(worldState.instanceByPort.get(4056)).toBe(instance1)
			expect(worldState.instancesByDirectory.get("/proj1")).toHaveLength(2)
			expect(worldState.connectedInstanceCount).toBe(2)
		})

		it("WorldState sessionToInstance map enables routing", () => {
			const instance: Instance = {
				port: 4056,
				pid: 12345,
				directory: "/proj",
				status: "connected",
				baseUrl: "http://localhost:4056",
				lastSeen: Date.now(),
			}

			const worldState: WorldState = {
				sessions: [],
				activeSessionCount: 0,
				activeSession: null,
				connectionStatus: "connected",
				lastUpdated: Date.now(),
				byDirectory: new Map(),
				stats: { total: 0, active: 0, streaming: 0 },
				instances: [instance],
				instanceByPort: new Map([[4056, instance]]),
				instancesByDirectory: new Map([["/proj", [instance]]]),
				connectedInstanceCount: 1,
				projects: [],
				projectByDirectory: new Map(),
				// CRITICAL: sessionID -> Instance for routing
				sessionToInstance: new Map([["ses-123", instance]]),
			}

			const routingInstance = worldState.sessionToInstance.get("ses-123")
			expect(routingInstance).toBe(instance)
			expect(routingInstance?.baseUrl).toBe("http://localhost:4056")
		})
	})
})
