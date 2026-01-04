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
})
