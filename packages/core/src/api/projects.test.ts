/**
 * Projects API Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { projects } from "./projects.js"
import type { Project } from "../atoms/projects.js"

/**
 * Mock createClient for testing
 */
vi.mock("../client/index.js", () => ({
	createClient: vi.fn(() => ({
		project: {
			list: vi.fn(() =>
				Promise.resolve({
					data: [
						{ worktree: "/path/to/project1", name: "Project 1" },
						{ worktree: "/path/to/project2", name: "Project 2" },
					],
				}),
			),
			current: vi.fn(() =>
				Promise.resolve({
					data: { worktree: "/path/to/current", name: "Current Project" },
				}),
			),
		},
	})),
}))

describe("projects API", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("list", () => {
		it("should fetch projects", async () => {
			const result = await projects.list()

			expect(result).toHaveLength(2)
			expect(result[0]?.worktree).toBe("/path/to/project1")
			expect(result[1]?.worktree).toBe("/path/to/project2")
		})
	})

	describe("current", () => {
		it("should fetch current project", async () => {
			const result = await projects.current()

			expect(result).not.toBeNull()
			if (result) {
				expect(result.worktree).toBe("/path/to/current")
			}
		})
	})
})
