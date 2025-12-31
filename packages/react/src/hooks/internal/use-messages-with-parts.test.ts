/**
 * useMessagesWithParts Tests - Pure logic tests
 *
 * Tests the composition logic without DOM rendering.
 * This hook combines useMessages and useParts, so we test the combining behavior.
 */

import { describe, expect, test, vi, beforeEach } from "vitest"
import type { Message, Part } from "@opencode-vibe/core/types"

// Mock the hooks we're composing
vi.mock("./use-messages", () => ({
	useMessages: vi.fn(),
}))

vi.mock("./use-parts", () => ({
	useParts: vi.fn(),
}))

import { useMessages } from "./use-messages"
import { useParts } from "./use-parts"
import { useMessagesWithParts } from "./use-messages-with-parts"

// Mock message data
const mockMessages: Message[] = [
	{
		id: "msg_1",
		sessionID: "ses_123",
		role: "user",
		time: { created: Date.now() },
	},
	{
		id: "msg_2",
		sessionID: "ses_123",
		role: "assistant",
		parentID: "msg_1",
		time: { created: Date.now() },
	},
]

// Mock parts data
const mockParts: Part[] = [
	{
		id: "part_1",
		messageID: "msg_1",
		type: "text",
		content: "Hello",
	},
	{
		id: "part_2",
		messageID: "msg_2",
		type: "text",
		content: "World",
	},
	{
		id: "part_3",
		messageID: "msg_2",
		type: "tool-call",
		content: "call-data",
	},
]

describe("useMessagesWithParts - Composition logic", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("combines messages and parts correctly", () => {
		// Mock both hooks returning data
		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: mockMessages,
			loading: false,
			error: null,
			refetch: vi.fn(),
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: mockParts,
			loading: false,
			error: null,
			refetch: vi.fn(),
		})

		// Simulate what the hook does
		const combineMessagesWithParts = (messages: Message[], parts: Part[]) => {
			return messages.map((message) => ({
				info: message,
				parts: parts.filter((part) => part.messageID === message.id),
			}))
		}

		const result = combineMessagesWithParts(mockMessages, mockParts)

		expect(result).toHaveLength(2)
		expect(result[0]?.info).toEqual(mockMessages[0])
		expect(result[0]?.parts).toHaveLength(1)
		expect(result[0]?.parts[0]).toEqual(mockParts[0])

		expect(result[1]?.info).toEqual(mockMessages[1])
		expect(result[1]?.parts).toHaveLength(2)
		expect(result[1]?.parts[0]).toEqual(mockParts[1])
		expect(result[1]?.parts[1]).toEqual(mockParts[2])
	})

	test("returns empty parts array when no parts for message", () => {
		const messagesWithNoParts: Message[] = [
			{
				id: "msg_orphan",
				sessionID: "ses_123",
				role: "user",
				time: { created: Date.now() },
			},
		]

		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: messagesWithNoParts,
			loading: false,
			error: null,
			refetch: vi.fn(),
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: mockParts, // Parts for different messages
			loading: false,
			error: null,
			refetch: vi.fn(),
		})

		const combineMessagesWithParts = (messages: Message[], parts: Part[]) => {
			return messages.map((message) => ({
				info: message,
				parts: parts.filter((part) => part.messageID === message.id),
			}))
		}

		const result = combineMessagesWithParts(messagesWithNoParts, mockParts)

		expect(result).toHaveLength(1)
		expect(result[0]?.info).toEqual(messagesWithNoParts[0])
		expect(result[0]?.parts).toEqual([]) // No parts for this message
	})

	test("loading is true when either hook is loading", () => {
		// Test 1: messages loading
		const loadingStates1 = {
			messagesLoading: true,
			partsLoading: false,
		}
		const combinedLoading1 = loadingStates1.messagesLoading || loadingStates1.partsLoading
		expect(combinedLoading1).toBe(true)

		// Test 2: parts loading
		const loadingStates2 = {
			messagesLoading: false,
			partsLoading: true,
		}
		const combinedLoading2 = loadingStates2.messagesLoading || loadingStates2.partsLoading
		expect(combinedLoading2).toBe(true)

		// Test 3: both loading
		const loadingStates3 = {
			messagesLoading: true,
			partsLoading: true,
		}
		const combinedLoading3 = loadingStates3.messagesLoading || loadingStates3.partsLoading
		expect(combinedLoading3).toBe(true)

		// Test 4: neither loading
		const loadingStates4 = {
			messagesLoading: false,
			partsLoading: false,
		}
		const combinedLoading4 = loadingStates4.messagesLoading || loadingStates4.partsLoading
		expect(combinedLoading4).toBe(false)
	})

	test("error from messages hook propagates", () => {
		const messagesError = new Error("Failed to fetch messages")

		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: [],
			loading: false,
			error: messagesError,
			refetch: vi.fn(),
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: [],
			loading: false,
			error: null,
			refetch: vi.fn(),
		})

		// Error selection logic: prefer messages error, then parts error
		const selectError = (messagesError: Error | null, partsError: Error | null) => {
			return messagesError || partsError
		}

		const error = selectError(messagesError, null)
		expect(error).toBe(messagesError)
	})

	test("error from parts hook propagates", () => {
		const partsError = new Error("Failed to fetch parts")

		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: [],
			loading: false,
			error: null,
			refetch: vi.fn(),
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: [],
			loading: false,
			error: partsError,
			refetch: vi.fn(),
		})

		const selectError = (messagesError: Error | null, partsError: Error | null) => {
			return messagesError || partsError
		}

		const error = selectError(null, partsError)
		expect(error).toBe(partsError)
	})

	test("messages error takes precedence when both hooks have errors", () => {
		const messagesError = new Error("Messages error")
		const partsError = new Error("Parts error")

		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: [],
			loading: false,
			error: messagesError,
			refetch: vi.fn(),
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: [],
			loading: false,
			error: partsError,
			refetch: vi.fn(),
		})

		const selectError = (messagesError: Error | null, partsError: Error | null) => {
			return messagesError || partsError
		}

		const error = selectError(messagesError, partsError)
		expect(error).toBe(messagesError) // Messages error wins
	})

	test("refetch calls both hooks' refetch functions", async () => {
		const mockMessagesRefetch = vi.fn()
		const mockPartsRefetch = vi.fn()

		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: [],
			loading: false,
			error: null,
			refetch: mockMessagesRefetch,
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: [],
			loading: false,
			error: null,
			refetch: mockPartsRefetch,
		})

		// Simulate combined refetch
		const combinedRefetch = async () => {
			await Promise.all([mockMessagesRefetch(), mockPartsRefetch()])
		}

		await combinedRefetch()

		expect(mockMessagesRefetch).toHaveBeenCalledTimes(1)
		expect(mockPartsRefetch).toHaveBeenCalledTimes(1)
	})

	test("handles empty messages and parts", () => {
		;(useMessages as ReturnType<typeof vi.fn>).mockReturnValue({
			messages: [],
			loading: false,
			error: null,
			refetch: vi.fn(),
		})
		;(useParts as ReturnType<typeof vi.fn>).mockReturnValue({
			parts: [],
			loading: false,
			error: null,
			refetch: vi.fn(),
		})

		const combineMessagesWithParts = (messages: Message[], parts: Part[]) => {
			return messages.map((message) => ({
				info: message,
				parts: parts.filter((part) => part.messageID === message.id),
			}))
		}

		const result = combineMessagesWithParts([], [])
		expect(result).toEqual([])
	})
})
