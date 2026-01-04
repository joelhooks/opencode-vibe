/**
 * SSE Event Schema Tests
 *
 * RED → GREEN → REFACTOR
 * Test schemas parse backend event shapes correctly
 */

import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import {
	PartBase,
	TextPart,
	ReasoningPart,
	FilePart,
	ToolPart,
	StepStartPart,
	StepFinishPart,
	SnapshotPart,
	PatchPart,
	AgentPart,
	RetryPart,
	CompactionPart,
	Part,
	SessionCreatedEvent,
	SessionUpdatedEvent,
	SessionDeletedEvent,
	SessionStatusEvent,
	SessionIdleEvent,
	SessionCompactedEvent,
	SessionErrorEvent,
	SessionDiffEvent,
	MessageUpdatedEvent,
	MessageRemovedEvent,
	MessagePartUpdatedEvent,
	MessagePartRemovedEvent,
	SSEEvent,
} from "./schemas.js"

describe("Part Schemas", () => {
	it("TextPart has PartBase fields + text content", () => {
		const input = {
			id: "part-123",
			sessionID: "sess-456",
			messageID: "msg-789",
			type: "text",
			text: "Hello world",
		}

		const result = Schema.decodeUnknownSync(TextPart)(input)

		expect(result).toEqual(input)
		expect(result.id).toBe("part-123")
		expect(result.sessionID).toBe("sess-456")
		expect(result.messageID).toBe("msg-789")
		expect(result.type).toBe("text")
		expect(result.text).toBe("Hello world")
	})

	it("ReasoningPart has PartBase fields + reasoning content", () => {
		const input = {
			id: "part-123",
			sessionID: "sess-456",
			messageID: "msg-789",
			type: "reasoning",
			reasoning: "Thinking deeply...",
		}

		const result = Schema.decodeUnknownSync(ReasoningPart)(input)

		expect(result.type).toBe("reasoning")
		expect(result.reasoning).toBe("Thinking deeply...")
	})

	it("ToolPart has PartBase fields + tool metadata", () => {
		const input = {
			id: "part-123",
			sessionID: "sess-456",
			messageID: "msg-789",
			type: "tool",
			tool: "bash",
			state: { status: "running" },
		}

		const result = Schema.decodeUnknownSync(ToolPart)(input)

		expect(result.type).toBe("tool")
		expect(result.tool).toBe("bash")
		expect(result.state).toEqual({ status: "running" })
	})

	it("Part union discriminates by type", () => {
		const textInput = {
			id: "part-1",
			sessionID: "sess-1",
			messageID: "msg-1",
			type: "text",
			text: "Hello",
		}

		const toolInput = {
			id: "part-2",
			sessionID: "sess-2",
			messageID: "msg-2",
			type: "tool",
			tool: "bash",
		}

		const textResult = Schema.decodeUnknownSync(Part)(textInput)
		const toolResult = Schema.decodeUnknownSync(Part)(toolInput)

		expect(textResult.type).toBe("text")
		expect(toolResult.type).toBe("tool")
	})
})

describe("Session Event Schemas", () => {
	it("SessionCreatedEvent has session info", () => {
		const input = {
			type: "session.created",
			properties: {
				info: {
					id: "sess-123",
					title: "Test Session",
					directory: "/test",
					time: { created: 1234567890, updated: 1234567890 },
				},
			},
		}

		const result = Schema.decodeUnknownSync(SessionCreatedEvent)(input)

		expect(result.type).toBe("session.created")
		expect(result.properties.info.id).toBe("sess-123")
		expect(result.properties.info.title).toBe("Test Session")
	})

	it("SessionStatusEvent has sessionID and status object", () => {
		const input = {
			type: "session.status",
			properties: {
				sessionID: "sess-123",
				status: { type: "idle" },
			},
		}

		const result = Schema.decodeUnknownSync(SessionStatusEvent)(input)

		expect(result.type).toBe("session.status")
		expect(result.properties.sessionID).toBe("sess-123")
		expect(result.properties.status.type).toBe("idle")
	})

	it("SessionStatusEvent handles busy status", () => {
		const input = {
			type: "session.status",
			properties: {
				sessionID: "sess-123",
				status: { type: "busy" },
			},
		}

		const result = Schema.decodeUnknownSync(SessionStatusEvent)(input)

		expect(result.properties.status.type).toBe("busy")
	})

	it("SessionStatusEvent handles retry status with metadata", () => {
		const input = {
			type: "session.status",
			properties: {
				sessionID: "sess-123",
				status: {
					type: "retry",
					attempt: 2,
					message: "Rate limited",
					next: 5000,
				},
			},
		}

		const result = Schema.decodeUnknownSync(SessionStatusEvent)(input)

		expect(result.properties.status.type).toBe("retry")
		if (result.properties.status.type === "retry") {
			expect(result.properties.status.attempt).toBe(2)
			expect(result.properties.status.message).toBe("Rate limited")
			expect(result.properties.status.next).toBe(5000)
		}
	})
})

describe("Message Event Schemas", () => {
	it("MessageUpdatedEvent has message info", () => {
		const input = {
			type: "message.updated",
			properties: {
				info: {
					id: "msg-123",
					sessionID: "sess-456",
					role: "user",
					time: { created: 1234567890 },
				},
			},
		}

		const result = Schema.decodeUnknownSync(MessageUpdatedEvent)(input)

		expect(result.type).toBe("message.updated")
		expect(result.properties.info.id).toBe("msg-123")
	})

	it("MessageRemovedEvent has sessionID and messageID", () => {
		const input = {
			type: "message.removed",
			properties: {
				sessionID: "sess-123",
				messageID: "msg-456",
			},
		}

		const result = Schema.decodeUnknownSync(MessageRemovedEvent)(input)

		expect(result.type).toBe("message.removed")
		expect(result.properties.sessionID).toBe("sess-123")
		expect(result.properties.messageID).toBe("msg-456")
	})
})

describe("Part Event Schemas", () => {
	it("MessagePartUpdatedEvent has part object with sessionID", () => {
		const input = {
			type: "message.part.updated",
			properties: {
				part: {
					id: "part-123",
					sessionID: "sess-456", // CRITICAL: Part has sessionID
					messageID: "msg-789",
					type: "text",
					text: "Streaming text",
				},
			},
		}

		const result = Schema.decodeUnknownSync(MessagePartUpdatedEvent)(input)

		expect(result.type).toBe("message.part.updated")
		expect(result.properties.part.id).toBe("part-123")
		expect(result.properties.part.sessionID).toBe("sess-456")
		expect(result.properties.part.messageID).toBe("msg-789")
	})

	it("MessagePartUpdatedEvent includes optional delta", () => {
		const input = {
			type: "message.part.updated",
			properties: {
				part: {
					id: "part-123",
					sessionID: "sess-456",
					messageID: "msg-789",
					type: "text",
					text: "Hello",
				},
				delta: " world",
			},
		}

		const result = Schema.decodeUnknownSync(MessagePartUpdatedEvent)(input)

		expect(result.properties.delta).toBe(" world")
	})

	it("MessagePartRemovedEvent has sessionID, messageID, partID", () => {
		const input = {
			type: "message.part.removed",
			properties: {
				sessionID: "sess-123",
				messageID: "msg-456",
				partID: "part-789",
			},
		}

		const result = Schema.decodeUnknownSync(MessagePartRemovedEvent)(input)

		expect(result.type).toBe("message.part.removed")
		expect(result.properties.sessionID).toBe("sess-123")
		expect(result.properties.messageID).toBe("msg-456")
		expect(result.properties.partID).toBe("part-789")
	})
})

describe("SSEEvent Union", () => {
	it("discriminates session.created", () => {
		const input = {
			type: "session.created",
			properties: {
				info: {
					id: "sess-123",
					title: "Test",
					directory: "/test",
					time: { created: 123, updated: 123 },
				},
			},
		}

		const result = Schema.decodeUnknownSync(SSEEvent)(input)

		expect(result.type).toBe("session.created")
	})

	it("discriminates message.part.updated", () => {
		const input = {
			type: "message.part.updated",
			properties: {
				part: {
					id: "part-1",
					sessionID: "sess-1",
					messageID: "msg-1",
					type: "text",
					text: "Hello",
				},
			},
		}

		const result = Schema.decodeUnknownSync(SSEEvent)(input)

		expect(result.type).toBe("message.part.updated")
	})

	it("rejects unknown event types", () => {
		const input = {
			type: "unknown.event",
			properties: {},
		}

		expect(() => Schema.decodeUnknownSync(SSEEvent)(input)).toThrow()
	})
})
