/**
 * SSE Event Parser Tests
 */

import { describe, it, expect } from "vitest"
import { Either } from "effect"
import { parseSSEEvent, parseSSEEventSync } from "./parse.js"

describe("parseSSEEvent", () => {
	it("parses valid session.created event", () => {
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

		const result = parseSSEEvent(input)

		expect(Either.isRight(result)).toBe(true)
		if (Either.isRight(result)) {
			expect(result.right.type).toBe("session.created")
		}
	})

	it("parses valid message.part.updated event", () => {
		const input = {
			type: "message.part.updated",
			properties: {
				part: {
					id: "part-123",
					sessionID: "sess-456",
					messageID: "msg-789",
					type: "text",
					text: "Hello world",
				},
			},
		}

		const result = parseSSEEvent(input)

		expect(Either.isRight(result)).toBe(true)
		if (Either.isRight(result)) {
			expect(result.right.type).toBe("message.part.updated")
			if (result.right.type === "message.part.updated") {
				expect(result.right.properties.part.sessionID).toBe("sess-456")
			}
		}
	})

	it("returns Left for invalid event type", () => {
		const input = {
			type: "unknown.event",
			properties: {},
		}

		const result = parseSSEEvent(input)

		expect(Either.isLeft(result)).toBe(true)
	})

	it("returns Left for missing required fields", () => {
		const input = {
			type: "session.created",
			properties: {
				// Missing info
			},
		}

		const result = parseSSEEvent(input)

		expect(Either.isLeft(result)).toBe(true)
	})
})

describe("parseSSEEventSync", () => {
	it("parses valid event", () => {
		const input = {
			type: "session.status",
			properties: {
				sessionID: "sess-123",
				status: { type: "idle" },
			},
		}

		const result = parseSSEEventSync(input)

		expect(result.type).toBe("session.status")
	})

	it("throws on invalid event", () => {
		const input = {
			type: "unknown.event",
			properties: {},
		}

		expect(() => parseSSEEventSync(input)).toThrow()
	})
})
