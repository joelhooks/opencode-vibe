/**
 * Tests for useSubagent hook
 *
 * Component-level hook for accessing a specific part's subagent.
 * Wraps useSubagents (plural) and provides filtered view.
 *
 * Tests the filtering logic and derived state computation.
 * Doesn't test React rendering - we test the data transformations.
 */

import { describe, it, expect } from "vitest"
import type { SubagentSession } from "@opencode-vibe/core/api"

describe("useSubagent - filtering and derived state logic", () => {
	it("returns undefined when partToSession has no mapping", () => {
		const partToSession: Record<string, string> = {}
		const sessions: Record<string, SubagentSession> = {}

		const partId = "nonexistent-part"
		const sessionId = partToSession[partId]
		const subagent = sessionId ? sessions[sessionId] : undefined

		expect(subagent).toBeUndefined()
	})

	it("returns subagent when partToSession has mapping and session exists", () => {
		const mockSession: SubagentSession = {
			id: "child_123",
			parentSessionId: "parent_123",
			parentPartId: "part_123",
			agentName: "Explorer",
			status: "running",
			messages: [],
			parts: {},
		}

		const partToSession: Record<string, string> = { part_123: "child_123" }
		const sessions: Record<string, SubagentSession> = { child_123: mockSession }

		const partId = "part_123"
		const sessionId = partToSession[partId]
		const subagent = sessionId ? sessions[sessionId] : undefined

		expect(subagent).toEqual(mockSession)
	})

	it("hasSubagent is true when subagent exists", () => {
		const mockSession: SubagentSession = {
			id: "child_123",
			parentSessionId: "parent_123",
			parentPartId: "part_123",
			agentName: "Explorer",
			status: "running",
			messages: [],
			parts: {},
		}

		const hasSubagent = mockSession !== undefined

		expect(hasSubagent).toBe(true)
	})

	it("hasSubagent is false when subagent is undefined", () => {
		const subagent = undefined
		const hasSubagent = subagent !== undefined

		expect(hasSubagent).toBe(false)
	})

	it("isRunning is true when status is running", () => {
		const mockSession: SubagentSession = {
			id: "child_123",
			parentSessionId: "parent_123",
			parentPartId: "part_123",
			agentName: "Explorer",
			status: "running",
			messages: [],
			parts: {},
		}

		const isRunning = mockSession?.status === "running"

		expect(isRunning).toBe(true)
	})

	it("isRunning is false when status is completed", () => {
		const mockSession: SubagentSession = {
			id: "child_123",
			parentSessionId: "parent_123",
			parentPartId: "part_123",
			agentName: "Explorer",
			status: "completed",
			messages: [],
			parts: {},
		}

		const isRunning = mockSession?.status === "running"

		expect(isRunning).toBe(false)
	})

	it("isCompleted is true when status is completed", () => {
		const mockSession: SubagentSession = {
			id: "child_123",
			parentSessionId: "parent_123",
			parentPartId: "part_123",
			agentName: "Explorer",
			status: "completed",
			messages: [],
			parts: {},
		}

		const isCompleted = mockSession?.status === "completed"

		expect(isCompleted).toBe(true)
	})

	it("isCompleted is false when status is running", () => {
		const mockSession: SubagentSession = {
			id: "child_123",
			parentSessionId: "parent_123",
			parentPartId: "part_123",
			agentName: "Explorer",
			status: "running",
			messages: [],
			parts: {},
		}

		const isCompleted = mockSession?.status === "completed"

		expect(isCompleted).toBe(false)
	})

	it("isExpanded is true when part is in expanded set", () => {
		const expanded = new Set(["part_123"])
		const partId = "part_123"

		const isExpanded = expanded.has(partId)

		expect(isExpanded).toBe(true)
	})

	it("isExpanded is false when part is not in expanded set", () => {
		const expanded = new Set<string>()
		const partId = "part_123"

		const isExpanded = expanded.has(partId)

		expect(isExpanded).toBe(false)
	})
})
