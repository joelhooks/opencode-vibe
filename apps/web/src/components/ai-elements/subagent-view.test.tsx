import { describe, expect, it, beforeAll, afterEach } from "vitest"
import { Window } from "happy-dom"
import { render, cleanup } from "@testing-library/react"
import type { SubagentSession } from "@/stores/subagent-store"
import type { Message, Part } from "@/app/hooks"
import { SubagentView } from "./subagent-view"

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

describe("SubagentView", () => {
	it("renders header with agent name", () => {
		const subagent: SubagentSession = {
			id: "sess-child-1",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "TestAgent",
			status: "running",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		const header = container.querySelector(".bg-muted\\/50")
		expect(header).not.toBeNull()
		expect(header?.textContent).toContain("@TestAgent")
	})

	it("shows running indicator when status is running", () => {
		const subagent: SubagentSession = {
			id: "sess-child-2",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "RunningAgent",
			status: "running",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Check for running indicator
		const runningIndicator = container.querySelector(".animate-spin")
		expect(runningIndicator).not.toBeNull()
		expect(container.textContent).toContain("Working...")
		expect(container.textContent).toContain("Running")
	})

	it("shows completed status when subagent is done", () => {
		const subagent: SubagentSession = {
			id: "sess-child-3",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "CompletedAgent",
			status: "completed",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		expect(container.textContent).toContain("Completed")
		// Should not show working indicator
		const runningIndicator = container.querySelector(".animate-spin")
		expect(runningIndicator).toBeNull()
	})

	it("shows error status when subagent fails", () => {
		const subagent: SubagentSession = {
			id: "sess-child-4",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "ErrorAgent",
			status: "error",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		expect(container.textContent).toContain("Error")
		// Should not show working indicator
		const runningIndicator = container.querySelector(".animate-spin")
		expect(runningIndicator).toBeNull()
	})

	it("renders messages and parts", () => {
		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "sess-child-5",
				role: "user",
				time: { created: Date.now() },
			},
			{
				id: "msg-2",
				sessionID: "sess-child-5",
				role: "assistant",
				time: { created: Date.now() },
			},
		]

		const parts: Record<string, Part[]> = {
			"msg-2": [
				{
					id: "part-1",
					sessionID: "sess-child-5",
					messageID: "msg-2",
					type: "text",
					text: "Processing your request",
				},
				{
					id: "part-2",
					sessionID: "sess-child-5",
					messageID: "msg-2",
					type: "tool",
					tool: "read",
					state: {
						status: "completed",
						title: "Read file.ts",
					},
				},
			],
		}

		const subagent: SubagentSession = {
			id: "sess-child-5",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "WorkerAgent",
			status: "running",
			messages,
			parts,
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Should render the text part
		expect(container.textContent).toContain("Processing your request")
		// Should render the tool part
		expect(container.textContent).toContain("read")
		expect(container.textContent).toContain("Read file.ts")
	})

	it("only renders parts for assistant messages", () => {
		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "sess-child-6",
				role: "user",
				time: { created: Date.now() },
			},
		]

		const parts: Record<string, Part[]> = {
			"msg-1": [
				{
					id: "part-1",
					sessionID: "sess-child-6",
					messageID: "msg-1",
					type: "text",
					text: "User message part - should not render",
				},
			],
		}

		const subagent: SubagentSession = {
			id: "sess-child-6",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "TestAgent",
			status: "running",
			messages,
			parts,
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Should NOT render user message parts
		expect(container.textContent).not.toContain("User message part - should not render")
	})

	it("handles empty messages gracefully", () => {
		const subagent: SubagentSession = {
			id: "sess-child-7",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "EmptyAgent",
			status: "running",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Should still render header and working indicator
		expect(container.textContent).toContain("@EmptyAgent")
		expect(container.textContent).toContain("Working...")
	})

	it("handles missing parts for a message gracefully", () => {
		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: "sess-child-8",
				role: "assistant",
				time: { created: Date.now() },
			},
		]

		const subagent: SubagentSession = {
			id: "sess-child-8",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "TestAgent",
			status: "running",
			messages,
			parts: {}, // No parts for msg-1
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Should not crash, just render empty message container
		expect(container.querySelector(".space-y-2")).not.toBeNull()
	})

	it("renders scrollable container with max height", () => {
		const subagent: SubagentSession = {
			id: "sess-child-9",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "TestAgent",
			status: "running",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Check for scrollable container with max-height
		const scrollContainer = container.querySelector(".max-h-\\[400px\\]")
		expect(scrollContainer).not.toBeNull()
		expect(scrollContainer?.className).toContain("overflow-y-auto")
	})

	it("renders sticky header", () => {
		const subagent: SubagentSession = {
			id: "sess-child-10",
			parentSessionId: "sess-parent-1",
			parentPartId: "part-1",
			agentName: "TestAgent",
			status: "running",
			messages: [],
			parts: {},
		}

		const { container } = render(<SubagentView subagent={subagent} />)

		// Check for sticky header
		const header = container.querySelector(".sticky")
		expect(header).not.toBeNull()
		expect(header?.className).toContain("top-0")
	})

	describe("React.memo comparison", () => {
		it("should re-render when tool part state.status changes", () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "sess-child-11",
					role: "assistant",
					time: { created: Date.now() },
				},
			]

			const toolPart: Part = {
				id: "part-tool-1",
				sessionID: "sess-child-11",
				messageID: "msg-1",
				type: "tool",
				tool: "read",
				state: {
					status: "running",
					title: "Reading file.ts",
				},
			}

			const prevSubagent: SubagentSession = {
				id: "sess-child-11",
				parentSessionId: "sess-parent-1",
				parentPartId: "part-1",
				agentName: "TestAgent",
				status: "running",
				messages,
				parts: {
					"msg-1": [toolPart],
				},
			}

			const nextSubagent: SubagentSession = {
				...prevSubagent,
				parts: {
					"msg-1": [
						{
							...toolPart,
							state: {
								...toolPart.state,
								status: "completed",
							},
						},
					],
				},
			}

			// Get the memo comparison function
			const SubagentViewMemo = SubagentView as any
			const areEqual = SubagentViewMemo.compare || SubagentViewMemo.type?.compare

			expect(areEqual).toBeDefined()

			// Should return false (not equal) when status changes
			const result = areEqual({ subagent: prevSubagent }, { subagent: nextSubagent })

			expect(result).toBe(false)
		})

		it("should re-render when task tool metadata.summary changes", () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "sess-child-12",
					role: "assistant",
					time: { created: Date.now() },
				},
			]

			const taskPart: Part = {
				id: "part-task-1",
				sessionID: "sess-child-12",
				messageID: "msg-1",
				type: "tool",
				tool: "task",
				state: {
					status: "running",
					metadata: {
						summary: [
							{
								id: "subtool-1",
								state: { status: "running" },
							},
						],
					},
				},
			}

			const prevSubagent: SubagentSession = {
				id: "sess-child-12",
				parentSessionId: "sess-parent-1",
				parentPartId: "part-1",
				agentName: "TestAgent",
				status: "running",
				messages,
				parts: {
					"msg-1": [taskPart],
				},
			}

			const nextSubagent: SubagentSession = {
				...prevSubagent,
				parts: {
					"msg-1": [
						{
							...taskPart,
							state: {
								...taskPart.state,
								metadata: {
									summary: [
										{
											id: "subtool-1",
											state: { status: "completed" },
										},
									],
								},
							},
						},
					],
				},
			}

			// Get the memo comparison function
			const SubagentViewMemo = SubagentView as any
			const areEqual = SubagentViewMemo.compare || SubagentViewMemo.type?.compare

			expect(areEqual).toBeDefined()

			// Should return false (not equal) when summary status changes
			const result = areEqual({ subagent: prevSubagent }, { subagent: nextSubagent })

			expect(result).toBe(false)
		})

		it("should re-render when task tool metadata.summary.length changes", () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "sess-child-13",
					role: "assistant",
					time: { created: Date.now() },
				},
			]

			const taskPart: Part = {
				id: "part-task-1",
				sessionID: "sess-child-13",
				messageID: "msg-1",
				type: "tool",
				tool: "task",
				state: {
					status: "running",
					metadata: {
						summary: [
							{
								id: "subtool-1",
								state: { status: "completed" },
							},
						],
					},
				},
			}

			const prevSubagent: SubagentSession = {
				id: "sess-child-13",
				parentSessionId: "sess-parent-1",
				parentPartId: "part-1",
				agentName: "TestAgent",
				status: "running",
				messages,
				parts: {
					"msg-1": [taskPart],
				},
			}

			const nextSubagent: SubagentSession = {
				...prevSubagent,
				parts: {
					"msg-1": [
						{
							...taskPart,
							state: {
								...taskPart.state,
								metadata: {
									summary: [
										{
											id: "subtool-1",
											state: { status: "completed" },
										},
										{
											id: "subtool-2",
											state: { status: "running" },
										},
									],
								},
							},
						},
					],
				},
			}

			// Get the memo comparison function
			const SubagentViewMemo = SubagentView as any
			const areEqual = SubagentViewMemo.compare || SubagentViewMemo.type?.compare

			expect(areEqual).toBeDefined()

			// Should return false (not equal) when summary length increases
			const result = areEqual({ subagent: prevSubagent }, { subagent: nextSubagent })

			expect(result).toBe(false)
		})

		it("should NOT re-render when parts have same content but different object reference", () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "sess-child-14",
					role: "assistant",
					time: { created: Date.now() },
				},
			]

			const toolPart: Part = {
				id: "part-tool-1",
				sessionID: "sess-child-14",
				messageID: "msg-1",
				type: "tool",
				tool: "read",
				state: {
					status: "completed",
					title: "Reading file.ts",
				},
			}

			const prevSubagent: SubagentSession = {
				id: "sess-child-14",
				parentSessionId: "sess-parent-1",
				parentPartId: "part-1",
				agentName: "TestAgent",
				status: "running",
				messages,
				parts: {
					"msg-1": [toolPart],
				},
			}

			// Immer creates new reference even when content is identical
			const nextSubagent: SubagentSession = {
				...prevSubagent,
				parts: {
					"msg-1": [{ ...toolPart }],
				},
			}

			// Get the memo comparison function
			const SubagentViewMemo = SubagentView as any
			const areEqual = SubagentViewMemo.compare || SubagentViewMemo.type?.compare

			expect(areEqual).toBeDefined()

			// Should return true (equal) - same content, just different reference
			const result = areEqual({ subagent: prevSubagent }, { subagent: nextSubagent })

			expect(result).toBe(true)
		})
	})
})
