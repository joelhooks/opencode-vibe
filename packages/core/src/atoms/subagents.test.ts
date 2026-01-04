/**
 * Tests for subagents atom
 *
 * Tests verify:
 * - Subagent session registration and tracking
 * - Message and part management
 * - UI expansion state
 * - Parent part ID to session mapping
 */

import { describe, test, expect } from "vitest"
import { Effect } from "effect"
import { SubagentAtom } from "./subagents.js"
import type { Message, Part } from "../types/index.js"

describe("SubagentAtom", () => {
	const mockMessage: Message = {
		id: "msg-1",
		sessionID: "child-123",
		role: "user",
		time: { created: Date.now() },
	}

	const mockPart: Part = {
		id: "part-1",
		sessionID: "child-123",
		messageID: "msg-1",
		type: "text",
		text: "test part",
	} as Part

	describe("create", () => {
		test("creates a new subagent state ref", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			const state = await Effect.runPromise(Effect.sync(() => stateRef))

			expect(state).toBeDefined()
		})
	})

	describe("registerSubagent", () => {
		test("registers a new subagent session", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))

			const session = sessions["child-123"]
			expect(session).toBeDefined()
			expect(session?.id).toBe("child-123")
			expect(session?.parentSessionId).toBe("parent-456")
			expect(session?.parentPartId).toBe("part-789")
			expect(session?.agentName).toBe("TestAgent")
			expect(session?.status).toBe("running")
			expect(session?.messages).toEqual([])
			expect(session?.parts).toEqual({})
		})

		test("auto-expands running subagent", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			const isExpanded = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-789"))
			expect(isExpanded).toBe(true)
		})

		test("creates partToSession mapping", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			const session = await Effect.runPromise(SubagentAtom.getByParentPart(stateRef, "part-789"))
			expect(session?.id).toBe("child-123")
		})
	})

	describe("updateParentPartId", () => {
		test("updates parent part ID for existing session", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-old", "TestAgent"),
			)

			await Effect.runPromise(SubagentAtom.updateParentPartId(stateRef, "child-123", "part-new"))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]
			expect(session?.parentPartId).toBe("part-new")

			const foundSession = await Effect.runPromise(
				SubagentAtom.getByParentPart(stateRef, "part-new"),
			)
			expect(foundSession?.id).toBe("child-123")
		})

		test("auto-expands when parent part ID is set for running session", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "", "TestAgent"),
			)

			const expandedBefore = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-new"))
			expect(expandedBefore).toBe(false)

			await Effect.runPromise(SubagentAtom.updateParentPartId(stateRef, "child-123", "part-new"))

			const expandedAfter = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-new"))
			expect(expandedAfter).toBe(true)
		})

		test("does not expand if session is not running", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "", "TestAgent"),
			)
			await Effect.runPromise(SubagentAtom.setStatus(stateRef, "child-123", "completed"))

			await Effect.runPromise(SubagentAtom.updateParentPartId(stateRef, "child-123", "part-new"))

			const isExpanded = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-new"))
			expect(isExpanded).toBe(false)
		})
	})

	describe("addMessage", () => {
		test("adds message to session", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			await Effect.runPromise(SubagentAtom.addMessage(stateRef, "child-123", mockMessage))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect(session?.messages).toHaveLength(1)
			expect(session?.messages[0]).toEqual(mockMessage)
			expect(session?.parts[mockMessage.id]).toEqual([])
		})

		test("does nothing if session does not exist", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(SubagentAtom.addMessage(stateRef, "nonexistent", mockMessage))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			expect(sessions["nonexistent"]).toBeUndefined()
		})
	})

	describe("updateMessage", () => {
		test("updates existing message", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)
			await Effect.runPromise(SubagentAtom.addMessage(stateRef, "child-123", mockMessage))

			const updatedMessage = { ...mockMessage, role: "assistant" as const }

			await Effect.runPromise(SubagentAtom.updateMessage(stateRef, "child-123", updatedMessage))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect(session?.messages[0]?.role).toBe("assistant")
		})

		test("does nothing if message does not exist", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			const updatedMessage = { ...mockMessage, id: "nonexistent" }

			await Effect.runPromise(SubagentAtom.updateMessage(stateRef, "child-123", updatedMessage))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect(session?.messages).toHaveLength(0)
		})
	})

	describe("addPart", () => {
		test("adds part to message", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)
			await Effect.runPromise(SubagentAtom.addMessage(stateRef, "child-123", mockMessage))

			await Effect.runPromise(SubagentAtom.addPart(stateRef, "child-123", mockMessage.id, mockPart))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect(session?.parts[mockMessage.id]).toHaveLength(1)
			expect(session?.parts[mockMessage.id]?.[0]).toEqual(mockPart)
		})

		test("initializes parts array if message exists but has no parts", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			await Effect.runPromise(SubagentAtom.addPart(stateRef, "child-123", "msg-new", mockPart))

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect(session?.parts["msg-new"]).toBeDefined()
			expect(session?.parts["msg-new"]).toHaveLength(1)
		})
	})

	describe("updatePart", () => {
		test("updates existing part", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)
			await Effect.runPromise(SubagentAtom.addMessage(stateRef, "child-123", mockMessage))
			await Effect.runPromise(SubagentAtom.addPart(stateRef, "child-123", mockMessage.id, mockPart))

			const updatedPart = { ...mockPart, text: "updated part" } as Part

			await Effect.runPromise(
				SubagentAtom.updatePart(stateRef, "child-123", mockMessage.id, updatedPart),
			)

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect((session?.parts[mockMessage.id]?.[0] as any)?.text).toBe("updated part")
		})

		test("does nothing if part does not exist", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)
			await Effect.runPromise(SubagentAtom.addMessage(stateRef, "child-123", mockMessage))

			const updatedPart = { ...mockPart, id: "nonexistent" }

			await Effect.runPromise(
				SubagentAtom.updatePart(stateRef, "child-123", mockMessage.id, updatedPart),
			)

			const sessions = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			const session = sessions["child-123"]

			expect(session?.parts[mockMessage.id]).toEqual([])
		})
	})

	describe("setStatus", () => {
		test("updates session status", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			const sessions1 = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			expect(sessions1["child-123"]?.status).toBe("running")

			await Effect.runPromise(SubagentAtom.setStatus(stateRef, "child-123", "completed"))

			const sessions2 = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			expect(sessions2["child-123"]?.status).toBe("completed")

			await Effect.runPromise(SubagentAtom.setStatus(stateRef, "child-123", "error"))

			const sessions3 = await Effect.runPromise(SubagentAtom.getSessions(stateRef))
			expect(sessions3["child-123"]?.status).toBe("error")
		})
	})

	describe("toggleExpanded", () => {
		test("toggles expansion state", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			const expanded1 = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-1"))
			expect(expanded1).toBe(false)

			await Effect.runPromise(SubagentAtom.toggleExpanded(stateRef, "part-1"))

			const expanded2 = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-1"))
			expect(expanded2).toBe(true)

			await Effect.runPromise(SubagentAtom.toggleExpanded(stateRef, "part-1"))

			const expanded3 = await Effect.runPromise(SubagentAtom.isExpanded(stateRef, "part-1"))
			expect(expanded3).toBe(false)
		})
	})

	describe("getByParentPart", () => {
		test("retrieves session by parent part ID", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			await Effect.runPromise(
				SubagentAtom.registerSubagent(stateRef, "child-123", "parent-456", "part-789", "TestAgent"),
			)

			const session = await Effect.runPromise(SubagentAtom.getByParentPart(stateRef, "part-789"))
			expect(session?.id).toBe("child-123")
		})

		test("returns undefined if parent part ID not found", async () => {
			const stateRef = await Effect.runPromise(SubagentAtom.create())

			const session = await Effect.runPromise(SubagentAtom.getByParentPart(stateRef, "nonexistent"))
			expect(session).toBeUndefined()
		})
	})
})
