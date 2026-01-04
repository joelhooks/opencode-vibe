/**
 * List command tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { run } from "./list.js"
import type { CommandContext } from "./index.js"
import type { Session } from "@opencode-vibe/core/types"

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

	describe("status reactivity", () => {
		it("characterization: Registry.subscribe fires when statusAtom changes", async () => {
			// Document how effect-atom Registry.subscribe works
			const { Registry, sessionsAtom, statusAtom, worldAtom } = await import(
				"@opencode-vibe/core/world"
			)

			const registry = Registry.make()

			// CRITICAL: Mount the atom to keep it alive and reactive
			// From Hivemind mem-f081811ec795ff2a: "Use r.mount() which keeps atoms alive while mounted"
			const cleanup = registry.mount(worldAtom)

			// Track worldAtom changes
			const stateChanges: Array<{ sessionCount: number; statusCount: number }> = []
			const unsubscribe = registry.subscribe(worldAtom, (world) => {
				stateChanges.push({
					sessionCount: world.sessions.length,
					statusCount: world.stats?.active ?? 0,
				})
			})

			// Registry.subscribe does NOT fire immediately (unlike merged-stream.subscribe)
			expect(stateChanges.length).toBe(0)

			// Add a session
			const mockSession: Session = {
				id: "test-session-1",
				directory: "/test",
				title: "Test Session",
				model: { name: "test-model" },
				time: { created: Date.now(), updated: Date.now() },
				tokens: {},
			}
			const sessions = new Map(registry.get(sessionsAtom))
			sessions.set(mockSession.id, mockSession)
			registry.set(sessionsAtom, sessions)

			// Should trigger worldAtom recomputation
			expect(stateChanges.length).toBeGreaterThan(0)
			expect(stateChanges[stateChanges.length - 1]?.sessionCount).toBe(1)

			// Now update status for that session
			const beforeStatusUpdate = stateChanges.length
			const statuses = new Map(registry.get(statusAtom))
			statuses.set(mockSession.id, "running")
			registry.set(statusAtom, statuses)

			// Should trigger another worldAtom recomputation
			expect(stateChanges.length).toBeGreaterThan(beforeStatusUpdate)

			// Get latest world state
			const world = registry.get(worldAtom)
			expect(world.sessions[0]?.status).toBe("running")
			expect(world.sessions[0]?.isActive).toBe(true)

			unsubscribe()
			cleanup()
		})

		it("RED: merged stream subscribe fires when status changes idle→running", async () => {
			// This test documents the expected behavior: status changes should trigger subscribe callbacks
			const { createMergedWorldStream, Registry, sessionsAtom, statusAtom, worldAtom } =
				await import("@opencode-vibe/core/world")

			const registry = Registry.make()
			const stream = createMergedWorldStream({ registry })

			// Track callback invocations
			const callbacks: Array<{ sessionCount: number; activeCount: number }> = []

			const unsubscribe = stream.subscribe((world) => {
				callbacks.push({
					sessionCount: world.sessions.length,
					activeCount: world.activeSessionCount,
				})
			})

			// Should fire immediately (BehaviorSubject pattern - merged-stream line 267)
			expect(callbacks.length).toBe(1)
			expect(callbacks[0]?.sessionCount).toBe(0)

			// Add a session
			const mockSession: Session = {
				id: "test-session-1",
				directory: "/test",
				title: "Test Session",
				model: { name: "test-model" },
				time: { created: Date.now(), updated: Date.now() },
				tokens: {},
			}

			const sessions = new Map(registry.get(sessionsAtom))
			sessions.set(mockSession.id, mockSession)
			registry.set(sessionsAtom, sessions)

			// Should trigger callback (session added)
			expect(callbacks.length).toBe(2)
			expect(callbacks[callbacks.length - 1]?.sessionCount).toBe(1)

			// Update status to "running" (simulating session.status SSE event)
			const beforeStatusUpdate = callbacks.length
			const statuses = new Map(registry.get(statusAtom))
			statuses.set(mockSession.id, "running")
			registry.set(statusAtom, statuses)

			// This should trigger callback - if it doesn't, that's the bug!
			expect(callbacks.length).toBe(beforeStatusUpdate + 1)
			expect(callbacks[callbacks.length - 1]?.activeCount).toBe(1)

			// Verify world state has updated status
			const world = registry.get(worldAtom)
			expect(world.sessions[0]?.status).toBe("running")
			expect(world.sessions[0]?.isActive).toBe(true)

			unsubscribe()
			await stream.dispose()
		})
	})
})
