/**
 * Tests for idleTTL lifecycle behavior using native effect-atom API
 *
 * Tests verify:
 * - Atom has idleTTL configured correctly
 * - New subscription with idleTTL works
 * - Multiple subscribers work with idleTTL
 * - Derived atoms work with idleTTL parent
 *
 * NOTE: effect-atom's idleTTL handles cleanup internally.
 * These tests verify the API works, not internal timer behavior.
 * Per ADR-019 Phase 1 goal: "Enable native effect-atom idleTTL without changing public API"
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { Atom, Registry } from "@effect-atom/atom"
import { Duration } from "effect"

describe("idleTTL lifecycle", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("atom with idleTTL allows subscription and value updates", () => {
		const registry = Registry.make({ defaultIdleTTL: 100 })
		const atom = Atom.make("test").pipe(Atom.setIdleTTL(Duration.millis(100)))

		const callback = vi.fn()
		const unsub = registry.subscribe(atom, callback)

		// Set value while subscribed
		registry.set(atom, "updated")
		expect(registry.get(atom)).toBe("updated")

		// Callback should fire on update
		expect(callback).toHaveBeenCalled()

		// Unsubscribe works
		unsub()
	})

	it("atom with idleTTL supports resubscription", () => {
		const registry = Registry.make()
		const atom = Atom.make("test").pipe(Atom.setIdleTTL(Duration.millis(100)))

		const unsub1 = registry.subscribe(atom, () => {})
		registry.set(atom, "updated")
		unsub1()

		// Can resubscribe after unsubscribe
		const callback2 = vi.fn()
		const unsub2 = registry.subscribe(atom, callback2)

		// Value persists between subscriptions
		expect(registry.get(atom)).toBe("updated")

		// New subscription receives updates
		registry.set(atom, "resubscribed")
		expect(callback2).toHaveBeenCalled()
		expect(registry.get(atom)).toBe("resubscribed")

		unsub2()
	})

	it("atom with idleTTL supports multiple subscribers", () => {
		const registry = Registry.make()
		const atom = Atom.make("test").pipe(Atom.setIdleTTL(Duration.millis(100)))

		registry.set(atom, "updated")

		const callback1 = vi.fn()
		const callback2 = vi.fn()
		const unsub1 = registry.subscribe(atom, callback1)
		const unsub2 = registry.subscribe(atom, callback2)

		// Both subscribers receive updates
		registry.set(atom, "broadcast")
		expect(callback1).toHaveBeenCalled()
		expect(callback2).toHaveBeenCalled()
		expect(registry.get(atom)).toBe("broadcast")

		// Can unsubscribe individually
		unsub1()
		unsub2()
	})

	it("derived atoms work with idleTTL parent", () => {
		const registry = Registry.make()

		// Create tiered atoms - parent with idleTTL, derived child
		const sessionAtom = Atom.make({ id: "s1" }).pipe(Atom.setIdleTTL(Duration.millis(100)))
		const projectAtom = Atom.make((get) => {
			// Derive from session using Atom.make with get function
			const session = get(sessionAtom)
			return { sessions: [session] }
		}).pipe(Atom.keepAlive)

		// Subscribe to both
		const sessionCallback = vi.fn()
		const projectCallback = vi.fn()
		const unsub1 = registry.subscribe(sessionAtom, sessionCallback)
		const unsub2 = registry.subscribe(projectAtom, projectCallback)

		// Update parent - this should invalidate derived atom
		registry.set(sessionAtom, { id: "s1", updated: true })

		// Parent callback fires
		expect(sessionCallback).toHaveBeenCalled()

		// Derived atom computes correctly (reads latest parent value)
		expect(registry.get(projectAtom)).toEqual({
			sessions: [{ id: "s1", updated: true }],
		})

		// Cleanup
		unsub1()
		unsub2()
	})
})
