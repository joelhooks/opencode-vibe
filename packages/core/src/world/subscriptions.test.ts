/**
 * Subscriptions Tests - TDD RED PHASE
 *
 * Tests FIRST for subscribeSession API.
 *
 * Key Requirements (from ADR-019 Phase 2):
 * - subscribeSession(sessionId, callback) function
 * - Gets or creates SessionAtom via getOrCreateSessionAtom(sessionId)
 * - Subscribes to enrichedSessionAtom
 * - Returns unsubscribe function
 * - Callback receives EnrichedSession updates
 *
 * Integration:
 * - Uses SessionAtom from session-atom.ts
 * - Uses effect-atom subscribe patterns
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { Registry } from "@effect-atom/atom"
import type { Session, Message, Part } from "../types/domain.js"
import { subscribeSession } from "./subscriptions.js"
import { clearSessionAtomRegistry, getOrCreateSessionAtom } from "./session-atom.js"

describe("subscribeSession", () => {
	let registry: Registry.Registry

	beforeEach(() => {
		registry = Registry.make()
		clearSessionAtomRegistry() // Clean up between tests
	})

	it("should subscribe to enrichedSessionAtom and call callback on updates", () => {
		const sessionId = "test-session-1"
		const callback = vi.fn()

		// Subscribe
		const unsubscribe = subscribeSession(sessionId, callback, registry)

		// Get the SessionAtom to update it
		const sessionAtom = getOrCreateSessionAtom(sessionId)

		// Update session data
		const session: Session = {
			id: sessionId,
			title: "Test Session",
			directory: "/test",
			time: { created: 1000, updated: 1000 },
		}
		registry.set(sessionAtom.sessionAtom, session)

		// Callback should be called with enriched session
		expect(callback).toHaveBeenCalled()
		const enrichedSession = callback.mock.calls[callback.mock.calls.length - 1][0]
		expect(enrichedSession).toMatchObject({
			id: sessionId,
			title: "Test Session",
			status: "completed",
			isActive: false,
		})

		unsubscribe()
	})

	it("should return unsubscribe function that stops callbacks", () => {
		const sessionId = "test-session-2"
		const callback = vi.fn()

		const unsubscribe = subscribeSession(sessionId, callback, registry)

		// Get the SessionAtom
		const sessionAtom = getOrCreateSessionAtom(sessionId)

		// First update
		registry.set(sessionAtom.sessionAtom, {
			id: sessionId,
			title: "Session 1",
			directory: "/test",
			time: { created: 1000, updated: 1000 },
		})

		const callCountBefore = callback.mock.calls.length

		// Unsubscribe
		unsubscribe()

		// Second update after unsubscribe
		registry.set(sessionAtom.sessionAtom, {
			id: sessionId,
			title: "Session 2",
			directory: "/test",
			time: { created: 2000, updated: 2000 },
		})

		// Callback should not be called after unsubscribe
		expect(callback.mock.calls.length).toBe(callCountBefore)
	})

	it("should subscribe to existing SessionAtom if already created", () => {
		const sessionId = "test-session-3"

		// Pre-create SessionAtom and set data
		const sessionAtom = getOrCreateSessionAtom(sessionId)
		registry.set(sessionAtom.sessionAtom, {
			id: sessionId,
			title: "Pre-existing",
			directory: "/test",
			time: { created: 1000, updated: 1000 },
		})

		// Now subscribe
		const callback = vi.fn()
		const unsubscribe = subscribeSession(sessionId, callback, registry)

		// Callback should be called immediately with current enriched state
		expect(callback).toHaveBeenCalled()
		const enrichedSession = callback.mock.calls[0][0]
		expect(enrichedSession).toMatchObject({
			id: sessionId,
			title: "Pre-existing",
		})

		unsubscribe()
	})

	it("should handle updates to messages and parts in enriched session", () => {
		const sessionId = "test-session-4"
		const callback = vi.fn()

		const unsubscribe = subscribeSession(sessionId, callback, registry)

		const sessionAtom = getOrCreateSessionAtom(sessionId)

		// Set session, messages, and parts
		const session: Session = {
			id: sessionId,
			title: "Test",
			directory: "/test",
			time: { created: 1000, updated: 1000 },
		}
		const messages: Message[] = [
			{
				id: "msg-1",
				sessionID: sessionId,
				role: "user",
				time: { created: 1500 },
			},
		]
		const parts: Part[] = [
			{
				id: "part-1",
				sessionID: sessionId,
				messageID: "msg-1",
				type: "text",
				text: "Hello",
			},
		]

		registry.set(sessionAtom.sessionAtom, session)
		registry.set(sessionAtom.messagesAtom, messages)
		registry.set(sessionAtom.partsAtom, parts)

		// Last callback should have enriched session with messages and parts
		const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0]
		expect(lastCall.messages).toHaveLength(1)
		expect(lastCall.messages[0].parts).toHaveLength(1)
		expect(lastCall.messages[0].parts[0].text).toBe("Hello")

		unsubscribe()
	})

	it("should use default registry if not provided", () => {
		const sessionId = "test-session-5"
		const callback = vi.fn()

		// Subscribe without providing registry (uses default)
		const unsubscribe = subscribeSession(sessionId, callback)

		// We can't easily update the default registry in tests,
		// but we can verify the subscription was created
		expect(callback).toHaveBeenCalled() // Initial call with empty enriched session

		unsubscribe()
	})

	it("should handle multiple subscribers to same session", () => {
		const sessionId = "test-session-6"
		const callback1 = vi.fn()
		const callback2 = vi.fn()

		const unsub1 = subscribeSession(sessionId, callback1, registry)
		const unsub2 = subscribeSession(sessionId, callback2, registry)

		const sessionAtom = getOrCreateSessionAtom(sessionId)
		registry.set(sessionAtom.sessionAtom, {
			id: sessionId,
			title: "Multi-subscriber",
			directory: "/test",
			time: { created: 1000, updated: 1000 },
		})

		// Both callbacks should be called
		expect(callback1).toHaveBeenCalled()
		expect(callback2).toHaveBeenCalled()

		unsub1()
		unsub2()
	})

	it("should call callback with initial enriched session immediately", () => {
		const sessionId = "test-session-7"
		const callback = vi.fn()

		// Subscribe should call callback immediately with current state
		subscribeSession(sessionId, callback, registry)

		// Should have been called at least once immediately
		expect(callback).toHaveBeenCalled()

		// Initial enriched session should have default values
		const initialEnriched = callback.mock.calls[0][0]
		expect(initialEnriched).toMatchObject({
			id: sessionId,
			title: "",
			status: "completed",
			isActive: false,
			messages: [],
			unreadCount: 0,
		})
	})

	it("should propagate updates from primitive atoms to enriched session", () => {
		const sessionId = "test-session-8"
		const callback = vi.fn()

		subscribeSession(sessionId, callback, registry)

		const sessionAtom = getOrCreateSessionAtom(sessionId)

		// Clear initial call
		callback.mockClear()

		// Update primitive atom
		registry.set(sessionAtom.sessionAtom, {
			id: sessionId,
			title: "Updated Title",
			directory: "/test",
			time: { created: 1000, updated: 2000 },
		})

		// Callback should be called with updated enriched session
		expect(callback).toHaveBeenCalled()
		const updated = callback.mock.calls[callback.mock.calls.length - 1][0]
		expect(updated.title).toBe("Updated Title")
		expect(updated.time.updated).toBe(2000)
	})

	describe("Edge Cases", () => {
		it("should handle rapid subscribe/unsubscribe cycles without errors", () => {
			const sessionId = "test-edge-1"
			const callback = vi.fn()

			// Rapid subscribe/unsubscribe 10 times
			for (let i = 0; i < 10; i++) {
				const unsub = subscribeSession(sessionId, callback, registry)
				unsub()
			}

			// Should not throw and callback should have been called at least 10 times
			// (Could be more due to atom invalidation during subscription setup)
			expect(callback.mock.calls.length).toBeGreaterThanOrEqual(10)
		})

		it("should handle subscription to non-existent session (creates SessionAtom)", () => {
			const sessionId = "never-existed"
			const callback = vi.fn()

			// Subscribe before any session data exists
			const unsub = subscribeSession(sessionId, callback, registry)

			// Should create SessionAtom and call callback with default enriched session
			expect(callback).toHaveBeenCalled()
			const initialEnriched = callback.mock.calls[0][0]
			expect(initialEnriched).toMatchObject({
				id: sessionId,
				title: "",
				status: "completed",
				isActive: false,
				messages: [],
				unreadCount: 0,
			})

			unsub()
		})

		it("should allow multiple subscriptions to same session independently", () => {
			const sessionId = "test-edge-2"
			const callback1 = vi.fn()
			const callback2 = vi.fn()
			const callback3 = vi.fn()

			// Create 3 independent subscriptions
			const unsub1 = subscribeSession(sessionId, callback1, registry)
			const unsub2 = subscribeSession(sessionId, callback2, registry)
			const unsub3 = subscribeSession(sessionId, callback3, registry)

			// Update session
			const sessionAtom = getOrCreateSessionAtom(sessionId)
			registry.set(sessionAtom.sessionAtom, {
				id: sessionId,
				title: "Broadcast",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})

			// All 3 callbacks should receive the update
			expect(callback1).toHaveBeenCalled()
			expect(callback2).toHaveBeenCalled()
			expect(callback3).toHaveBeenCalled()

			// Unsubscribe one
			unsub1()

			// Update again
			registry.set(sessionAtom.sessionAtom, {
				id: sessionId,
				title: "After unsub1",
				directory: "/test",
				time: { created: 1000, updated: 2000 },
			})

			// Only callback2 and callback3 should receive update
			const calls1Before = callback1.mock.calls.length
			expect(callback2.mock.calls.length).toBeGreaterThan(1)
			expect(callback3.mock.calls.length).toBeGreaterThan(1)
			expect(callback1.mock.calls.length).toBe(calls1Before) // No new calls

			unsub2()
			unsub3()
		})

		it("should not leak memory when subscribing/unsubscribing repeatedly", () => {
			const sessionId = "test-edge-3"

			// Track callbacks and their initial call counts
			const callbacks: Array<{ fn: ReturnType<typeof vi.fn>; initialCalls: number }> = []

			// Subscribe and unsubscribe 100 times
			for (let i = 0; i < 100; i++) {
				const callback = vi.fn()
				const unsub = subscribeSession(sessionId, callback, registry)
				const initialCalls = callback.mock.calls.length
				unsub()
				callbacks.push({ fn: callback, initialCalls })
			}

			// Update session after all unsubscribes
			const sessionAtom = getOrCreateSessionAtom(sessionId)
			registry.set(sessionAtom.sessionAtom, {
				id: sessionId,
				title: "After cleanup",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})

			// None of the old callbacks should be called after unsubscribe
			for (const { fn, initialCalls } of callbacks) {
				// Call count should not increase after unsubscribe
				expect(fn.mock.calls.length).toBe(initialCalls)
			}
		})
	})

	describe("Integration with SessionAtom", () => {
		it("should receive correct EnrichedSession structure from enrichedSessionAtom", () => {
			const sessionId = "test-integration-1"
			const callback = vi.fn()

			subscribeSession(sessionId, callback, registry)

			const sessionAtom = getOrCreateSessionAtom(sessionId)

			// Set full session data with messages and parts
			const session: Session = {
				id: sessionId,
				title: "Integration Test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			}
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: sessionId,
					role: "user",
					time: { created: 1500 },
				},
				{
					id: "msg-2",
					sessionID: sessionId,
					role: "assistant",
					time: { created: 2000 },
				},
			]
			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: sessionId,
					messageID: "msg-1",
					type: "text",
					text: "User message",
				},
				{
					id: "part-2",
					sessionID: sessionId,
					messageID: "msg-2",
					type: "text",
					text: "Assistant response",
				},
			]

			registry.set(sessionAtom.sessionAtom, session)
			registry.set(sessionAtom.messagesAtom, messages)
			registry.set(sessionAtom.partsAtom, parts)

			// Get last enriched session from callback
			const enriched = callback.mock.calls[callback.mock.calls.length - 1][0]

			// Verify EnrichedSession structure
			expect(enriched).toMatchObject({
				id: sessionId,
				title: "Integration Test",
				directory: "/test",
				status: "completed",
				isActive: false,
			})

			// Verify messages are enriched with parts
			expect(enriched.messages).toHaveLength(2)
			expect(enriched.messages[0]).toMatchObject({
				id: "msg-1",
				role: "user",
				parts: [expect.objectContaining({ text: "User message" })],
				isStreaming: false,
			})
			expect(enriched.messages[1]).toMatchObject({
				id: "msg-2",
				role: "assistant",
				parts: [expect.objectContaining({ text: "Assistant response" })],
				// Assistant message without completed time is streaming
				isStreaming: true,
			})

			// Verify computed fields
			expect(enriched.unreadCount).toBe(0)
			expect(enriched.contextUsagePercent).toBe(0)
			expect(enriched.lastActivityAt).toBeGreaterThan(0)
		})

		it("should propagate updates through enrichedSessionAtom when primitive atoms change", () => {
			const sessionId = "test-integration-2"
			const callback = vi.fn()

			subscribeSession(sessionId, callback, registry)

			const sessionAtom = getOrCreateSessionAtom(sessionId)

			// Clear initial call
			callback.mockClear()

			// Update session atom
			registry.set(sessionAtom.sessionAtom, {
				id: sessionId,
				title: "Step 1",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})

			expect(callback).toHaveBeenCalled()
			let enriched = callback.mock.calls[callback.mock.calls.length - 1][0]
			expect(enriched.title).toBe("Step 1")

			// Update messages atom
			registry.set(sessionAtom.messagesAtom, [
				{
					id: "msg-1",
					sessionID: sessionId,
					role: "user",
					time: { created: 1500 },
				},
			])

			enriched = callback.mock.calls[callback.mock.calls.length - 1][0]
			expect(enriched.messages).toHaveLength(1)

			// Update parts atom
			registry.set(sessionAtom.partsAtom, [
				{
					id: "part-1",
					sessionID: sessionId,
					messageID: "msg-1",
					type: "text",
					text: "New part",
				},
			])

			enriched = callback.mock.calls[callback.mock.calls.length - 1][0]
			expect(enriched.messages[0].parts).toHaveLength(1)
			expect(enriched.messages[0].parts[0].text).toBe("New part")
		})

		it("should detect streaming messages correctly in enriched session", () => {
			const sessionId = "test-integration-3"
			const callback = vi.fn()

			subscribeSession(sessionId, callback, registry)

			const sessionAtom = getOrCreateSessionAtom(sessionId)

			// Add assistant message without completed time (streaming)
			registry.set(sessionAtom.sessionAtom, {
				id: sessionId,
				title: "Streaming test",
				directory: "/test",
				time: { created: 1000, updated: 1000 },
			})

			registry.set(sessionAtom.messagesAtom, [
				{
					id: "msg-1",
					sessionID: sessionId,
					role: "assistant",
					time: { created: 1500 }, // No completed time
				},
			])

			let enriched = callback.mock.calls[callback.mock.calls.length - 1][0]
			expect(enriched.messages[0].isStreaming).toBe(true)

			// Complete the message
			registry.set(sessionAtom.messagesAtom, [
				{
					id: "msg-1",
					sessionID: sessionId,
					role: "assistant",
					time: { created: 1500, completed: 2000 }, // Now completed
				},
			])

			enriched = callback.mock.calls[callback.mock.calls.length - 1][0]
			expect(enriched.messages[0].isStreaming).toBe(false)
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid sessionId gracefully (creates SessionAtom anyway)", () => {
			// SessionAtom creation doesn't validate sessionId format
			const invalidIds = ["", " ", "123", "test-!@#$", "x".repeat(1000)]

			for (const sessionId of invalidIds) {
				const callback = vi.fn()
				const unsub = subscribeSession(sessionId, callback, registry)

				// Should not throw
				expect(callback).toHaveBeenCalled()

				// Should create enriched session with the given ID
				const enriched = callback.mock.calls[0][0]
				expect(enriched.id).toBe(sessionId)

				unsub()
			}
		})

		it("should handle callback errors gracefully (effect-atom propagates errors)", () => {
			const sessionId = "test-error-1"
			let callCount = 0

			const throwingCallback = vi.fn(() => {
				callCount++
				if (callCount === 1) {
					throw new Error("Callback error")
				}
			})

			// Subscribe with callback that throws on first call
			// Note: effect-atom propagates errors from callbacks, they're not swallowed
			let errorThrown = false
			try {
				subscribeSession(sessionId, throwingCallback, registry)
			} catch (error) {
				errorThrown = true
				expect((error as Error).message).toBe("Callback error")
			}

			expect(errorThrown).toBe(true)
			expect(callCount).toBe(1)

			// This is expected behavior - callbacks should not throw
			// In production, wrap callback in try-catch if error handling is needed
		})

		it("should handle concurrent updates without race conditions", () => {
			const sessionId = "test-error-2"
			const callback = vi.fn()

			subscribeSession(sessionId, callback, registry)

			const sessionAtom = getOrCreateSessionAtom(sessionId)

			// Rapid concurrent updates
			for (let i = 0; i < 50; i++) {
				registry.set(sessionAtom.sessionAtom, {
					id: sessionId,
					title: `Update ${i}`,
					directory: "/test",
					time: { created: 1000, updated: 1000 + i },
				})
			}

			// All updates should propagate
			expect(callback.mock.calls.length).toBeGreaterThan(50) // Initial + 50 updates
			const lastEnriched = callback.mock.calls[callback.mock.calls.length - 1][0]
			expect(lastEnriched.title).toBe("Update 49")
		})
	})
})
