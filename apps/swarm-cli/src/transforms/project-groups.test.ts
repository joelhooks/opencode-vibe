/**
 * Tests for project grouping transform
 * TDD: RED → GREEN → REFACTOR
 */

import { describe, it, expect } from "vitest"
import type { EnrichedSession } from "@opencode-vibe/core/world"
import { groupSessionsByProject, type ProjectGroup } from "./project-groups.js"

describe("groupSessionsByProject", () => {
	it("returns empty array for empty input", () => {
		const result = groupSessionsByProject([])
		expect(result).toEqual([])
	})

	it("groups sessions by directory", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a" }),
			createSession({ id: "2", directory: "/project-b" }),
			createSession({ id: "3", directory: "/project-a" }),
		]

		const result = groupSessionsByProject(sessions)

		expect(result).toHaveLength(2)
		expect(result.find((p: ProjectGroup) => p.directory === "/project-a")?.sessions).toHaveLength(2)
		expect(result.find((p: ProjectGroup) => p.directory === "/project-b")?.sessions).toHaveLength(1)
	})

	it("sorts sessions within each group by updated timestamp (most recent first)", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", updated: "2024-01-01T10:00:00Z" }),
			createSession({ id: "2", directory: "/project-a", updated: "2024-01-01T12:00:00Z" }),
			createSession({ id: "3", directory: "/project-a", updated: "2024-01-01T08:00:00Z" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p: ProjectGroup) => p.directory === "/project-a")
		expect(projectA).toBeDefined()
		expect(projectA?.sessions[0]?.id).toBe("2") // 12:00 - most recent
		expect(projectA?.sessions[1]?.id).toBe("1") // 10:00
		expect(projectA?.sessions[2]?.id).toBe("3") // 08:00 - oldest
	})

	it("sorts project groups by lastActivity (most recent first)", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", updated: "2024-01-01T08:00:00Z" }),
			createSession({ id: "2", directory: "/project-b", updated: "2024-01-01T12:00:00Z" }),
			createSession({ id: "3", directory: "/project-c", updated: "2024-01-01T10:00:00Z" }),
		]

		const result = groupSessionsByProject(sessions)

		expect(result[0]?.directory).toBe("/project-b") // 12:00 - most recent
		expect(result[1]?.directory).toBe("/project-c") // 10:00
		expect(result[2]?.directory).toBe("/project-a") // 08:00 - oldest
	})

	it("calculates lastActivity from most recent session in group", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", updated: "2024-01-01T08:00:00Z" }),
			createSession({ id: "2", directory: "/project-a", updated: "2024-01-01T12:00:00Z" }),
			createSession({ id: "3", directory: "/project-a", updated: "2024-01-01T10:00:00Z" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p) => p.directory === "/project-a")
		expect(projectA?.lastActivity).toEqual(new Date("2024-01-01T12:00:00Z"))
	})

	it("calculates activeCount for sessions with status running or pending", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", status: "running" }),
			createSession({ id: "2", directory: "/project-a", status: "pending" }),
			createSession({ id: "3", directory: "/project-a", status: "completed" }),
			createSession({ id: "4", directory: "/project-a", status: "error" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p) => p.directory === "/project-a")
		expect(projectA?.activeCount).toBe(2) // running + pending
	})

	it("handles sessions with missing updated timestamp gracefully", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", updated: "2024-01-01T10:00:00Z" }),
			createSession({ id: "2", directory: "/project-a", updated: undefined }),
			createSession({ id: "3", directory: "/project-a", updated: "2024-01-01T12:00:00Z" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p: ProjectGroup) => p.directory === "/project-a")
		expect(projectA).toBeDefined()
		expect(projectA?.sessions).toHaveLength(3)
		// Sessions with missing updated should be sorted to the end
		expect(projectA?.sessions[2]?.id).toBe("2")
	})

	it("handles all sessions with status other than running/pending", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", status: "completed" }),
			createSession({ id: "2", directory: "/project-a", status: "error" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p) => p.directory === "/project-a")
		expect(projectA?.activeCount).toBe(0)
	})

	it("handles mixed status values correctly", () => {
		const sessions: EnrichedSession[] = [
			createSession({ id: "1", directory: "/project-a", status: "running" }),
			createSession({ id: "2", directory: "/project-b", status: "pending" }),
			createSession({ id: "3", directory: "/project-a", status: "completed" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p) => p.directory === "/project-a")
		const projectB = result.find((p) => p.directory === "/project-b")

		expect(projectA?.activeCount).toBe(1)
		expect(projectB?.activeCount).toBe(1)
	})

	it("BUG REPRO: activeCount matches formatter logic (status-based)", () => {
		const sessions: EnrichedSession[] = [
			// These should show 🟢 (active status)
			createSession({ id: "1", directory: "/project-a", status: "running" }),
			createSession({ id: "2", directory: "/project-a", status: "pending" }),
			// This should show ⚪ (inactive status)
			createSession({ id: "3", directory: "/project-a", status: "completed" }),
		]

		const result = groupSessionsByProject(sessions)

		const projectA = result.find((p) => p.directory === "/project-a")
		// Should count 2 active sessions (running + pending), matching what shows 🟢
		expect(projectA?.activeCount).toBe(2)
	})

	describe("session limit", () => {
		it("limits sessions to 10 by default", () => {
			const sessions: EnrichedSession[] = Array.from({ length: 15 }, (_, i) =>
				createSession({
					id: `${i}`,
					directory: "/project-a",
					updated: new Date(Date.now() - i * 1000).toISOString(),
				}),
			)

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			expect(projectA?.sessions).toHaveLength(10)
		})

		it("respects custom limit parameter", () => {
			const sessions: EnrichedSession[] = Array.from({ length: 15 }, (_, i) =>
				createSession({
					id: `${i}`,
					directory: "/project-a",
					updated: new Date(Date.now() - i * 1000).toISOString(),
				}),
			)

			const result = groupSessionsByProject(sessions, 5)

			const projectA = result.find((p) => p.directory === "/project-a")
			expect(projectA?.sessions).toHaveLength(5)
		})

		it("returns all sessions if count is below limit", () => {
			const sessions: EnrichedSession[] = Array.from({ length: 3 }, (_, i) =>
				createSession({
					id: `${i}`,
					directory: "/project-a",
					updated: new Date(Date.now() - i * 1000).toISOString(),
				}),
			)

			const result = groupSessionsByProject(sessions, 10)

			const projectA = result.find((p) => p.directory === "/project-a")
			expect(projectA?.sessions).toHaveLength(3)
		})

		it("keeps most recent sessions when limiting", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "old", directory: "/project-a", updated: "2024-01-01T08:00:00Z" }),
				createSession({ id: "new", directory: "/project-a", updated: "2024-01-01T12:00:00Z" }),
				createSession({ id: "mid", directory: "/project-a", updated: "2024-01-01T10:00:00Z" }),
			]

			const result = groupSessionsByProject(sessions, 2)

			const projectA = result.find((p) => p.directory === "/project-a")
			expect(projectA?.sessions).toHaveLength(2)
			expect(projectA?.sessions[0]?.id).toBe("new") // Most recent
			expect(projectA?.sessions[1]?.id).toBe("mid") // Second most recent
			expect(projectA?.sessions.find((s) => s.id === "old")).toBeUndefined() // Oldest dropped
		})

		it("applies limit independently to each project", () => {
			const sessions: EnrichedSession[] = [
				...Array.from({ length: 15 }, (_, i) =>
					createSession({
						id: `a-${i}`,
						directory: "/project-a",
						updated: new Date(Date.now() - i * 1000).toISOString(),
					}),
				),
				...Array.from({ length: 15 }, (_, i) =>
					createSession({
						id: `b-${i}`,
						directory: "/project-b",
						updated: new Date(Date.now() - i * 1000).toISOString(),
					}),
				),
			]

			const result = groupSessionsByProject(sessions, 5)

			const projectA = result.find((p) => p.directory === "/project-a")
			const projectB = result.find((p) => p.directory === "/project-b")

			expect(projectA?.sessions).toHaveLength(5)
			expect(projectB?.sessions).toHaveLength(5)
		})
	})

	describe("session hierarchy (parentID)", () => {
		it("builds tree structure from parentID field", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "parent-1", directory: "/project-a", title: "Main coordinator" }),
				createSession({
					id: "child-1",
					directory: "/project-a",
					title: "Worker: fix auth",
					parentID: "parent-1",
				}),
				createSession({
					id: "child-2",
					directory: "/project-a",
					title: "Worker: add tests",
					parentID: "parent-1",
				}),
			]

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			expect(projectA).toBeDefined()

			// Parent should be at top level
			const parent = projectA?.sessions.find((s) => s.id === "parent-1")
			expect(parent).toBeDefined()
			expect(parent?.children).toHaveLength(2)
			expect(parent?.children?.[0]?.id).toBe("child-1")
			expect(parent?.children?.[1]?.id).toBe("child-2")

			// Children should NOT appear at top level
			const topLevelIds = projectA?.sessions.filter((s) => !s.parentID).map((s) => s.id)
			expect(topLevelIds).toEqual(["parent-1"])
		})

		it("supports 4 levels of nesting", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "level-0", directory: "/project-a" }),
				createSession({ id: "level-1", directory: "/project-a", parentID: "level-0" }),
				createSession({ id: "level-2", directory: "/project-a", parentID: "level-1" }),
				createSession({ id: "level-3", directory: "/project-a", parentID: "level-2" }),
			]

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			const root = projectA?.sessions.find((s) => s.id === "level-0")

			expect(root?.children).toHaveLength(1)
			expect(root?.children?.[0]?.id).toBe("level-1")
			expect(root?.children?.[0]?.children).toHaveLength(1)
			expect(root?.children?.[0]?.children?.[0]?.id).toBe("level-2")
			expect(root?.children?.[0]?.children?.[0]?.children).toHaveLength(1)
			expect(root?.children?.[0]?.children?.[0]?.children?.[0]?.id).toBe("level-3")
		})

		it("handles orphan children (parentID points to non-existent parent)", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "parent-1", directory: "/project-a" }),
				createSession({ id: "orphan", directory: "/project-a", parentID: "missing-parent" }),
			]

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			// Orphan should appear at top level since parent doesn't exist
			const topLevelIds = projectA?.sessions.map((s) => s.id)
			expect(topLevelIds).toContain("orphan")
		})

		it("sorts children by updated timestamp (most recent first)", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "parent", directory: "/project-a", updated: "2024-01-01T12:00:00Z" }),
				createSession({
					id: "child-old",
					directory: "/project-a",
					parentID: "parent",
					updated: "2024-01-01T08:00:00Z",
				}),
				createSession({
					id: "child-new",
					directory: "/project-a",
					parentID: "parent",
					updated: "2024-01-01T10:00:00Z",
				}),
			]

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			const parent = projectA?.sessions.find((s) => s.id === "parent")

			expect(parent?.children?.[0]?.id).toBe("child-new") // 10:00 - most recent
			expect(parent?.children?.[1]?.id).toBe("child-old") // 08:00 - oldest
		})

		it("calculates depth for each session (0-indexed)", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "root", directory: "/project-a" }),
				createSession({ id: "child", directory: "/project-a", parentID: "root" }),
				createSession({ id: "grandchild", directory: "/project-a", parentID: "child" }),
			]

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			const root = projectA?.sessions.find((s) => s.id === "root")

			expect(root?.depth).toBe(0)
			expect(root?.children?.[0]?.depth).toBe(1)
			expect(root?.children?.[0]?.children?.[0]?.depth).toBe(2)
		})

		it("limits tree traversal to 4 levels", () => {
			const sessions: EnrichedSession[] = [
				createSession({ id: "level-0", directory: "/project-a" }),
				createSession({ id: "level-1", directory: "/project-a", parentID: "level-0" }),
				createSession({ id: "level-2", directory: "/project-a", parentID: "level-1" }),
				createSession({ id: "level-3", directory: "/project-a", parentID: "level-2" }),
				createSession({ id: "level-4", directory: "/project-a", parentID: "level-3" }), // Beyond limit
			]

			const result = groupSessionsByProject(sessions)

			const projectA = result.find((p) => p.directory === "/project-a")
			const root = projectA?.sessions.find((s) => s.id === "level-0")

			// Should stop at level 3 (0-indexed)
			const level3 = root?.children?.[0]?.children?.[0]?.children?.[0]
			expect(level3?.id).toBe("level-3")
			expect(level3?.children).toBeUndefined() // No children beyond depth 3
		})
	})
})

/**
 * Test helper: create a minimal EnrichedSession object
 */
function createSession(
	overrides: Partial<{
		id: string
		directory: string
		title: string
		updated: string | undefined
		status: "pending" | "running" | "completed" | "error" | "idle"
		parentID: string
	}>,
): EnrichedSession {
	// Handle explicit undefined (pass undefined to get missing updated)
	const updated =
		overrides.updated === undefined && "updated" in overrides
			? undefined
			: overrides.updated
				? new Date(overrides.updated).getTime()
				: Date.now()

	const status = overrides.status ?? "completed"

	return {
		id: overrides.id ?? "test-id",
		title: overrides.title ?? "Test Session",
		directory: overrides.directory ?? "/test",
		parentID: overrides.parentID,
		time: {
			created: Date.now(),
			updated: updated as number,
		},
		status,
		isActive: status === "running",
		messages: [],
		unreadCount: 0,
		contextUsagePercent: 0,
		lastActivityAt: updated ?? Date.now(),
	}
}
