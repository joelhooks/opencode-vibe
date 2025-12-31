/**
 * Tests for useSubagentSync hook
 */

// Set up DOM environment for React Testing Library
import { Window } from "happy-dom"
const window = new Window()
// @ts-ignore - happy-dom types don't perfectly match DOM types, but work at runtime
globalThis.document = window.document
// @ts-ignore - happy-dom types don't perfectly match DOM types, but work at runtime
globalThis.window = window

import { renderHook, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useSubagentSync } from "./use-subagent-sync"
import { subagents } from "@opencode-vibe/core/api"
import type { SubagentStateRef } from "@opencode-vibe/core/api"
import type { Message, Part } from "@opencode-vibe/core/types"

// Mock the dependencies
vi.mock("./use-multi-server-sse", () => ({
	useMultiServerSSE: vi.fn(),
}))

vi.mock("@opencode-vibe/core/api", () => ({
	subagents: {
		create: vi.fn(),
		registerSubagent: vi.fn(),
		addMessage: vi.fn(),
		updateMessage: vi.fn(),
		addPart: vi.fn(),
		updatePart: vi.fn(),
		setStatus: vi.fn(),
		getSessions: vi.fn(),
	},
}))

import { useMultiServerSSE } from "./use-multi-server-sse"

describe("useSubagentSync", () => {
	let mockStateRef: SubagentStateRef

	beforeEach(() => {
		vi.clearAllMocks()
		// Mock the Effect Ref type - we don't need the actual implementation
		mockStateRef = {} as SubagentStateRef
		;(subagents.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockStateRef)
		// Default: no registered subagents
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({})
	})

	it("creates a subagent state ref on mount", async () => {
		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalledTimes(1)
		})
	})

	it("subscribes to SSE events", () => {
		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		expect(useMultiServerSSE).toHaveBeenCalledWith({
			onEvent: expect.any(Function),
		})
	})

	it("calls addMessage when message.created event received", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to include the session
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"child-session": {
				id: "child-session",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		const message: Message = {
			id: "msg-123",
			sessionID: "child-session",
			role: "user",
			time: { created: Date.now() },
		}

		const event = {
			directory: "/test/dir",
			payload: {
				type: "message.created",
				properties: message,
			},
		}

		capturedOnEvent?.(event)

		await waitFor(() => {
			expect(subagents.addMessage).toHaveBeenCalledWith(mockStateRef, "child-session", message)
		})
	})

	it("calls updateMessage when message.updated event received", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to include the session
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"child-session": {
				id: "child-session",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		const message: Message = {
			id: "msg-123",
			sessionID: "child-session",
			role: "assistant",
			time: { created: Date.now(), completed: Date.now() },
			finish: "stop",
		}

		const event = {
			directory: "/test/dir",
			payload: {
				type: "message.updated",
				properties: message,
			},
		}

		capturedOnEvent?.(event)

		await waitFor(() => {
			expect(subagents.updateMessage).toHaveBeenCalledWith(mockStateRef, "child-session", message)
		})
	})

	it("calls addPart when part.created event received (after message)", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to include the session
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"child-session": {
				id: "child-session",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		// First send the message so we have the mapping
		const message: Message = {
			id: "msg-123",
			sessionID: "child-session",
			role: "user",
			time: { created: Date.now() },
		}

		const messageEvent = {
			directory: "/test/dir",
			payload: {
				type: "message.created",
				properties: message,
			},
		}

		capturedOnEvent?.(messageEvent)

		await waitFor(() => {
			expect(subagents.addMessage).toHaveBeenCalled()
		})

		// Now send the part
		const part: Part = {
			id: "part-123",
			messageID: "msg-123",
			type: "text",
			content: "Hello world",
		}

		const event = {
			directory: "/test/dir",
			payload: {
				type: "message.part.created",
				properties: part,
			},
		}

		capturedOnEvent?.(event)

		await waitFor(() => {
			expect(subagents.addPart).toHaveBeenCalledWith(mockStateRef, "child-session", "msg-123", part)
		})
	})

	it("calls updatePart when part.updated event received (after message)", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to include the session
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"child-session": {
				id: "child-session",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		// First send the message so we have the mapping
		const message: Message = {
			id: "msg-123",
			sessionID: "child-session",
			role: "user",
			time: { created: Date.now() },
		}

		const messageEvent = {
			directory: "/test/dir",
			payload: {
				type: "message.created",
				properties: message,
			},
		}

		capturedOnEvent?.(messageEvent)

		await waitFor(() => {
			expect(subagents.addMessage).toHaveBeenCalled()
		})

		// Now send the part update
		const part: Part = {
			id: "part-123",
			messageID: "msg-123",
			type: "text",
			content: "Hello world updated",
		}

		const event = {
			directory: "/test/dir",
			payload: {
				type: "message.part.updated",
				properties: part,
			},
		}

		capturedOnEvent?.(event)

		await waitFor(() => {
			expect(subagents.updatePart).toHaveBeenCalledWith(
				mockStateRef,
				"child-session",
				"msg-123",
				part,
			)
		})
	})

	it("ignores non-message and non-part events", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		const event = {
			directory: "/test/dir",
			payload: {
				type: "session.created",
				properties: { id: "session-123" },
			},
		}

		capturedOnEvent?.(event)

		// Wait a bit to ensure no calls were made
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(subagents.addMessage).not.toHaveBeenCalled()
		expect(subagents.updateMessage).not.toHaveBeenCalled()
		expect(subagents.addPart).not.toHaveBeenCalled()
		expect(subagents.updatePart).not.toHaveBeenCalled()
	})

	it("filters events by directory when directory option provided", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to include both sessions
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"child-session": {
				id: "child-session",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
			"child-session-2": {
				id: "child-session-2",
				parentSessionId: "parent-session",
				parentPartId: "part-456",
				agentName: "TestAgent2",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session", directory: "/target/dir" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		// Event from different directory - should be ignored
		const wrongDirEvent = {
			directory: "/other/dir",
			payload: {
				type: "message.created",
				properties: {
					id: "msg-123",
					sessionID: "child-session",
					role: "user",
					time: { created: Date.now() },
				},
			},
		}

		capturedOnEvent?.(wrongDirEvent)

		// Wait a bit
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(subagents.addMessage).not.toHaveBeenCalled()

		// Event from correct directory - should be processed
		const correctDirEvent = {
			directory: "/target/dir",
			payload: {
				type: "message.created",
				properties: {
					id: "msg-456",
					sessionID: "child-session-2",
					role: "user",
					time: { created: Date.now() },
				} as Message,
			},
		}

		capturedOnEvent?.(correctDirEvent)

		await waitFor(() => {
			expect(subagents.addMessage).toHaveBeenCalledWith(
				mockStateRef,
				"child-session-2",
				expect.objectContaining({ id: "msg-456" }),
			)
		})
	})

	it("only processes messages from registered subagent sessions", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to return registered subagents
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"registered-child": {
				id: "registered-child",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		// Message from unregistered session - should be ignored
		const unregisteredEvent = {
			directory: "/test/dir",
			payload: {
				type: "message.created",
				properties: {
					id: "msg-unregistered",
					sessionID: "unregistered-child",
					role: "user",
					time: { created: Date.now() },
				} as Message,
			},
		}

		capturedOnEvent?.(unregisteredEvent)

		await new Promise((resolve) => setTimeout(resolve, 50))

		// Message from registered session - should be processed
		const registeredEvent = {
			directory: "/test/dir",
			payload: {
				type: "message.created",
				properties: {
					id: "msg-registered",
					sessionID: "registered-child",
					role: "user",
					time: { created: Date.now() },
				} as Message,
			},
		}

		capturedOnEvent?.(registeredEvent)

		await waitFor(() => {
			// Only the registered session's message should be processed
			expect(subagents.addMessage).toHaveBeenCalledTimes(1)
			expect(subagents.addMessage).toHaveBeenCalledWith(
				mockStateRef,
				"registered-child",
				expect.objectContaining({ id: "msg-registered" }),
			)
		})
	})

	it("queues parts that arrive before their message", async () => {
		let capturedOnEvent: ((event: any) => void) | undefined

		// Mock getSessions to return registered subagent
		;(subagents.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
			"child-session": {
				id: "child-session",
				parentSessionId: "parent-session",
				parentPartId: "part-123",
				agentName: "TestAgent",
				status: "running",
				messages: [],
				parts: {},
			},
		})

		;(useMultiServerSSE as ReturnType<typeof vi.fn>).mockImplementation((options) => {
			capturedOnEvent = options?.onEvent
		})

		renderHook(() => useSubagentSync({ sessionId: "parent-session" }))

		await waitFor(() => {
			expect(subagents.create).toHaveBeenCalled()
		})

		// Part arrives BEFORE message (out-of-order)
		const partEvent = {
			directory: "/test/dir",
			payload: {
				type: "message.part.created",
				properties: {
					id: "part-123",
					messageID: "msg-123",
					type: "text",
					content: "Hello",
				} as Part,
			},
		}

		capturedOnEvent?.(partEvent)

		// Part should be queued, not processed yet
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(subagents.addPart).not.toHaveBeenCalled()

		// Now message arrives
		const messageEvent = {
			directory: "/test/dir",
			payload: {
				type: "message.created",
				properties: {
					id: "msg-123",
					sessionID: "child-session",
					role: "user",
					time: { created: Date.now() },
				} as Message,
			},
		}

		capturedOnEvent?.(messageEvent)

		await waitFor(() => {
			// Message should be added
			expect(subagents.addMessage).toHaveBeenCalledWith(
				mockStateRef,
				"child-session",
				expect.objectContaining({ id: "msg-123" }),
			)

			// Queued part should be flushed and added
			expect(subagents.addPart).toHaveBeenCalledWith(
				mockStateRef,
				"child-session",
				"msg-123",
				expect.objectContaining({ id: "part-123" }),
			)
		})
	})
})
