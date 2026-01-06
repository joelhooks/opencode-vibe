/**
 * Event Router Tests - TDD RED PHASE
 *
 * Tests FIRST, implementation SECOND.
 * This verifies the event router correctly routes SSE events to World Stream atoms.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Registry } from "@effect-atom/atom"
import {
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	sessionToInstancePortAtom,
	instancesAtom,
} from "./atoms.js"
import { routeEvent } from "./event-router.js"
import type { SSEEvent } from "../sse/schemas.js"
import type { Session, Message, Part } from "../types/domain.js"

describe("Event Router", () => {
	let registry: Registry.Registry

	beforeEach(() => {
		registry = Registry.make()
	})

	describe("session.created", () => {
		it("should add session to sessionsAtom", () => {
			const event: SSEEvent = {
				type: "session.created",
				properties: {
					info: {
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const sessions = registry.get(sessionsAtom)
			expect(sessions.size).toBe(1)
			expect(sessions.get("session-1")).toMatchObject({
				id: "session-1",
				title: "Test Session",
				directory: "/test",
			})
		})

		it("should map session to instance port", () => {
			// Setup: add an instance
			const instances = new Map([
				[
					3000,
					{
						port: 3000,
						pid: 123,
						directory: "/test",
						status: "connected" as const,
						baseUrl: "http://localhost:3000",
						lastSeen: Date.now(),
					},
				],
			])
			registry.set(instancesAtom, instances)

			const event: SSEEvent = {
				type: "session.created",
				properties: {
					info: {
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const mapping = registry.get(sessionToInstancePortAtom)
			expect(mapping.get("session-1")).toBe(3000)
		})
	})

	describe("session.updated", () => {
		it("should update existing session", () => {
			// Setup: existing session
			const existingSessions = new Map<string, Session>([
				[
					"session-1",
					{
						id: "session-1",
						title: "Old Title",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					} as Session,
				],
			])
			registry.set(sessionsAtom, existingSessions)

			const event: SSEEvent = {
				type: "session.updated",
				properties: {
					info: {
						id: "session-1",
						title: "New Title",
						directory: "/test",
						time: { created: 1000, updated: 2000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const sessions = registry.get(sessionsAtom)
			expect(sessions.get("session-1")?.title).toBe("New Title")
			expect((sessions.get("session-1") as any).time.updated).toBe(2000)
		})
	})

	describe("session.deleted", () => {
		it("should remove session from sessionsAtom", () => {
			// Setup: existing session
			const existingSessions = new Map<string, Session>([
				[
					"session-1",
					{
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					} as Session,
				],
			])
			registry.set(sessionsAtom, existingSessions)

			const event: SSEEvent = {
				type: "session.deleted",
				properties: {
					info: {
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const sessions = registry.get(sessionsAtom)
			expect(sessions.size).toBe(0)
		})

		it("should remove session-to-instance mapping", () => {
			// Setup: session with mapping
			const existingSessions = new Map<string, Session>([
				[
					"session-1",
					{
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					} as Session,
				],
			])
			const existingMapping = new Map([["session-1", 3000]])
			registry.set(sessionsAtom, existingSessions)
			registry.set(sessionToInstancePortAtom, existingMapping)

			const event: SSEEvent = {
				type: "session.deleted",
				properties: {
					info: {
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const mapping = registry.get(sessionToInstancePortAtom)
			expect(mapping.size).toBe(0)
		})
	})

	describe("message.updated", () => {
		it("should add message to messagesAtom", () => {
			const event: SSEEvent = {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "user",
						time: { created: 1000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const messages = registry.get(messagesAtom)
			expect(messages.size).toBe(1)
			expect(messages.get("msg-1")).toMatchObject({
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			})
		})

		it("should mark session as running when message event received", () => {
			const event: SSEEvent = {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "user",
						time: { created: 1000 },
					},
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("running")
		})
	})

	describe("message.part.updated", () => {
		it("should add part to partsAtom", () => {
			const event: SSEEvent = {
				type: "message.part.updated",
				properties: {
					part: {
						id: "part-1",
						sessionID: "session-1",
						messageID: "msg-1",
						type: "text",
						text: "Hello",
					},
				},
			}

			routeEvent(event, registry, 3000)

			const parts = registry.get(partsAtom)
			expect(parts.size).toBe(1)
			expect(parts.get("part-1")).toMatchObject({
				id: "part-1",
				sessionID: "session-1",
				messageID: "msg-1",
				type: "text",
				text: "Hello",
			})
		})

		it("should mark session as running when part event received", () => {
			const event: SSEEvent = {
				type: "message.part.updated",
				properties: {
					part: {
						id: "part-1",
						sessionID: "session-1",
						messageID: "msg-1",
						type: "text",
						text: "Hello",
					},
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("running")
		})
	})

	describe("session.status", () => {
		it("should update status for idle", () => {
			const event: SSEEvent = {
				type: "session.status",
				properties: {
					sessionID: "session-1",
					status: { type: "idle" },
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("idle")
		})

		it("should update status for busy", () => {
			const event: SSEEvent = {
				type: "session.status",
				properties: {
					sessionID: "session-1",
					status: { type: "busy" },
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("running")
		})

		it("should update status for retry", () => {
			const event: SSEEvent = {
				type: "session.status",
				properties: {
					sessionID: "session-1",
					status: { type: "retry", attempt: 1, message: "Retrying", next: 2000 },
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("running")
		})
	})

	describe("session.idle", () => {
		it("should mark session as idle", () => {
			const event: SSEEvent = {
				type: "session.idle",
				properties: {
					sessionID: "session-1",
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("idle")
		})
	})

	describe("session.error", () => {
		it("should mark session as error", () => {
			const event: SSEEvent = {
				type: "session.error",
				properties: {
					sessionID: "session-1",
					error: { message: "Something failed" },
				},
			}

			routeEvent(event, registry, 3000)

			const statuses = registry.get(statusAtom)
			expect(statuses.get("session-1")).toBe("error")
		})

		it("should handle missing sessionID", () => {
			const event: SSEEvent = {
				type: "session.error",
				properties: {
					error: { message: "Global error" },
				},
			}

			// Should not throw
			expect(() => routeEvent(event, registry, 3000)).not.toThrow()
		})
	})

	describe("message.removed", () => {
		it("should remove message from messagesAtom", () => {
			// Setup: existing message
			const existingMessages = new Map<string, Message>([
				[
					"msg-1",
					{
						id: "msg-1",
						sessionID: "session-1",
						role: "user",
						time: { created: 1000 },
					} as Message,
				],
			])
			registry.set(messagesAtom, existingMessages)

			const event: SSEEvent = {
				type: "message.removed",
				properties: {
					sessionID: "session-1",
					messageID: "msg-1",
				},
			}

			routeEvent(event, registry, 3000)

			const messages = registry.get(messagesAtom)
			expect(messages.size).toBe(0)
		})
	})

	describe("message.part.removed", () => {
		it("should remove part from partsAtom", () => {
			// Setup: existing part
			const existingParts = new Map<string, Part>([
				[
					"part-1",
					{
						id: "part-1",
						sessionID: "session-1",
						messageID: "msg-1",
						type: "text",
						text: "Hello",
					} as Part,
				],
			])
			registry.set(partsAtom, existingParts)

			const event: SSEEvent = {
				type: "message.part.removed",
				properties: {
					sessionID: "session-1",
					messageID: "msg-1",
					partID: "part-1",
				},
			}

			routeEvent(event, registry, 3000)

			const parts = registry.get(partsAtom)
			expect(parts.size).toBe(0)
		})
	})

	describe("session.compacted", () => {
		it("should not throw on compaction events", () => {
			const event: SSEEvent = {
				type: "session.compacted",
				properties: {
					sessionID: "session-1",
				},
			}

			// Should not throw - compaction events are just logged
			expect(() => routeEvent(event, registry, 3000)).not.toThrow()
		})
	})

	describe("session.diff", () => {
		it("should not throw on diff events", () => {
			const event: SSEEvent = {
				type: "session.diff",
				properties: {
					sessionID: "session-1",
					diff: [],
				},
			}

			// Should not throw - diff events are just logged
			expect(() => routeEvent(event, registry, 3000)).not.toThrow()
		})
	})

	describe("unknown event types", () => {
		it("should handle unknown event types gracefully without throwing", () => {
			// Simulate an unknown event type that might come from the backend
			// (e.g., "lsp.client.diagnostics")
			const unknownEvent = {
				type: "lsp.client.diagnostics",
				properties: {
					uri: "file:///test.ts",
					diagnostics: [],
				},
			}

			// This should NOT throw - unknown events should be silently ignored
			// or logged at debug level, but not break the event flow
			expect(() => routeEvent(unknownEvent as any, registry, 3000)).not.toThrow()
		})

		it("should allow subsequent valid events to process after unknown event", () => {
			// First: unknown event
			const unknownEvent = {
				type: "some.unknown.event",
				properties: { data: "test" },
			}
			routeEvent(unknownEvent as any, registry, 3000)

			// Second: valid event should still work
			const validEvent: SSEEvent = {
				type: "session.created",
				properties: {
					info: {
						id: "session-1",
						title: "Test Session",
						directory: "/test",
						time: { created: 1000, updated: 1000 },
					},
				},
			}
			routeEvent(validEvent, registry, 3000)

			// Valid event should have been processed
			const sessions = registry.get(sessionsAtom)
			expect(sessions.size).toBe(1)
			expect(sessions.get("session-1")?.title).toBe("Test Session")
		})
	})

	describe("sessionId filtering", () => {
		it("should store messages from different sessions in messagesAtom", () => {
			// Add message for session-1
			const msg1Event: SSEEvent = {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "user",
						time: { created: 1000 },
					},
				},
			}
			routeEvent(msg1Event, registry, 3000)

			// Add message for session-2
			const msg2Event: SSEEvent = {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-2",
						sessionID: "session-2",
						role: "assistant",
						time: { created: 2000 },
					},
				},
			}
			routeEvent(msg2Event, registry, 3000)

			// Both messages should be in messagesAtom
			const messages = registry.get(messagesAtom)
			expect(messages.size).toBe(2)

			// Verify each message has correct sessionID
			const msg1 = messages.get("msg-1")
			expect(msg1?.sessionID).toBe("session-1")
			expect(msg1?.role).toBe("user")

			const msg2 = messages.get("msg-2")
			expect(msg2?.sessionID).toBe("session-2")
			expect(msg2?.role).toBe("assistant")
		})

		it("should store parts from different sessions in partsAtom", () => {
			// Add part for session-1
			const part1Event: SSEEvent = {
				type: "message.part.updated",
				properties: {
					part: {
						id: "part-1",
						sessionID: "session-1",
						messageID: "msg-1",
						type: "text",
						text: "Hello from session 1",
					},
				},
			}
			routeEvent(part1Event, registry, 3000)

			// Add part for session-2
			const part2Event: SSEEvent = {
				type: "message.part.updated",
				properties: {
					part: {
						id: "part-2",
						sessionID: "session-2",
						messageID: "msg-2",
						type: "text",
						text: "Hello from session 2",
					},
				},
			}
			routeEvent(part2Event, registry, 3000)

			// Both parts should be in partsAtom
			const parts = registry.get(partsAtom)
			expect(parts.size).toBe(2)

			// Verify each part has correct sessionID
			const part1 = parts.get("part-1")
			expect(part1?.sessionID).toBe("session-1")
			expect(part1?.type).toBe("text")
			if (part1?.type === "text") {
				expect(part1.text).toBe("Hello from session 1")
			}

			const part2 = parts.get("part-2")
			expect(part2?.sessionID).toBe("session-2")
			expect(part2?.type).toBe("text")
			if (part2?.type === "text") {
				expect(part2.text).toBe("Hello from session 2")
			}
		})

		it("should allow filtering messages by sessionID from messagesAtom", () => {
			// Setup: Add multiple messages for different sessions
			const events: SSEEvent[] = [
				{
					type: "message.updated",
					properties: {
						info: {
							id: "msg-1",
							sessionID: "session-1",
							role: "user",
							time: { created: 1000 },
						},
					},
				},
				{
					type: "message.updated",
					properties: {
						info: {
							id: "msg-2",
							sessionID: "session-1",
							role: "assistant",
							time: { created: 2000 },
						},
					},
				},
				{
					type: "message.updated",
					properties: {
						info: {
							id: "msg-3",
							sessionID: "session-2",
							role: "user",
							time: { created: 3000 },
						},
					},
				},
			]

			for (const event of events) {
				routeEvent(event, registry, 3000)
			}

			// Query messagesAtom and filter by sessionID
			const messages = registry.get(messagesAtom)
			const session1Messages = Array.from(messages.values()).filter(
				(msg) => msg.sessionID === "session-1",
			)
			const session2Messages = Array.from(messages.values()).filter(
				(msg) => msg.sessionID === "session-2",
			)

			// Verify filtering works correctly
			expect(session1Messages).toHaveLength(2)
			expect(session1Messages[0].id).toBe("msg-1")
			expect(session1Messages[1].id).toBe("msg-2")

			expect(session2Messages).toHaveLength(1)
			expect(session2Messages[0].id).toBe("msg-3")
		})

		it("should allow filtering parts by sessionID from partsAtom", () => {
			// Setup: Add multiple parts for different sessions
			const events: SSEEvent[] = [
				{
					type: "message.part.updated",
					properties: {
						part: {
							id: "part-1",
							sessionID: "session-1",
							messageID: "msg-1",
							type: "text",
							text: "Part 1",
						},
					},
				},
				{
					type: "message.part.updated",
					properties: {
						part: {
							id: "part-2",
							sessionID: "session-1",
							messageID: "msg-1",
							type: "text",
							text: "Part 2",
						},
					},
				},
				{
					type: "message.part.updated",
					properties: {
						part: {
							id: "part-3",
							sessionID: "session-2",
							messageID: "msg-2",
							type: "text",
							text: "Part 3",
						},
					},
				},
			]

			for (const event of events) {
				routeEvent(event, registry, 3000)
			}

			// Query partsAtom and filter by sessionID
			const parts = registry.get(partsAtom)
			const session1Parts = Array.from(parts.values()).filter(
				(part) => part.sessionID === "session-1",
			)
			const session2Parts = Array.from(parts.values()).filter(
				(part) => part.sessionID === "session-2",
			)

			// Verify filtering works correctly
			expect(session1Parts).toHaveLength(2)
			expect(session1Parts[0].id).toBe("part-1")
			expect(session1Parts[1].id).toBe("part-2")

			expect(session2Parts).toHaveLength(1)
			expect(session2Parts[0].id).toBe("part-3")
		})
	})
})
