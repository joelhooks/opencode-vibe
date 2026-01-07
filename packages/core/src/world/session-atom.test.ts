/**
 * SessionAtom Tests - TDD RED PHASE
 *
 * Tests FIRST, implementation SECOND.
 * This verifies per-session atoms for granular subscriptions.
 *
 * Key Requirements (from ADR-019 Phase 2):
 * - SessionAtom type with 5 atoms per session
 * - sessionAtomRegistry for lazy creation
 * - Session atoms use idleTTL (from Phase 1)
 * - Registry tracks active sessions
 *
 * GOTCHA: effect-atom idleTTL + vitest fake timers don't interact correctly.
 * Use real timers or verify behavior without advancing time.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { Registry } from "@effect-atom/atom"
import { Duration } from "effect"
import type { Session, Message, Part } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import {
	type SessionAtom,
	getOrCreateSessionAtom,
	sessionAtomRegistry,
	clearSessionAtomRegistry,
} from "./session-atom.js"

describe("SessionAtom", () => {
	let registry: Registry.Registry

	beforeEach(() => {
		registry = Registry.make()
		clearSessionAtomRegistry() // Clean up between tests
	})

	describe("SessionAtom type structure", () => {
		it("should have sessionAtom with idleTTL", () => {
			const sessionAtom = getOrCreateSessionAtom("test-session-1")

			// Can subscribe and update
			const callback = vi.fn()
			const unsub = registry.subscribe(sessionAtom.sessionAtom, callback)

			const session: Session = {
				id: "test-session-1",
				title: "Test Session",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			}

			registry.set(sessionAtom.sessionAtom, session)
			expect(registry.get(sessionAtom.sessionAtom)).toEqual(session)
			expect(callback).toHaveBeenCalled()

			unsub()
		})

		it("should have messagesAtom with idleTTL", () => {
			const sessionAtom = getOrCreateSessionAtom("test-session-2")

			const callback = vi.fn()
			const unsub = registry.subscribe(sessionAtom.messagesAtom, callback)

			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "test-session-2",
					role: "user",
					time: { created: 1000 },
				},
			]

			registry.set(sessionAtom.messagesAtom, messages)
			expect(registry.get(sessionAtom.messagesAtom)).toEqual(messages)
			expect(callback).toHaveBeenCalled()

			unsub()
		})

		it("should have partsAtom with idleTTL", () => {
			const sessionAtom = getOrCreateSessionAtom("test-session-3")

			const callback = vi.fn()
			const unsub = registry.subscribe(sessionAtom.partsAtom, callback)

			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: "test-session-3",
					messageID: "msg-1",
					type: "text",
					text: "Hello",
				},
			]

			registry.set(sessionAtom.partsAtom, parts)
			expect(registry.get(sessionAtom.partsAtom)).toEqual(parts)
			expect(callback).toHaveBeenCalled()

			unsub()
		})

		it("should have statusAtom derived from session state", () => {
			const sessionAtom = getOrCreateSessionAtom("test-session-4")

			const callback = vi.fn()
			const unsub = registry.subscribe(sessionAtom.statusAtom, callback)

			// Set session with no status - should default to "completed"
			const session: Session = {
				id: "test-session-4",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			}
			registry.set(sessionAtom.sessionAtom, session)

			// statusAtom should derive "completed" as default
			expect(registry.get(sessionAtom.statusAtom)).toBe("completed")

			unsub()
		})

		it("should have enrichedSessionAtom derived from session + computed fields", () => {
			const sessionAtom = getOrCreateSessionAtom("test-session-5")

			const callback = vi.fn()
			const unsub = registry.subscribe(sessionAtom.enrichedSessionAtom, callback)

			// Set base data
			const session: Session = {
				id: "test-session-5",
				title: "Test Enriched",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			}
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "test-session-5",
					role: "user",
					time: { created: 1500 },
				},
			]

			registry.set(sessionAtom.sessionAtom, session)
			registry.set(sessionAtom.messagesAtom, messages)

			// enrichedSessionAtom should combine session + messages
			const enriched = registry.get(sessionAtom.enrichedSessionAtom)
			expect(enriched).toMatchObject({
				id: "test-session-5",
				title: "Test Enriched",
				status: "completed",
				isActive: false,
				messages: expect.any(Array),
				unreadCount: 0,
				contextUsagePercent: 0,
			})

			unsub()
		})
	})

	describe("sessionAtomRegistry", () => {
		it("should lazily create SessionAtom on first access", () => {
			const atom1 = getOrCreateSessionAtom("session-lazy-1")
			const atom2 = getOrCreateSessionAtom("session-lazy-1") // Same ID

			// Should return same instance
			expect(atom1).toBe(atom2)
		})

		it("should create different SessionAtom instances for different session IDs", () => {
			const atom1 = getOrCreateSessionAtom("session-a")
			const atom2 = getOrCreateSessionAtom("session-b")

			// Different instances
			expect(atom1).not.toBe(atom2)
		})

		it("should track active sessions in registry", () => {
			getOrCreateSessionAtom("session-track-1")
			getOrCreateSessionAtom("session-track-2")
			getOrCreateSessionAtom("session-track-3")

			// Registry should have 3 entries
			expect(sessionAtomRegistry.size).toBe(3)
			expect(sessionAtomRegistry.has("session-track-1")).toBe(true)
			expect(sessionAtomRegistry.has("session-track-2")).toBe(true)
			expect(sessionAtomRegistry.has("session-track-3")).toBe(true)
		})
	})

	describe("idleTTL behavior", () => {
		it("session atoms should have idleTTL configured", () => {
			const sessionAtom = getOrCreateSessionAtom("session-ttl-1")

			// These atoms should allow subscription/update without manual keepAlive
			const unsub1 = registry.subscribe(sessionAtom.sessionAtom, () => {})
			const unsub2 = registry.subscribe(sessionAtom.messagesAtom, () => {})
			const unsub3 = registry.subscribe(sessionAtom.partsAtom, () => {})

			// Update values while subscribed
			registry.set(sessionAtom.sessionAtom, {
				id: "session-ttl-1",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})
			registry.set(sessionAtom.messagesAtom, [])
			registry.set(sessionAtom.partsAtom, [])

			// Values persist
			expect(registry.get(sessionAtom.sessionAtom)).toBeTruthy()
			expect(registry.get(sessionAtom.messagesAtom)).toEqual([])
			expect(registry.get(sessionAtom.partsAtom)).toEqual([])

			// Cleanup
			unsub1()
			unsub2()
			unsub3()
		})

		it("derived atoms (status, enriched) should have keepAlive", () => {
			const sessionAtom = getOrCreateSessionAtom("session-keepalive-1")

			// Set base data
			registry.set(sessionAtom.sessionAtom, {
				id: "session-keepalive-1",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})

			// Can read derived atoms without subscription (keepAlive)
			const status = registry.get(sessionAtom.statusAtom)
			const enriched = registry.get(sessionAtom.enrichedSessionAtom)

			expect(status).toBe("completed")
			expect(enriched).toMatchObject({
				id: "session-keepalive-1",
			})
		})
	})

	describe("enrichedSessionAtom computations", () => {
		it("should compute isActive from status", () => {
			const sessionAtom = getOrCreateSessionAtom("session-active-1")

			// Set session with no status
			registry.set(sessionAtom.sessionAtom, {
				id: "session-active-1",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})

			let enriched = registry.get(sessionAtom.enrichedSessionAtom)
			expect(enriched.isActive).toBe(false)
			expect(enriched.status).toBe("completed")
		})

		it("should compute lastActivityAt from messages", () => {
			const sessionAtom = getOrCreateSessionAtom("session-activity-1")

			const session: Session = {
				id: "session-activity-1",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 2000 },
			}
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "session-activity-1",
					role: "user",
					time: { created: 3000 },
				},
				{
					id: "msg-2",
					sessionID: "session-activity-1",
					role: "assistant",
					time: { created: 5000 },
				},
			]

			registry.set(sessionAtom.sessionAtom, session)
			registry.set(sessionAtom.messagesAtom, messages)

			const enriched = registry.get(sessionAtom.enrichedSessionAtom)
			// lastActivityAt should be max of session.time.updated and message times
			expect(enriched.lastActivityAt).toBe(5000)
		})

		it("should enrich messages with parts", () => {
			const sessionAtom = getOrCreateSessionAtom("session-enrich-parts-1")

			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "session-enrich-parts-1",
					role: "assistant",
					time: { created: 1000 },
				},
			]
			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: "session-enrich-parts-1",
					messageID: "msg-1",
					type: "text",
					text: "Hello",
				},
				{
					id: "part-2",
					sessionID: "session-enrich-parts-1",
					messageID: "msg-1",
					type: "text",
					text: "World",
				},
			]

			registry.set(sessionAtom.sessionAtom, {
				id: "session-enrich-parts-1",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})
			registry.set(sessionAtom.messagesAtom, messages)
			registry.set(sessionAtom.partsAtom, parts)

			const enriched = registry.get(sessionAtom.enrichedSessionAtom)
			expect(enriched.messages[0].parts).toHaveLength(2)
			expect(enriched.messages[0].parts[0].id).toBe("part-1")
			expect(enriched.messages[0].parts[1].id).toBe("part-2")
		})

		it("should compute isStreaming for messages", () => {
			const sessionAtom = getOrCreateSessionAtom("session-streaming-1")

			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "session-streaming-1",
					role: "assistant",
					time: { created: 1000 }, // No completed time = streaming
				},
				{
					id: "msg-2",
					sessionID: "session-streaming-1",
					role: "assistant",
					time: { created: 2000, completed: 2500 }, // Has completed = not streaming
				},
			]

			registry.set(sessionAtom.sessionAtom, {
				id: "session-streaming-1",
				title: "Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})
			registry.set(sessionAtom.messagesAtom, messages)

			const enriched = registry.get(sessionAtom.enrichedSessionAtom)
			expect(enriched.messages[0].isStreaming).toBe(true)
			expect(enriched.messages[1].isStreaming).toBe(false)
		})
	})
})
