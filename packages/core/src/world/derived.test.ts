/**
 * Tests for derived.ts worldAtom
 *
 * TDD: Verify worldAtom derivation works with Map-based atoms
 */

import { describe, expect, it } from "vitest"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import type { Project } from "../types/sdk.js"
import type { Instance } from "./types.js"
import {
	worldAtom,
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	connectionStatusAtom,
	instancesAtom,
	projectsAtom,
	sessionToInstancePortAtom,
} from "./derived.js"
import * as Registry from "@effect-atom/atom/Registry"

describe("worldAtom derivation", () => {
	it("derives initial empty world state from empty atoms", () => {
		const registry = Registry.make()

		const world = registry.get(worldAtom)

		expect(world.sessions).toEqual([])
		expect(world.activeSessionCount).toBe(0)
		expect(world.activeSession).toBeNull()
		expect(world.connectionStatus).toBe("disconnected")
		expect(world.stats.total).toBe(0)
		expect(world.stats.active).toBe(0)
		expect(world.stats.streaming).toBe(0)
	})

	it("derives world state from Map-based sessionsAtom", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test Session",
			directory: "/test",
			time: { created: now, updated: now },
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		const world = registry.get(worldAtom)

		expect(world.sessions).toHaveLength(1)
		expect(world.sessions[0].id).toBe("ses-1")
		expect(world.sessions[0].title).toBe("Test Session")
	})

	it("enriches sessions with messages from Map-based messagesAtom", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		const message: Message = {
			id: "msg-1",
			sessionID: "ses-1",
			role: "user",
			time: { created: now },
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		registry.set(messagesAtom, new Map([["msg-1", message]]))
		const world = registry.get(worldAtom)

		expect(world.sessions[0].messages).toHaveLength(1)
		expect(world.sessions[0].messages[0].id).toBe("msg-1")
	})

	it("enriches messages with parts from Map-based partsAtom", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		const message: Message = {
			id: "msg-1",
			sessionID: "ses-1",
			role: "user",
			time: { created: now },
		}

		const part: Part = {
			id: "part-1",
			messageID: "msg-1",
			type: "text",
			content: "Hello",
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		registry.set(messagesAtom, new Map([["msg-1", message]]))
		registry.set(partsAtom, new Map([["part-1", part]]))
		const world = registry.get(worldAtom)

		expect(world.sessions[0].messages[0].parts).toHaveLength(1)
		expect(world.sessions[0].messages[0].parts[0].content).toBe("Hello")
	})

	it("applies session status from Map-based statusAtom", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		registry.set(statusAtom, new Map<string, SessionStatus>([["ses-1", "running"]]))
		const world = registry.get(worldAtom)

		expect(world.sessions[0].status).toBe("running")
		expect(world.sessions[0].isActive).toBe(true)
		expect(world.activeSessionCount).toBe(1)
	})

	it("derives connectionStatus from connectionStatusAtom", () => {
		const registry = Registry.make()

		registry.set(connectionStatusAtom, "connected")
		const world = registry.get(worldAtom)

		expect(world.connectionStatus).toBe("connected")
	})

	it("auto-updates world when sessionsAtom changes", () => {
		const registry = Registry.make()
		const now = Date.now()

		// Initial state
		let world = registry.get(worldAtom)
		expect(world.sessions).toHaveLength(0)

		// Add session
		const session: Session = {
			id: "ses-1",
			title: "New Session",
			directory: "/test",
			time: { created: now, updated: now },
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		world = registry.get(worldAtom)

		expect(world.sessions).toHaveLength(1)
		expect(world.sessions[0].id).toBe("ses-1")
	})

	it("auto-updates world when messagesAtom changes", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))

		// Initial world
		let world = registry.get(worldAtom)
		expect(world.sessions[0].messages).toHaveLength(0)

		// Add message
		const message: Message = {
			id: "msg-1",
			sessionID: "ses-1",
			role: "user",
			time: { created: now },
		}

		registry.set(messagesAtom, new Map([["msg-1", message]]))
		world = registry.get(worldAtom)

		expect(world.sessions[0].messages).toHaveLength(1)
	})

	it("notifies subscribers when base atom changes", () => {
		const registry = Registry.make()
		const now = Date.now()

		// Get initial state to establish dependency
		registry.get(worldAtom)

		let notifyCount = 0
		registry.subscribe(worldAtom, () => {
			notifyCount++
		})

		// Update sessionsAtom
		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))

		// Should have triggered worldAtom subscriber
		expect(notifyCount).toBe(1)
	})

	it("computes instanceByPort map from Map-based instancesAtom", () => {
		const registry = Registry.make()
		const now = Date.now()

		const instances: Instance[] = [
			{
				port: 3000,
				pid: 1234,
				directory: "/test",
				status: "connected",
				baseUrl: "http://localhost:3000",
				lastSeen: now,
			},
			{
				port: 3001,
				pid: 5678,
				directory: "/test",
				status: "connected",
				baseUrl: "http://localhost:3001",
				lastSeen: now,
			},
		]

		registry.set(
			instancesAtom,
			new Map([
				[3000, instances[0]],
				[3001, instances[1]],
			]),
		)
		const world = registry.get(worldAtom)

		expect(world.instanceByPort.size).toBe(2)
		expect(world.instanceByPort.get(3000)?.pid).toBe(1234)
		expect(world.instanceByPort.get(3001)?.pid).toBe(5678)
	})

	it("enriches projects with instances and sessions", () => {
		const registry = Registry.make()
		const now = Date.now()

		const instance: Instance = {
			port: 3000,
			pid: 1234,
			directory: "/test/project",
			status: "connected",
			baseUrl: "http://localhost:3000",
			lastSeen: now,
		}

		const project: Project = {
			id: "proj-1",
			worktree: "/test/project",
			time: { created: now },
		}

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test/project",
			time: { created: now, updated: now },
		}

		registry.set(instancesAtom, new Map([[3000, instance]]))
		registry.set(projectsAtom, new Map([["/test/project", project]]))
		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		const world = registry.get(worldAtom)

		expect(world.projects).toHaveLength(1)
		const enrichedProject = world.projects[0]
		expect(enrichedProject.instances).toHaveLength(1)
		expect(enrichedProject.instances[0].port).toBe(3000)
		expect(enrichedProject.sessions).toHaveLength(1)
		expect(enrichedProject.sessionCount).toBe(1)
	})

	it("computes sessionToInstance map from sessionToInstancePortAtom", () => {
		const registry = Registry.make()
		const now = Date.now()

		const instance: Instance = {
			port: 3000,
			pid: 1234,
			directory: "/test",
			status: "connected",
			baseUrl: "http://localhost:3000",
			lastSeen: now,
		}

		registry.set(instancesAtom, new Map([[3000, instance]]))
		registry.set(
			sessionToInstancePortAtom,
			new Map([
				["ses-1", 3000],
				["ses-2", 3000],
			]),
		)
		const world = registry.get(worldAtom)

		expect(world.sessionToInstance.size).toBe(2)
		expect(world.sessionToInstance.get("ses-1")?.port).toBe(3000)
		expect(world.sessionToInstance.get("ses-2")?.port).toBe(3000)
	})

	it("sorts sessions by last activity (most recent first)", () => {
		const registry = Registry.make()
		const now = Date.now()

		const sessions = new Map<string, Session>([
			[
				"ses-1",
				{
					id: "ses-1",
					title: "Old",
					directory: "/test",
					time: { created: now - 2000, updated: now - 2000 },
				},
			],
			[
				"ses-2",
				{
					id: "ses-2",
					title: "New",
					directory: "/test",
					time: { created: now, updated: now },
				},
			],
		])

		registry.set(sessionsAtom, sessions)
		const world = registry.get(worldAtom)

		expect(world.sessions[0].id).toBe("ses-2") // Most recent first
		expect(world.sessions[1].id).toBe("ses-1")
	})

	it("computes context usage percent from last assistant message", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		const message: Message = {
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
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		registry.set(messagesAtom, new Map([["msg-1", message]]))
		const world = registry.get(worldAtom)

		// Total = input(5000) + output(500) + reasoning(1000) + cache.read(1000) + cache.write(500) = 8000
		// Context usage = (8000 / 200000) * 100 = 4%
		expect(world.sessions[0].contextUsagePercent).toBe(4)
	})

	it("detects streaming messages (assistant with no completed time)", () => {
		const registry = Registry.make()
		const now = Date.now()

		const session: Session = {
			id: "ses-1",
			title: "Test",
			directory: "/test",
			time: { created: now, updated: now },
		}

		const message: Message = {
			id: "msg-1",
			sessionID: "ses-1",
			role: "assistant",
			time: { created: now }, // No completed time
		}

		registry.set(sessionsAtom, new Map([["ses-1", session]]))
		registry.set(messagesAtom, new Map([["msg-1", message]]))
		const world = registry.get(worldAtom)

		expect(world.sessions[0].messages[0].isStreaming).toBe(true)
		expect(world.stats.streaming).toBe(1)
	})

	it("groups sessions by directory", () => {
		const registry = Registry.make()
		const now = Date.now()

		const sessions = new Map<string, Session>([
			[
				"ses-1",
				{
					id: "ses-1",
					title: "Project A",
					directory: "/test/a",
					time: { created: now, updated: now },
				},
			],
			[
				"ses-2",
				{
					id: "ses-2",
					title: "Project B",
					directory: "/test/b",
					time: { created: now, updated: now },
				},
			],
			[
				"ses-3",
				{
					id: "ses-3",
					title: "Project A 2",
					directory: "/test/a",
					time: { created: now, updated: now },
				},
			],
		])

		registry.set(sessionsAtom, sessions)
		const world = registry.get(worldAtom)

		expect(world.byDirectory.size).toBe(2)
		expect(world.byDirectory.get("/test/a")).toHaveLength(2)
		expect(world.byDirectory.get("/test/b")).toHaveLength(1)
	})
})
