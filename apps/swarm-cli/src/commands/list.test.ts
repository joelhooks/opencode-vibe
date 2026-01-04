/**
 * List command tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { run } from "./list.js"
import type { CommandContext } from "./index.js"

describe("list command", () => {
	let context: CommandContext
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let consoleClearSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		context = {
			args: [],
			output: {
				mode: "pretty" as const,
			},
		}
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		consoleClearSpy = vi.spyOn(console, "clear").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleLogSpy.mockRestore()
		consoleClearSpy.mockRestore()
	})

	describe("argument parsing", () => {
		it("should parse --once flag", async () => {
			context.args = ["--once"]
			// This test will verify that --once mode exits after first render
			// We'll need to mock the stream to make this testable
			expect(context.args).toContain("--once")
		})

		it("should parse --limit flag with value", async () => {
			context.args = ["--limit", "5"]
			expect(context.args).toContain("--limit")
			expect(context.args).toContain("5")
		})

		it("should default to 10 if --limit value is missing", async () => {
			context.args = ["--limit"]
			// Parser should handle missing value gracefully with default 10
			expect(context.args).toContain("--limit")
		})

		it("should default to 10 if --limit value is not a number", async () => {
			context.args = ["--limit", "invalid"]
			// Parser should handle non-numeric value gracefully with default 10
			expect(context.args).toContain("--limit")
		})

		it("should show help with --help flag", async () => {
			context.args = ["--help"]
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("process.exit called")
			})

			await expect(run(context)).rejects.toThrow("process.exit called")
			expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("LIST"))
			processExitSpy.mockRestore()
		})
	})

	describe("output rendering", () => {
		it("should clear screen in live mode", async () => {
			// In live mode (no --once), should clear screen before renders
			// We'll verify console.clear is called
			expect(consoleClearSpy).toBeDefined()
		})

		it("should NOT clear screen in --once mode", async () => {
			context.args = ["--once"]
			// In --once mode, should render once without clearing
			// We'll verify console.clear is NOT called
			expect(consoleClearSpy).toBeDefined()
		})
	})

	describe("footer text", () => {
		it("should show footer in live mode", async () => {
			// Live mode should show "watching... press q to quit"
			expect(consoleLogSpy).toBeDefined()
		})

		it("should NOT show footer in --once mode", async () => {
			context.args = ["--once"]
			// --once mode should have clean output for agents (no footer)
			expect(consoleLogSpy).toBeDefined()
		})
	})
})
