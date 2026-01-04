import { describe, expect, it, beforeAll, afterEach } from "vitest"
import { Window } from "happy-dom"
import { render, cleanup } from "@testing-library/react"
import type { Part } from "@/app/hooks"
import { PartRenderer } from "./part-renderer"

// Set up DOM for React component tests
beforeAll(() => {
	const window = new Window()
	// @ts-ignore - happy-dom types don't match perfectly
	global.document = window.document
	// @ts-ignore
	global.window = window
})

afterEach(() => {
	cleanup()
})

describe("PartRenderer", () => {
	it("renders text parts", () => {
		const part: Part = {
			id: "part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "text",
			text: "Hello world",
		}

		const { container } = render(<PartRenderer part={part} />)

		const textDiv = container.querySelector("div")
		expect(textDiv).not.toBeNull()
		expect(textDiv?.textContent).toBe("Hello world")
		expect(textDiv?.className).toContain("whitespace-pre-wrap")
	})

	it("renders multiline text with whitespace preserved", () => {
		const part: Part = {
			id: "part-2",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "text",
			text: "Line 1\n  Line 2 with spaces\nLine 3",
		}

		const { container } = render(<PartRenderer part={part} />)

		const textDiv = container.querySelector("div")
		expect(textDiv?.textContent).toBe("Line 1\n  Line 2 with spaces\nLine 3")
		expect(textDiv?.className).toContain("whitespace-pre-wrap")
	})

	it("renders tool parts with status and tool name", () => {
		const part: Part = {
			id: "part-3",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "read",
			state: {
				status: "completed",
				title: "Read package.json",
			},
		}

		const { container } = render(<PartRenderer part={part} />)

		const toolDiv = container.querySelector(".bg-muted\\/30")
		expect(toolDiv).not.toBeNull()
		expect(toolDiv?.textContent).toContain("✓") // completed icon
		expect(toolDiv?.textContent).toContain("read")
		expect(toolDiv?.textContent).toContain("Read package.json")
	})

	it("renders tool parts with running status", () => {
		const part: Part = {
			id: "part-4",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "grep",
			state: {
				status: "running",
			},
		}

		const { container } = render(<PartRenderer part={part} />)

		const toolDiv = container.querySelector(".bg-muted\\/30")
		expect(toolDiv).not.toBeNull()
		expect(toolDiv?.textContent).toContain("⏳") // running icon
		expect(toolDiv?.textContent).toContain("grep")

		// Running tools should have animate-pulse
		const icon = container.querySelector(".animate-pulse")
		expect(icon).not.toBeNull()
	})

	it("renders tool parts with pending status", () => {
		const part: Part = {
			id: "part-5",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "edit",
			state: {
				status: "pending",
			},
		}

		const { container } = render(<PartRenderer part={part} />)

		const toolDiv = container.querySelector(".bg-muted\\/30")
		expect(toolDiv).not.toBeNull()
		expect(toolDiv?.textContent).toContain("◯") // pending icon
		expect(toolDiv?.textContent).toContain("edit")
	})

	it("renders tool parts without title gracefully", () => {
		const part: Part = {
			id: "part-6",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "bash",
			state: {
				status: "completed",
				// no title
			},
		}

		const { container } = render(<PartRenderer part={part} />)

		const toolDiv = container.querySelector(".bg-muted\\/30")
		expect(toolDiv).not.toBeNull()
		expect(toolDiv?.textContent).toContain("✓")
		expect(toolDiv?.textContent).toContain("bash")
		// Should not crash without title
	})

	it("renders unknown part types as null", () => {
		const part = {
			id: "part-7",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "unknown-type",
		} as unknown as Part

		const { container } = render(<PartRenderer part={part} />)

		// Should render nothing for unknown types
		expect(container.children.length).toBe(0)
	})

	it("handles tool parts with error status", () => {
		const part: Part = {
			id: "part-8",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "write",
			state: {
				status: "error",
				title: "Failed to write file",
			},
		}

		const { container } = render(<PartRenderer part={part} />)

		const toolDiv = container.querySelector(".bg-muted\\/30")
		expect(toolDiv).not.toBeNull()
		expect(toolDiv?.textContent).toContain("◯") // error treated as pending icon
		expect(toolDiv?.textContent).toContain("write")
		expect(toolDiv?.textContent).toContain("Failed to write file")
	})
})

describe("PartRenderer.memo", () => {
	it("detects metadata.summary length changes for task tools", () => {
		const part1: Part = {
			id: "task-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "task",
			state: {
				status: "running",
				metadata: {
					summary: [
						{
							id: "tool-1",
							state: { status: "running" },
						},
					],
				},
			},
		}

		const part2: Part = {
			id: "task-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "task",
			state: {
				status: "running",
				metadata: {
					summary: [
						{
							id: "tool-1",
							state: { status: "running" },
						},
						{
							id: "tool-2",
							state: { status: "running" },
						},
					],
				},
			},
		}

		// Memo should return false (should re-render) when summary length changes
		const memoCompare = (PartRenderer as any).compare
		const shouldSkipRender = memoCompare({ part: part1 }, { part: part2 })

		expect(shouldSkipRender).toBe(false)
	})

	it("detects metadata.summary last item status changes for task tools", () => {
		const part1: Part = {
			id: "task-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "task",
			state: {
				status: "running",
				metadata: {
					summary: [
						{
							id: "tool-1",
							state: { status: "running" },
						},
						{
							id: "tool-2",
							state: { status: "running" },
						},
					],
				},
			},
		}

		const part2: Part = {
			id: "task-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "task",
			state: {
				status: "running",
				metadata: {
					summary: [
						{
							id: "tool-1",
							state: { status: "running" },
						},
						{
							id: "tool-2",
							state: { status: "completed" },
						},
					],
				},
			},
		}

		// Memo should return false (should re-render) when last item status changes
		const memoCompare = (PartRenderer as any).compare
		const shouldSkipRender = memoCompare({ part: part1 }, { part: part2 })

		expect(shouldSkipRender).toBe(false)
	})

	it("skips re-render when task tool metadata.summary is identical", () => {
		const part1: Part = {
			id: "task-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "task",
			state: {
				status: "running",
				metadata: {
					summary: [
						{
							id: "tool-1",
							state: { status: "completed" },
						},
						{
							id: "tool-2",
							state: { status: "running" },
						},
					],
				},
			},
		}

		const part2: Part = {
			id: "task-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "task",
			state: {
				status: "running",
				metadata: {
					summary: [
						{
							id: "tool-1",
							state: { status: "completed" },
						},
						{
							id: "tool-2",
							state: { status: "running" },
						},
					],
				},
			},
		}

		// Memo should return true (skip re-render) when metadata.summary is identical
		const memoCompare = (PartRenderer as any).compare
		const shouldSkipRender = memoCompare({ part: part1 }, { part: part2 })

		expect(shouldSkipRender).toBe(true)
	})

	it("skips re-render for non-task tool parts with identical state", () => {
		const part1: Part = {
			id: "read-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "read",
			state: {
				status: "completed",
				title: "Read file",
			},
		}

		const part2: Part = {
			id: "read-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "read",
			state: {
				status: "completed",
				title: "Read file",
			},
		}

		// Memo should return true (skip re-render) for non-task tools with identical state
		const memoCompare = (PartRenderer as any).compare
		const shouldSkipRender = memoCompare({ part: part1 }, { part: part2 })

		expect(shouldSkipRender).toBe(true)
	})

	it("detects status changes for non-task tools", () => {
		const part1: Part = {
			id: "read-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "read",
			state: {
				status: "running",
				title: "Read file",
			},
		}

		const part2: Part = {
			id: "read-part-1",
			sessionID: "session-1",
			messageID: "msg-1",
			type: "tool",
			tool: "read",
			state: {
				status: "completed",
				title: "Read file",
			},
		}

		// Memo should return false (should re-render) when status changes
		const memoCompare = (PartRenderer as any).compare
		const shouldSkipRender = memoCompare({ part: part1 }, { part: part2 })

		expect(shouldSkipRender).toBe(false)
	})
})
