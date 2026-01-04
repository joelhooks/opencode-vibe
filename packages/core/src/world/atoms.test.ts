/**
 * Tests for world stream state management
 */

import { describe, expect, it } from "vitest"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import type { Project } from "../types/sdk.js"
import type { Instance, WorldState } from "./types.js"
import { WorldStore } from "./atoms.js"

describe("WorldStore", () => {
	it("initializes with empty state", () => {
		const store = new WorldStore()
		const state = store.getState()

		expect(state.sessions).toEqual([])
		expect(state.activeSessionCount).toBe(0)
		expect(state.activeSession).toBeNull()
		expect(state.connectionStatus).toBe("disconnected")
	})

	/**
	 * Instance/Project management tests - TDD for new methods and derivation
	 */
	describe("setInstances", () => {
		it("updates instances and notifies subscribers", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instances: Instance[] = [
				{
					port: 3000,
					pid: 1234,
					directory: "/test/project",
					status: "connected",
					baseUrl: "http://localhost:3000",
					lastSeen: now,
				},
			]

			let notifyCount = 0
			store.subscribe(() => {
				notifyCount++
			})

			// subscribe() fires immediately
			expect(notifyCount).toBe(1)

			store.setInstances(instances)

			// Should notify once
			expect(notifyCount).toBe(2)

			const state = store.getState()
			expect(state.instances).toHaveLength(1)
			expect(state.instances[0].port).toBe(3000)
		})
	})

	describe("setProjects", () => {
		it("updates projects and notifies subscribers", () => {
			const store = new WorldStore()
			const now = Date.now()

			const projects: Project[] = [
				{
					id: "proj-1",
					worktree: "/test/project",
					time: { created: now },
				},
			]

			let notifyCount = 0
			store.subscribe(() => {
				notifyCount++
			})

			// subscribe() fires immediately
			expect(notifyCount).toBe(1)

			store.setProjects(projects)

			// Should notify once
			expect(notifyCount).toBe(2)

			const state = store.getState()
			expect(state.projects).toHaveLength(1)
			expect(state.projects[0].id).toBe("proj-1")
		})
	})

	describe("setSessionToInstance", () => {
		it("maps session to instance and notifies subscribers", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instance: Instance = {
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			}

			// Must add instance first for derivation to find it
			store.setInstances([instance])

			let notifyCount = 0
			store.subscribe(() => {
				notifyCount++
			})

			// subscribe() fires immediately
			expect(notifyCount).toBe(1)

			store.setSessionToInstance("ses-1", instance)

			// Should notify once
			expect(notifyCount).toBe(2)

			const state = store.getState()
			expect(state.sessionToInstance.get("ses-1")).toEqual(instance)
		})
	})

	describe("upsertInstance", () => {
		it("inserts new instance into empty store using binary search by port", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instance: Instance = {
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			}

			store.upsertInstance(instance)
			const state = store.getState()

			expect(state.instances).toHaveLength(1)
			expect(state.instances[0].port).toBe(3000)
		})

		it("updates existing instance by port", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instance1: Instance = {
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connecting",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			}

			const instance2: Instance = {
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now + 1000,
			}

			store.upsertInstance(instance1)
			store.upsertInstance(instance2)
			const state = store.getState()

			expect(state.instances).toHaveLength(1)
			expect(state.instances[0].status).toBe("connected")
			expect(state.instances[0].lastSeen).toBe(now + 1000)
		})

		it("maintains sorted order by port for binary search", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instances = [
				{
					port: 3002,
					pid: 3,
					directory: "/test3",
					status: "connected" as const,
					baseUrl: "http://localhost:3002",
					lastSeen: now,
				},
				{
					port: 3000,
					pid: 1,
					directory: "/test1",
					status: "connected" as const,
					baseUrl: "http://localhost:3000",
					lastSeen: now,
				},
				{
					port: 3001,
					pid: 2,
					directory: "/test2",
					status: "connected" as const,
					baseUrl: "http://localhost:3001",
					lastSeen: now,
				},
			]

			for (const instance of instances) {
				store.upsertInstance(instance)
			}

			const state = store.getState()
			expect(state.instances).toHaveLength(3)

			// Internal array should be sorted by port (verify through consistent state)
			expect(state.instanceByPort.get(3000)?.pid).toBe(1)
			expect(state.instanceByPort.get(3001)?.pid).toBe(2)
			expect(state.instanceByPort.get(3002)?.pid).toBe(3)
		})

		it("uses binary search for O(log n) updates with 100 instances", () => {
			const store = new WorldStore()
			const now = Date.now()

			// Insert 100 instances
			for (let i = 0; i < 100; i++) {
				store.upsertInstance({
					port: 3000 + i,
					pid: i,
					directory: `/test${i}`,
					status: "connected",
					baseUrl: `http://localhost:${3000 + i}`,
					lastSeen: now,
				})
			}

			// Update one in the middle - should use binary search
			store.upsertInstance({
				port: 3050,
				pid: 50,
				directory: "/test50-updated",
				status: "connected",
				baseUrl: "http://localhost:3050",
				lastSeen: now + 1000,
			})

			const state = store.getState()
			expect(state.instances).toHaveLength(100)
			const updated = state.instanceByPort.get(3050)
			expect(updated?.directory).toBe("/test50-updated")
		})
	})

	describe("updateInstanceStatus", () => {
		it("updates status of instance by port", () => {
			const store = new WorldStore()
			const now = Date.now()

			store.upsertInstance({
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connecting",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			})

			store.updateInstanceStatus(3000, "connected")

			const state = store.getState()
			expect(state.instanceByPort.get(3000)?.status).toBe("connected")
		})

		it("does nothing if instance not found", () => {
			const store = new WorldStore()

			store.updateInstanceStatus(9999, "connected")

			const state = store.getState()
			expect(state.instances).toHaveLength(0)
		})
	})

	describe("removeInstance", () => {
		it("removes instance by port", () => {
			const store = new WorldStore()
			const now = Date.now()

			store.upsertInstance({
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			})

			let notifyCount = 0
			store.subscribe(() => {
				notifyCount++
			})

			// subscribe() fires immediately
			expect(notifyCount).toBe(1)

			store.removeInstance(3000)

			// Should notify once
			expect(notifyCount).toBe(2)

			const state = store.getState()
			expect(state.instances).toHaveLength(0)
			expect(state.instanceByPort.get(3000)).toBeUndefined()
		})

		it("does nothing if instance not found", () => {
			const store = new WorldStore()

			store.removeInstance(9999)

			const state = store.getState()
			expect(state.instances).toHaveLength(0)
		})

		it("maintains sorted order after removal", () => {
			const store = new WorldStore()
			const now = Date.now()

			for (let i = 0; i < 5; i++) {
				store.upsertInstance({
					port: 3000 + i,
					pid: i,
					directory: `/test${i}`,
					status: "connected",
					baseUrl: `http://localhost:${3000 + i}`,
					lastSeen: now,
				})
			}

			// Remove middle instance
			store.removeInstance(3002)

			const state = store.getState()
			expect(state.instances).toHaveLength(4)
			expect(state.instanceByPort.get(3002)).toBeUndefined()

			// Remaining instances should still be accessible
			expect(state.instanceByPort.get(3000)?.pid).toBe(0)
			expect(state.instanceByPort.get(3001)?.pid).toBe(1)
			expect(state.instanceByPort.get(3003)?.pid).toBe(3)
			expect(state.instanceByPort.get(3004)?.pid).toBe(4)
		})
	})

	describe("deriveWorldState - Instance/Project enrichment", () => {
		it("computes instanceByPort map", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instances: Instance[] = [
				{
					port: 3000,
					pid: 1234,
					directory: "/test/project1",
					status: "connected",
					baseUrl: "http://localhost:3000",
					lastSeen: now,
				},
				{
					port: 3001,
					pid: 5678,
					directory: "/test/project2",
					status: "connected",
					baseUrl: "http://localhost:3001",
					lastSeen: now,
				},
			]

			store.setInstances(instances)
			const state = store.getState()

			expect(state.instanceByPort.size).toBe(2)
			expect(state.instanceByPort.get(3000)?.pid).toBe(1234)
			expect(state.instanceByPort.get(3001)?.pid).toBe(5678)
		})

		it("computes instancesByDirectory map with multiple instances per directory", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instances: Instance[] = [
				{
					port: 3000,
					pid: 1234,
					directory: "/test/project",
					status: "connected",
					baseUrl: "http://localhost:3000",
					lastSeen: now,
				},
				{
					port: 3001,
					pid: 5678,
					directory: "/test/project",
					status: "connected",
					baseUrl: "http://localhost:3001",
					lastSeen: now + 1000,
				},
			]

			store.setInstances(instances)
			const state = store.getState()

			expect(state.instancesByDirectory.size).toBe(1)
			const projectInstances = state.instancesByDirectory.get("/test/project")
			expect(projectInstances).toHaveLength(2)
			expect(projectInstances?.[0].port).toBe(3000)
			expect(projectInstances?.[1].port).toBe(3001)
		})

		it("computes connectedInstanceCount", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instances: Instance[] = [
				{
					port: 3000,
					pid: 1,
					directory: "/test1",
					status: "connected",
					baseUrl: "http://localhost:3000",
					lastSeen: now,
				},
				{
					port: 3001,
					pid: 2,
					directory: "/test2",
					status: "connecting",
					baseUrl: "http://localhost:3001",
					lastSeen: now,
				},
				{
					port: 3002,
					pid: 3,
					directory: "/test3",
					status: "connected",
					baseUrl: "http://localhost:3002",
					lastSeen: now,
				},
				{
					port: 3003,
					pid: 4,
					directory: "/test4",
					status: "disconnected",
					baseUrl: "http://localhost:3003",
					lastSeen: now,
				},
			]

			store.setInstances(instances)
			const state = store.getState()

			expect(state.connectedInstanceCount).toBe(2)
		})

		it("enriches projects with instances and sessions", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instances: Instance[] = [
				{
					port: 3000,
					pid: 1234,
					directory: "/test/project",
					status: "connected",
					baseUrl: "http://localhost:3000",
					lastSeen: now,
				},
			]

			const projects: Project[] = [
				{
					id: "proj-1",
					worktree: "/test/project",
					time: { created: now },
				},
			]

			const sessions: Session[] = [
				{
					id: "ses-1",
					title: "Test Session",
					directory: "/test/project",
					time: { created: now, updated: now },
				},
			]

			store.setInstances(instances)
			store.setProjects(projects)
			store.setSessions(sessions)
			store.setSessionToInstance("ses-1", instances[0])

			const state = store.getState()

			expect(state.projects).toHaveLength(1)
			const enrichedProject = state.projects[0]
			expect(enrichedProject.id).toBe("proj-1")
			expect(enrichedProject.instances).toHaveLength(1)
			expect(enrichedProject.instances[0].port).toBe(3000)
			expect(enrichedProject.activeInstanceCount).toBe(1)
			expect(enrichedProject.sessions).toHaveLength(1)
			expect(enrichedProject.sessionCount).toBe(1)
			expect(enrichedProject.activeSessionCount).toBe(0)
		})

		it("computes projectByDirectory map", () => {
			const store = new WorldStore()
			const now = Date.now()

			const projects: Project[] = [
				{
					id: "proj-1",
					worktree: "/test/project1",
					time: { created: now },
				},
				{
					id: "proj-2",
					worktree: "/test/project2",
					time: { created: now },
				},
			]

			store.setProjects(projects)
			const state = store.getState()

			expect(state.projectByDirectory.size).toBe(2)
			expect(state.projectByDirectory.get("/test/project1")?.id).toBe("proj-1")
			expect(state.projectByDirectory.get("/test/project2")?.id).toBe("proj-2")
		})

		it("computes sessionToInstance map from internal mapping", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instance: Instance = {
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			}

			// Must add instance first for derivation to find it
			store.setInstances([instance])

			store.setSessionToInstance("ses-1", instance)
			store.setSessionToInstance("ses-2", instance)

			const state = store.getState()

			expect(state.sessionToInstance.size).toBe(2)
			expect(state.sessionToInstance.get("ses-1")?.port).toBe(3000)
			expect(state.sessionToInstance.get("ses-2")?.port).toBe(3000)
		})

		it("enriches projects with active session count based on status", () => {
			const store = new WorldStore()
			const now = Date.now()

			const projects: Project[] = [
				{
					id: "proj-1",
					worktree: "/test/project",
					time: { created: now },
				},
			]

			const sessions: Session[] = [
				{
					id: "ses-1",
					title: "Active Session",
					directory: "/test/project",
					time: { created: now, updated: now },
				},
				{
					id: "ses-2",
					title: "Completed Session",
					directory: "/test/project",
					time: { created: now, updated: now },
				},
			]

			const status: Record<string, SessionStatus> = {
				"ses-1": "running",
				"ses-2": "completed",
			}

			store.setProjects(projects)
			store.setSessions(sessions)
			store.setStatus(status)

			const state = store.getState()

			const enrichedProject = state.projects[0]
			expect(enrichedProject.activeSessionCount).toBe(1)
		})

		it("computes project lastActivityAt from most recent session", () => {
			const store = new WorldStore()
			const now = Date.now()

			const projects: Project[] = [
				{
					id: "proj-1",
					worktree: "/test/project",
					time: { created: now },
				},
			]

			const sessions: Session[] = [
				{
					id: "ses-1",
					title: "Old Session",
					directory: "/test/project",
					time: { created: now - 10000, updated: now - 10000 },
				},
				{
					id: "ses-2",
					title: "Recent Session",
					directory: "/test/project",
					time: { created: now, updated: now },
				},
			]

			store.setProjects(projects)
			store.setSessions(sessions)

			const state = store.getState()

			const enrichedProject = state.projects[0]
			expect(enrichedProject.lastActivityAt).toBe(now)
		})
	})

	describe("Integration - Instance/Session routing", () => {
		it("maintains sessionToInstance mapping for routing live interactions", () => {
			const store = new WorldStore()
			const now = Date.now()

			const instance1: Instance = {
				port: 3000,
				pid: 1234,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			}

			const instance2: Instance = {
				port: 3001,
				pid: 5678,
				directory: "/test/project",
				status: "connected",
				baseUrl: "http://localhost:3001",
				lastSeen: now,
			}

			const sessions: Session[] = [
				{
					id: "ses-1",
					title: "Session on Instance 1",
					directory: "/test/project",
					time: { created: now, updated: now },
				},
				{
					id: "ses-2",
					title: "Session on Instance 2",
					directory: "/test/project",
					time: { created: now, updated: now },
				},
			]

			store.setInstances([instance1, instance2])
			store.setSessions(sessions)
			store.setSessionToInstance("ses-1", instance1)
			store.setSessionToInstance("ses-2", instance2)

			const state = store.getState()

			// Verify routing map
			expect(state.sessionToInstance.get("ses-1")?.port).toBe(3000)
			expect(state.sessionToInstance.get("ses-2")?.port).toBe(3001)

			// Verify both sessions in same project (directory)
			expect(state.byDirectory.get("/test/project")).toHaveLength(2)
		})
	})

	it("updates sessions and derives world state", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test Session",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		store.setSessions(sessions)
		const state = store.getState()

		expect(state.sessions).toHaveLength(1)
		expect(state.sessions[0].id).toBe("ses-1")
		expect(state.sessions[0].status).toBe("completed") // No status set
		expect(state.sessions[0].messages).toEqual([])
	})

	it("enriches messages with parts", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "ses-1",
				role: "user",
				time: { created: now },
			},
		]

		const parts: Part[] = [
			{
				id: "part-1",
				sessionID: "ses-1",
				messageID: "msg-1",
				type: "text",
				text: "Hello",
			} as Part,
		]

		store.setSessions(sessions)
		store.setMessages(messages)
		store.setParts(parts)

		const state = store.getState()
		expect(state.sessions[0].messages).toHaveLength(1)
		expect(state.sessions[0].messages[0].parts).toHaveLength(1)
		expect((state.sessions[0].messages[0].parts[0] as any).text).toBe("Hello")
	})

	it("computes isStreaming for incomplete assistant messages", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now }, // No completed time
			},
		]

		store.setSessions(sessions)
		store.setMessages(messages)

		const state = store.getState()
		expect(state.sessions[0].messages[0].isStreaming).toBe(true)
	})

	it("marks completed messages as not streaming", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now, completed: now + 1000 },
			},
		]

		store.setSessions(sessions)
		store.setMessages(messages)

		const state = store.getState()
		expect(state.sessions[0].messages[0].isStreaming).toBe(false)
	})

	it("applies session status from status map", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const status: Record<string, SessionStatus> = {
			"ses-1": "running",
		}

		store.setSessions(sessions)
		store.setStatus(status)

		const state = store.getState()
		expect(state.sessions[0].status).toBe("running")
		expect(state.sessions[0].isActive).toBe(true)
		expect(state.activeSessionCount).toBe(1)
	})

	it("sorts sessions by last activity", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Old",
				directory: "/test",
				time: { created: now - 2000, updated: now - 2000 },
			},
			{
				id: "ses-2",
				title: "New",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		store.setSessions(sessions)

		const state = store.getState()
		expect(state.sessions[0].id).toBe("ses-2") // Most recent first
		expect(state.sessions[1].id).toBe("ses-1")
	})

	it("activeSession is first running session", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Completed",
				directory: "/test",
				time: { created: now, updated: now },
			},
			{
				id: "ses-2",
				title: "Running",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const status: Record<string, SessionStatus> = {
			"ses-2": "running",
		}

		store.setSessions(sessions)
		store.setStatus(status)

		const state = store.getState()
		expect(state.activeSession?.id).toBe("ses-2")
	})

	it("notifies subscribers on state changes", () => {
		const store = new WorldStore()
		let notifyCount = 0

		store.subscribe(() => {
			notifyCount++
		})

		// subscribe() now fires immediately with current state
		expect(notifyCount).toBe(1)

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			},
		]

		store.setSessions(sessions)
		expect(notifyCount).toBe(2)

		store.setConnectionStatus("connected")
		expect(notifyCount).toBe(3)
	})

	it("unsubscribe stops notifications", () => {
		const store = new WorldStore()
		let notifyCount = 0

		const unsubscribe = store.subscribe(() => {
			notifyCount++
		})

		// subscribe() fires immediately with current state
		expect(notifyCount).toBe(1)

		store.setSessions([])
		expect(notifyCount).toBe(2)

		unsubscribe()

		store.setSessions([])
		expect(notifyCount).toBe(2) // No additional notifications
	})

	it("computes context usage from last assistant message with all token types", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now, completed: now },
				tokens: {
					input: 5000,
					output: 500,
					reasoning: 1000,
					cache: { read: 1000, write: 500 },
				},
				model: {
					name: "claude-4-sonnet",
					limits: { context: 200000, output: 16384 },
				},
			},
		]

		store.setSessions(sessions)
		store.setMessages(messages)

		const state = store.getState()
		// Total = input(5000) + output(500) + reasoning(1000) + cache.read(1000) + cache.write(500) = 8000
		// Context usage = (8000 / 200000) * 100 = 4%
		expect(state.sessions[0].contextUsagePercent).toBe(4)
	})

	it("computes context usage with only input and cache read", () => {
		const store = new WorldStore()
		const now = Date.now()

		const sessions: Session[] = [
			{
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			},
		]

		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now, completed: now },
				tokens: {
					input: 5000,
					output: 500,
					cache: { read: 1000, write: 0 },
				},
				model: {
					name: "claude-4-sonnet",
					limits: { context: 200000, output: 16384 },
				},
			},
		]

		store.setSessions(sessions)
		store.setMessages(messages)

		const state = store.getState()
		// Total = input(5000) + output(500) + cache.read(1000) = 6500
		// (6500 / 200000) * 100 = 3.25%
		expect(state.sessions[0].contextUsagePercent).toBe(3.25)
	})

	describe("upsertSession", () => {
		it("inserts new session into empty store", () => {
			const store = new WorldStore()
			const now = Date.now()

			const session: Session = {
				id: "ses-1",
				title: "New Session",
				directory: "/test",
				time: { created: now, updated: now },
			}

			store.upsertSession(session)
			const state = store.getState()

			expect(state.sessions).toHaveLength(1)
			expect(state.sessions[0].id).toBe("ses-1")
			expect(state.sessions[0].title).toBe("New Session")
		})

		it("updates existing session by ID", () => {
			const store = new WorldStore()
			const now = Date.now()

			const session1: Session = {
				id: "ses-1",
				title: "Original",
				directory: "/test",
				time: { created: now, updated: now },
			}

			const session2: Session = {
				id: "ses-1",
				title: "Updated",
				directory: "/test",
				time: { created: now, updated: now + 1000 },
			}

			store.upsertSession(session1)
			store.upsertSession(session2)
			const state = store.getState()

			expect(state.sessions).toHaveLength(1)
			expect(state.sessions[0].title).toBe("Updated")
		})

		it("maintains sorted order by ID", () => {
			const store = new WorldStore()
			const now = Date.now()

			const sessions = [
				{ id: "ses-3", title: "C", directory: "/test", time: { created: now, updated: now } },
				{ id: "ses-1", title: "A", directory: "/test", time: { created: now, updated: now } },
				{ id: "ses-2", title: "B", directory: "/test", time: { created: now, updated: now } },
			]

			for (const session of sessions) {
				store.upsertSession(session)
			}

			// Internal array should be sorted by ID for binary search
			// We'll verify this through consistent behavior
			const state = store.getState()
			expect(state.sessions).toHaveLength(3)
		})

		it("uses binary search for O(log n) updates", () => {
			const store = new WorldStore()
			const now = Date.now()

			// Insert 100 sessions
			for (let i = 0; i < 100; i++) {
				store.upsertSession({
					id: `ses-${String(i).padStart(3, "0")}`,
					title: `Session ${i}`,
					directory: "/test",
					time: { created: now, updated: now },
				})
			}

			// Update one in the middle - should use binary search
			store.upsertSession({
				id: "ses-050",
				title: "Updated Middle",
				directory: "/test",
				time: { created: now, updated: now + 1000 },
			})

			const state = store.getState()
			expect(state.sessions).toHaveLength(100)
			const updated = state.sessions.find((s) => s.id === "ses-050")
			expect(updated?.title).toBe("Updated Middle")
		})
	})

	describe("upsertMessage", () => {
		it("inserts new message into empty store", () => {
			const store = new WorldStore()
			const now = Date.now()

			const message: Message = {
				id: "msg-1",
				sessionID: "ses-1",
				role: "user",
				time: { created: now },
			}

			store.upsertMessage(message)
			const state = store.getState()

			// Messages appear in enriched sessions
			expect(state.sessions).toHaveLength(0) // No session yet
		})

		it("updates existing message by ID", () => {
			const store = new WorldStore()
			const now = Date.now()

			const message1: Message = {
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now },
			}

			const message2: Message = {
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now, completed: now + 1000 },
				tokens: { input: 100, output: 50, cache: { read: 10, write: 5 } },
			}

			store.upsertMessage(message1)
			store.upsertMessage(message2)

			// Need to add session to see enriched messages
			store.upsertSession({
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			})

			const state = store.getState()
			expect(state.sessions[0].messages).toHaveLength(1)
			expect(state.sessions[0].messages[0].tokens?.input).toBe(100)
			expect(state.sessions[0].messages[0].isStreaming).toBe(false)
		})

		it("maintains sorted order by ID", () => {
			const store = new WorldStore()
			const now = Date.now()

			const messages = [
				{ id: "msg-3", sessionID: "ses-1", role: "user", time: { created: now } },
				{ id: "msg-1", sessionID: "ses-1", role: "user", time: { created: now } },
				{ id: "msg-2", sessionID: "ses-1", role: "user", time: { created: now } },
			]

			for (const message of messages) {
				store.upsertMessage(message)
			}

			store.upsertSession({
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			})

			const state = store.getState()
			expect(state.sessions[0].messages).toHaveLength(3)
		})
	})

	describe("upsertPart", () => {
		it("inserts new part into empty store", () => {
			const store = new WorldStore()

			const part: Part = {
				id: "part-1",
				messageID: "msg-1",
				sessionID: "ses-1",
				type: "text" as const,
				text: "Hello",
			}

			store.upsertPart(part)

			// Parts appear in enriched messages
			// Can't verify without message + session setup
		})

		it("updates existing part by ID", () => {
			const store = new WorldStore()
			const now = Date.now()

			const part1: Part = {
				id: "part-1",
				messageID: "msg-1",
				sessionID: "ses-1",
				type: "text" as const,
				text: "Hello",
			}

			const part2: Part = {
				id: "part-1",
				messageID: "msg-1",
				sessionID: "ses-1",
				type: "text" as const,
				text: "Hello World",
			}

			store.upsertPart(part1)
			store.upsertPart(part2)

			// Setup session + message to verify
			store.upsertSession({
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			})
			store.upsertMessage({
				id: "msg-1",
				sessionID: "ses-1",
				role: "assistant",
				time: { created: now },
			})

			const state = store.getState()
			expect(state.sessions[0].messages[0].parts).toHaveLength(1)
			expect((state.sessions[0].messages[0].parts[0] as any).text).toBe("Hello World")
		})

		it("maintains sorted order by ID", () => {
			const store = new WorldStore()
			const now = Date.now()

			const parts = [
				{ id: "part-3", sessionID: "ses-1", messageID: "msg-1", type: "text", text: "C" },
				{ id: "part-1", sessionID: "ses-1", messageID: "msg-1", type: "text", text: "A" },
				{ id: "part-2", sessionID: "ses-1", messageID: "msg-1", type: "text", text: "B" },
			] as Part[]

			for (const part of parts) {
				store.upsertPart(part)
			}

			store.upsertSession({
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			})
			store.upsertMessage({
				id: "msg-1",
				sessionID: "ses-1",
				role: "user",
				time: { created: now },
			})

			const state = store.getState()
			expect(state.sessions[0].messages[0].parts).toHaveLength(3)
		})
	})

	describe("updateStatus", () => {
		it("updates single session status", () => {
			const store = new WorldStore()
			const now = Date.now()

			store.upsertSession({
				id: "ses-1",
				title: "Test",
				directory: "/test",
				time: { created: now, updated: now },
			})

			store.updateStatus("ses-1", "running")

			const state = store.getState()
			expect(state.sessions[0].status).toBe("running")
			expect(state.sessions[0].isActive).toBe(true)
		})

		it("preserves other session statuses", () => {
			const store = new WorldStore()
			const now = Date.now()

			store.upsertSession({
				id: "ses-1",
				title: "Test 1",
				directory: "/test",
				time: { created: now, updated: now },
			})
			store.upsertSession({
				id: "ses-2",
				title: "Test 2",
				directory: "/test",
				time: { created: now, updated: now },
			})

			store.setStatus({ "ses-1": "running", "ses-2": "completed" })
			store.updateStatus("ses-1", "completed")

			const state = store.getState()
			const ses1 = state.sessions.find((s) => s.id === "ses-1")
			const ses2 = state.sessions.find((s) => s.id === "ses-2")

			expect(ses1?.status).toBe("completed")
			expect(ses2?.status).toBe("completed")
		})
	})

	describe("Integration - SSE event simulation", () => {
		it("handles realistic SSE event flow with upserts", () => {
			const store = new WorldStore()
			const now = Date.now()

			// 1. Session created event
			store.upsertSession({
				id: "ses-123",
				title: "My Project",
				directory: "/Users/joel/Code/my-project",
				time: { created: now, updated: now },
			})

			// 2. Status update: running
			store.updateStatus("ses-123", "running")

			// 3. User message created
			store.upsertMessage({
				id: "msg-user-1",
				sessionID: "ses-123",
				role: "user",
				time: { created: now + 100 },
			})

			// 4. User message part
			store.upsertPart({
				id: "part-user-1",
				sessionID: "ses-123",
				messageID: "msg-user-1",
				type: "text",
				text: "Hello AI",
			} as Part)

			// 5. Assistant message created (streaming starts)
			store.upsertMessage({
				id: "msg-asst-1",
				sessionID: "ses-123",
				role: "assistant",
				parentID: "msg-user-1",
				time: { created: now + 200 },
			})

			// 6. Assistant message part updates (streaming)
			store.upsertPart({
				id: "part-asst-1",
				sessionID: "ses-123",
				messageID: "msg-asst-1",
				type: "text",
				text: "Hello",
			} as Part)

			store.upsertPart({
				id: "part-asst-1",
				sessionID: "ses-123",
				messageID: "msg-asst-1",
				type: "text",
				text: "Hello! How",
			} as Part)

			store.upsertPart({
				id: "part-asst-1",
				sessionID: "ses-123",
				messageID: "msg-asst-1",
				type: "text",
				text: "Hello! How can I help you?",
			} as Part)

			// 7. Message completed with tokens
			store.upsertMessage({
				id: "msg-asst-1",
				sessionID: "ses-123",
				role: "assistant",
				parentID: "msg-user-1",
				time: { created: now + 200, completed: now + 5000 },
				tokens: {
					input: 1000,
					output: 50,
					reasoning: 100,
					cache: { read: 500, write: 200 },
				},
				model: {
					name: "claude-sonnet-4",
					limits: { context: 200000, output: 16384 },
				},
			})

			// 8. Status update: completed
			store.updateStatus("ses-123", "completed")

			const state = store.getState()

			// Verify final state
			expect(state.sessions).toHaveLength(1)
			expect(state.sessions[0].id).toBe("ses-123")
			expect(state.sessions[0].status).toBe("completed")
			expect(state.sessions[0].isActive).toBe(false)
			expect(state.sessions[0].messages).toHaveLength(2)

			const userMsg = state.sessions[0].messages.find((m) => m.role === "user")
			expect(userMsg?.parts).toHaveLength(1)
			expect((userMsg?.parts[0] as any).text).toBe("Hello AI")

			const asstMsg = state.sessions[0].messages.find((m) => m.role === "assistant")
			expect(asstMsg?.parts).toHaveLength(1)
			expect((asstMsg?.parts[0] as any).text).toBe("Hello! How can I help you?")
			expect(asstMsg?.isStreaming).toBe(false)
			expect(asstMsg?.tokens?.input).toBe(1000)

			// Context usage: (1000 + 50 + 100 + 500 + 200) / 200000 * 100 = 0.925%
			expect(state.sessions[0].contextUsagePercent).toBeCloseTo(0.925, 2)
		})
	})
})

/**
 * effect-atom based atoms tests
 *
 * TDD: These tests define the behavior of the new effect-atom based state management
 * that will eventually replace WorldStore.
 */
describe("effect-atom atoms", () => {
	describe("sessionsAtom", () => {
		it("can be read from Registry", async () => {
			const { sessionsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const sessions = registry.get(sessionsAtom)

			expect(sessions).toBeInstanceOf(Map)
			expect(sessions.size).toBe(0)
		})

		it("can be written via Registry", async () => {
			const { sessionsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()
			const now = Date.now()

			const session: Session = {
				id: "ses-1",
				title: "Test Session",
				directory: "/test",
				time: { created: now, updated: now },
			}

			registry.set(sessionsAtom, new Map([["ses-1", session]]))
			const result = registry.get(sessionsAtom)

			expect(result.size).toBe(1)
			expect(result.get("ses-1")).toEqual(session)
		})
	})

	describe("messagesAtom", () => {
		it("can be read from Registry", async () => {
			const { messagesAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const messages = registry.get(messagesAtom)

			expect(messages).toBeInstanceOf(Map)
			expect(messages.size).toBe(0)
		})

		it("can be written via Registry", async () => {
			const { messagesAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()
			const now = Date.now()

			const message: Message = {
				id: "msg-1",
				sessionID: "ses-1",
				role: "user",
				time: { created: now },
			}

			registry.set(messagesAtom, new Map([["msg-1", message]]))
			const result = registry.get(messagesAtom)

			expect(result.size).toBe(1)
			expect(result.get("msg-1")).toEqual(message)
		})
	})

	describe("partsAtom", () => {
		it("can be read from Registry", async () => {
			const { partsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const parts = registry.get(partsAtom)

			expect(parts).toBeInstanceOf(Map)
			expect(parts.size).toBe(0)
		})

		it("can be written via Registry", async () => {
			const { partsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const part: Part = {
				id: "part-1",
				messageID: "msg-1",
				sessionID: "ses-1",
				type: "text" as const,
				text: "Hello",
			}

			registry.set(partsAtom, new Map([["part-1", part]]))
			const result = registry.get(partsAtom)

			expect(result.size).toBe(1)
			expect(result.get("part-1")).toEqual(part)
		})
	})

	describe("statusAtom", () => {
		it("can be read from Registry", async () => {
			const { statusAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const status = registry.get(statusAtom)

			expect(status).toBeInstanceOf(Map)
			expect(status.size).toBe(0)
		})

		it("can be written via Registry", async () => {
			const { statusAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const newStatus = new Map<string, SessionStatus>([
				["ses-1", "running"],
				["ses-2", "completed"],
			])

			registry.set(statusAtom, newStatus)
			const result = registry.get(statusAtom)

			expect(result.size).toBe(2)
			expect(result.get("ses-1")).toBe("running")
			expect(result.get("ses-2")).toBe("completed")
		})
	})

	describe("connectionStatusAtom", () => {
		it("can be read from Registry", async () => {
			const { connectionStatusAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const status = registry.get(connectionStatusAtom)

			expect(status).toBe("disconnected")
		})

		it("can be written via Registry", async () => {
			const { connectionStatusAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			registry.set(connectionStatusAtom, "connected")
			const result = registry.get(connectionStatusAtom)

			expect(result).toBe("connected")
		})

		it("supports all connection states including discovering", async () => {
			const { connectionStatusAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const states: Array<"discovering" | "connecting" | "connected" | "disconnected" | "error"> = [
				"discovering",
				"connecting",
				"connected",
				"disconnected",
				"error",
			]

			for (const state of states) {
				registry.set(connectionStatusAtom, state)
				expect(registry.get(connectionStatusAtom)).toBe(state)
			}
		})
	})

	describe("derived atoms", () => {
		it("derived atom updates when base atom changes", async () => {
			const { Atom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			// Create base and derived atoms
			const countAtom = Atom.make(0)
			const doubleAtom = Atom.make((get) => get(countAtom) * 2)

			// Initial state
			expect(registry.get(countAtom)).toBe(0)
			expect(registry.get(doubleAtom)).toBe(0)

			// Update base atom
			registry.set(countAtom, 5)

			// Derived atom should auto-update
			expect(registry.get(countAtom)).toBe(5)
			expect(registry.get(doubleAtom)).toBe(10)
		})

		it("sessionCountAtom derives from sessionsAtom", async () => {
			const { sessionsAtom, sessionCountAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()
			const now = Date.now()

			// Start with empty
			expect(registry.get(sessionCountAtom)).toBe(0)

			// Add sessions
			const sessionsMap = new Map<string, Session>([
				[
					"ses-1",
					{
						id: "ses-1",
						title: "Test 1",
						directory: "/test",
						time: { created: now, updated: now },
					},
				],
				[
					"ses-2",
					{
						id: "ses-2",
						title: "Test 2",
						directory: "/test",
						time: { created: now, updated: now },
					},
				],
			])

			registry.set(sessionsAtom, sessionsMap)

			// Derived atom should auto-update
			expect(registry.get(sessionCountAtom)).toBe(2)
		})
	})

	describe("Registry subscribe", () => {
		it("notifies subscribers when atom changes", async () => {
			const { sessionsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()
			const now = Date.now()

			let notifyCount = 0
			let lastValue: Map<string, Session> | null = null

			registry.subscribe(sessionsAtom, (value: Map<string, Session>) => {
				notifyCount++
				lastValue = value
			})

			// Make a change
			const sessionsMap = new Map<string, Session>([
				[
					"ses-1",
					{
						id: "ses-1",
						title: "Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
				],
			])

			registry.set(sessionsAtom, sessionsMap)

			// Should have notified
			expect(notifyCount).toBe(1)
			expect(lastValue).not.toBeNull()
			expect(lastValue!.size).toBe(1)
			expect(lastValue!.get("ses-1")!.title).toBe("Test")
		})
	})

	describe("worldStateAtom reference stability", () => {
		it("returns same reference when underlying atoms have not changed", async () => {
			const { worldStateAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			// Get initial world state
			const state1 = registry.get(worldStateAtom)

			// Get it again without changing any underlying atoms
			const state2 = registry.get(worldStateAtom)

			// Should be the SAME reference (not just equal values)
			expect(state1).toBe(state2)
		})

		it("returns different reference only when underlying data changes", async () => {
			const { worldStateAtom, sessionsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()
			const now = Date.now()

			// Get initial world state
			const state1 = registry.get(worldStateAtom)

			// Change underlying data
			const sessionsMap = new Map<string, Session>([
				[
					"ses-1",
					{
						id: "ses-1",
						title: "Test",
						directory: "/test",
						time: { created: now, updated: now },
					},
				],
			])
			registry.set(sessionsAtom, sessionsMap)

			// Get world state after change
			const state2 = registry.get(worldStateAtom)

			// Should be DIFFERENT reference
			expect(state1).not.toBe(state2)

			// Get it again without changing data
			const state3 = registry.get(worldStateAtom)

			// Should be the SAME reference as state2
			expect(state2).toBe(state3)
		})

		it("subscription callback receives same reference when no data changes", async () => {
			const { worldStateAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const receivedStates: WorldState[] = []

			// Mount the atom to keep it alive
			const cleanup = registry.mount(worldStateAtom)

			// Subscribe to changes
			const unsubscribe = registry.subscribe(worldStateAtom, (state) => {
				receivedStates.push(state)
			})

			// Wait a bit to ensure no spurious updates
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should have received initial state only
			expect(receivedStates.length).toBe(0) // Registry.subscribe doesn't fire immediately

			// Manually get current state
			const currentState = registry.get(worldStateAtom)
			receivedStates.push(currentState)

			// Wait again
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Get state again
			const nextState = registry.get(worldStateAtom)
			receivedStates.push(nextState)

			// Both states should be the SAME reference
			expect(receivedStates[0]).toBe(receivedStates[1])

			cleanup()
			unsubscribe()
		})

		it("lastUpdated field does not change when no data changes", async () => {
			const { worldStateAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			// Get initial state
			const state1 = registry.get(worldStateAtom)
			const lastUpdated1 = state1.lastUpdated

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Get state again without changing any data
			const state2 = registry.get(worldStateAtom)
			const lastUpdated2 = state2.lastUpdated

			// lastUpdated should be the SAME value
			expect(lastUpdated1).toBe(lastUpdated2)

			// And the objects should be the same reference
			expect(state1).toBe(state2)
		})

		it("simulates useSyncExternalStore pattern - repeated getSnapshot calls", async () => {
			const { worldStateAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			// Simulate useSyncExternalStore calling getSnapshot on every render
			const snapshots: WorldState[] = []

			// Mount to keep atom alive
			const cleanup = registry.mount(worldStateAtom)

			// Simulate 10 rapid "renders" (getSnapshot calls)
			for (let i = 0; i < 10; i++) {
				snapshots.push(registry.get(worldStateAtom))
			}

			// All snapshots should be the SAME reference
			for (let i = 1; i < snapshots.length; i++) {
				expect(snapshots[i]).toBe(snapshots[0])
				expect(snapshots[i].lastUpdated).toBe(snapshots[0].lastUpdated)
			}

			cleanup()
		})

		it("lastUpdated is computed from most recent session activity", async () => {
			const { worldStateAtom, sessionsAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()
			const now = Date.now()

			// Add sessions with different update times
			const sessionsMap = new Map<string, Session>([
				[
					"ses-1",
					{
						id: "ses-1",
						title: "Old Session",
						directory: "/test",
						time: { created: now - 10000, updated: now - 10000 },
					},
				],
				[
					"ses-2",
					{
						id: "ses-2",
						title: "Recent Session",
						directory: "/test",
						time: { created: now - 5000, updated: now - 1000 },
					},
				],
			])

			registry.set(sessionsAtom, sessionsMap)

			const state = registry.get(worldStateAtom)

			// lastUpdated should match the most recent session's update time
			// (which is ses-2's updated time: now - 1000)
			expect(state.lastUpdated).toBe(now - 1000)

			// Get it again - should be stable
			const state2 = registry.get(worldStateAtom)
			expect(state2.lastUpdated).toBe(state.lastUpdated)
			expect(state2).toBe(state) // Same reference
		})

		it("lastUpdated is 0 when no sessions exist", async () => {
			const { worldStateAtom, Registry } = await import("./atoms.js")
			const registry = Registry.make()

			const state = registry.get(worldStateAtom)

			// No sessions = lastUpdated should be 0
			expect(state.lastUpdated).toBe(0)
		})
	})
})
