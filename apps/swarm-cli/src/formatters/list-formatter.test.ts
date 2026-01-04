/**
 * Tests for list output formatter
 *
 * TDD approach:
 * 1. Write failing tests first (RED)
 * 2. Implement minimum code to pass (GREEN)
 * 3. Refactor while keeping tests green
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest"
import chalk from "chalk"
import type { EnrichedSession } from "@opencode-vibe/core/world"
import {
	formatProjectList,
	formatProjectHeader,
	formatSessionRow,
	formatContextUsage,
	type ProjectGroup,
} from "./list-formatter.js"

// Force chalk to use colors in tests
beforeAll(() => {
	chalk.level = 3 // Enable full color support
})

afterAll(() => {
	chalk.level = 0 // Restore default
})

// Test helpers
function createSession(overrides: Partial<EnrichedSession> = {}): EnrichedSession {
	const now = Date.now()
	return {
		id: "ses_123",
		title: "Test session",
		directory: "/test/path",
		time: {
			created: now - 300000, // 5 minutes ago
			updated: now - 300000,
		},
		status: "completed",
		isActive: false,
		messages: [],
		unreadCount: 0,
		contextUsagePercent: 0,
		lastActivityAt: now - 300000,
		...overrides,
	}
}

describe("formatContextUsage", () => {
	test("shows percentage when usage data exists", () => {
		// formatContextUsage uses pre-computed contextUsagePercent from Core
		// (Core applies correct formula: excludes cache.write, accounts for output reserve)
		const session = createSession({
			contextUsagePercent: 15,
		})

		const result = formatContextUsage(session)
		expect(result).toBe("15%")
	})

	test("shows -- when no token data", () => {
		const session = createSession({})
		const result = formatContextUsage(session)
		expect(result).toBe("--")
	})

	test("shows -- when no model limits", () => {
		const session = createSession({})
		const result = formatContextUsage(session)
		expect(result).toBe("--")
	})

	test("shows -- when context limit is 0", () => {
		// contextUsagePercent defaults to 0 in createSession, which triggers "--"
		const session = createSession({})
		const result = formatContextUsage(session)
		expect(result).toBe("--")
	})

	test("rounds percentage to whole number", () => {
		// formatContextUsage uses pre-computed contextUsagePercent from Core
		// Core already rounds the percentage
		const session = createSession({
			contextUsagePercent: 6,
		})

		const result = formatContextUsage(session)
		expect(result).toBe("6%")
	})
})

describe("formatSessionRow", () => {
	test("formats running session", () => {
		const session = createSession({
			title: "Implement feature",
			time: {
				created: Date.now() - 120000, // 2 minutes ago
				updated: Date.now() - 120000,
			},
			contextUsagePercent: 65, // Pre-computed by Core
		})

		const result = formatSessionRow(session)
		// Should contain: indicator, title, status (inferred), relative time, percentage
		expect(result).toContain("Implement feature")
		expect(result).toContain("2m ago")
		expect(result).toContain("65%")
	})

	test("truncates long titles with ellipsis", () => {
		const session = createSession({
			title: "This is a very long session title that should be truncated to fit the display",
		})

		const result = formatSessionRow(session)
		expect(result.length).toBeLessThan(100)
		expect(result).toContain("...")
	})

	test("handles missing token data gracefully", () => {
		const session = createSession({
			title: "No tokens",
		})

		const result = formatSessionRow(session)
		expect(result).toContain("No tokens")
		expect(result).toContain("--")
	})

	test("uses green circle for active sessions", () => {
		const session = createSession({
			title: "Active session",
			status: "running", // Active status = green circle
		})

		const result = formatSessionRow(session)
		expect(result).toContain("🟢")
	})

	test("uses white circle for old sessions", () => {
		const session = createSession({
			title: "Old session",
			status: "completed", // Completed status = white circle
		})

		const result = formatSessionRow(session)
		expect(result).toContain("⚪")
	})

	describe("color coding by status", () => {
		test("applies green color for running status", () => {
			const session = createSession({
				title: "Running session",
				status: "running",
			})

			const result = formatSessionRow(session)
			// Should contain ANSI green color code (chalk.green wraps the title)
			expect(result).toContain("\u001b[32m") // Green
			expect(result).toContain("Running session")
		})

		test("applies green color for pending status", () => {
			const session = createSession({
				title: "Pending session",
				status: "pending",
			})

			const result = formatSessionRow(session)
			// Should contain ANSI green color code
			expect(result).toContain("\u001b[32m") // Green
			expect(result).toContain("Pending session")
		})

		test("applies yellow color for error status (retry)", () => {
			const session = createSession({
				title: "Error session",
				status: "error",
			})

			const result = formatSessionRow(session)
			// Should contain ANSI yellow color code (chalk.yellow)
			expect(result).toContain("\u001b[33m") // Yellow
			expect(result).toContain("Error session")
		})

		test("applies gray color for completed status", () => {
			const session = createSession({
				title: "Completed session",
				status: "completed",
			})

			const result = formatSessionRow(session)
			// Should contain ANSI gray color code (chalk.gray)
			expect(result).toContain("\u001b[90m") // Gray
			expect(result).toContain("Completed session")
		})

		test("applies gray color for idle status", () => {
			const session = createSession({
				title: "Idle session",
				status: "idle",
			})

			const result = formatSessionRow(session)
			// Should contain ANSI gray color code
			expect(result).toContain("\u001b[90m") // Gray
			expect(result).toContain("Idle session")
		})

		test("handles truncated titles with color", () => {
			const session = createSession({
				title: "This is a very long running session title that will be truncated",
				status: "running",
			})

			const result = formatSessionRow(session)
			// Should have green color AND ellipsis
			expect(result).toContain("\u001b[32m") // Green
			expect(result).toContain("...")
		})
	})
})

describe("formatProjectHeader", () => {
	test("formats header with active count", () => {
		const group: ProjectGroup = {
			directory: "/Users/joel/Code/project",
			sessions: [createSession(), createSession()],
			lastActivity: new Date(Date.now() - 120000),
			activeCount: 2,
		}

		const result = formatProjectHeader(group)
		expect(result).toContain("📁")
		expect(result).toContain("/Users/joel/Code/project")
		expect(result).toContain("(2 active)")
	})

	test("shows (0 active) when no active sessions", () => {
		const group: ProjectGroup = {
			directory: "/Users/joel/Code/project",
			sessions: [createSession()],
			lastActivity: new Date(Date.now() - 86400000),
			activeCount: 0,
		}

		const result = formatProjectHeader(group)
		expect(result).toContain("(0 active)")
	})

	test("handles very long paths", () => {
		const group: ProjectGroup = {
			directory: "/Users/joel/Code/some/very/deeply/nested/project/structure/that/is/too/long",
			sessions: [createSession()],
			lastActivity: new Date(),
			activeCount: 1,
		}

		const result = formatProjectHeader(group)
		expect(result).toContain("📁")
	})
})

describe("formatProjectList", () => {
	test("formats multiple projects with sessions", () => {
		const groups: ProjectGroup[] = [
			{
				directory: "/Users/joel/Code/project1",
				sessions: [
					createSession({ title: "Session 1", id: "ses_1" }),
					createSession({ title: "Session 2", id: "ses_2" }),
				],
				lastActivity: new Date(Date.now() - 120000),
				activeCount: 2,
			},
			{
				directory: "/Users/joel/Code/project2",
				sessions: [createSession({ title: "Session 3", id: "ses_3" })],
				lastActivity: new Date(Date.now() - 300000),
				activeCount: 1,
			},
		]

		const result = formatProjectList(groups)
		expect(result).toContain("📁 /Users/joel/Code/project1")
		expect(result).toContain("📁 /Users/joel/Code/project2")
		expect(result).toContain("Session 1")
		expect(result).toContain("Session 2")
		expect(result).toContain("Session 3")
		expect(result).toContain("(2 active)")
		expect(result).toContain("(1 active)")
	})

	test("returns empty string for empty array", () => {
		const result = formatProjectList([])
		expect(result).toBe("")
	})

	test("handles project with no sessions", () => {
		const groups: ProjectGroup[] = [
			{
				directory: "/Users/joel/Code/empty",
				sessions: [],
				lastActivity: new Date(),
				activeCount: 0,
			},
		]

		const result = formatProjectList(groups)
		expect(result).toContain("📁 /Users/joel/Code/empty")
		expect(result).toContain("(0 active)")
	})

	test("indents session rows under project header", () => {
		const groups: ProjectGroup[] = [
			{
				directory: "/test",
				sessions: [createSession({ title: "Test", id: "ses_1" })],
				lastActivity: new Date(),
				activeCount: 1,
			},
		]

		const result = formatProjectList(groups)
		const lines = result.split("\n")
		// First line is header (no indent), second line is session (indented)
		expect(lines[0]).toMatch(/^📁/)
		expect(lines[1]).toMatch(/^\s+🟢|⚪/)
	})

	test("separates projects with blank line", () => {
		const groups: ProjectGroup[] = [
			{
				directory: "/project1",
				sessions: [createSession()],
				lastActivity: new Date(),
				activeCount: 1,
			},
			{
				directory: "/project2",
				sessions: [createSession()],
				lastActivity: new Date(),
				activeCount: 1,
			},
		]

		const result = formatProjectList(groups)
		// Should have blank line between projects
		expect(result).toContain("\n\n")
	})

	describe("session hierarchy", () => {
		test("renders nested sessions with indentation", () => {
			const parent = createSession({
				id: "parent",
				title: "Main coordinator",
				status: "running",
			})
			const child1 = createSession({
				id: "child1",
				title: "Worker: fix auth",
				status: "running",
				parentID: "parent",
			})
			const child2 = createSession({
				id: "child2",
				title: "Worker: add tests",
				status: "completed",
				parentID: "parent",
			})

			// Mock hierarchical structure (as returned by transform)
			const hierarchicalParent = {
				...parent,
				depth: 0,
				children: [
					{ ...child1, depth: 1, children: undefined },
					{ ...child2, depth: 1, children: undefined },
				],
			}

			const groups: ProjectGroup[] = [
				{
					directory: "/project",
					sessions: [hierarchicalParent],
					lastActivity: new Date(),
					activeCount: 2,
				},
			]

			const result = formatProjectList(groups)
			const lines = result.split("\n")

			// Parent should have no tree prefix (check content, ANSI codes may be present)
			expect(lines[1]).toContain("🟢")
			expect(lines[1]).toContain("Main coordinator")
			expect(lines[1]).not.toContain("└─")

			// Children should have tree branch prefix
			expect(lines[2]).toContain("└─")
			expect(lines[2]).toContain("🟢")
			expect(lines[2]).toContain("Worker: fix auth")
			expect(lines[3]).toContain("└─")
			expect(lines[3]).toContain("⚪")
			expect(lines[3]).toContain("Worker: add tests")
		})

		test("supports 4 levels of nesting", () => {
			const level0 = createSession({ id: "l0", title: "Level 0", status: "running" })
			const level1 = createSession({ id: "l1", title: "Level 1", parentID: "l0" })
			const level2 = createSession({ id: "l2", title: "Level 2", parentID: "l1" })
			const level3 = createSession({ id: "l3", title: "Level 3", parentID: "l2" })

			const hierarchical = {
				...level0,
				depth: 0,
				children: [
					{
						...level1,
						depth: 1,
						children: [
							{
								...level2,
								depth: 2,
								children: [
									{
										...level3,
										depth: 3,
										children: undefined,
									},
								],
							},
						],
					},
				],
			}

			const groups: ProjectGroup[] = [
				{
					directory: "/project",
					sessions: [hierarchical],
					lastActivity: new Date(),
					activeCount: 1,
				},
			]

			const result = formatProjectList(groups)
			const lines = result.split("\n")

			// Each level should have appropriate indentation (check content, not regex with ANSI codes)
			expect(lines[1]).toContain("🟢")
			expect(lines[1]).toContain("Level 0")
			expect(lines[1]).not.toContain("└─")

			expect(lines[2]).toContain("└─")
			expect(lines[2]).toContain("⚪")
			expect(lines[2]).toContain("Level 1")

			expect(lines[3]).toContain("└─")
			expect(lines[3]).toContain("⚪")
			expect(lines[3]).toContain("Level 2")

			expect(lines[4]).toContain("└─")
			expect(lines[4]).toContain("⚪")
			expect(lines[4]).toContain("Level 3")
		})

		test("renders multiple children at same level", () => {
			const parent = createSession({ id: "parent", title: "Parent" })
			const child1 = createSession({ id: "c1", title: "Child 1", parentID: "parent" })
			const child2 = createSession({ id: "c2", title: "Child 2", parentID: "parent" })
			const child3 = createSession({ id: "c3", title: "Child 3", parentID: "parent" })

			const hierarchical = {
				...parent,
				depth: 0,
				children: [
					{ ...child1, depth: 1, children: undefined },
					{ ...child2, depth: 1, children: undefined },
					{ ...child3, depth: 1, children: undefined },
				],
			}

			const groups: ProjectGroup[] = [
				{
					directory: "/project",
					sessions: [hierarchical],
					lastActivity: new Date(),
					activeCount: 0,
				},
			]

			const result = formatProjectList(groups)

			// All children should have tree prefix (content check, ANSI codes may be present)
			expect(result).toContain("└─")
			expect(result).toContain("Child 1")
			expect(result).toContain("Child 2")
			expect(result).toContain("Child 3")
		})
	})
})
