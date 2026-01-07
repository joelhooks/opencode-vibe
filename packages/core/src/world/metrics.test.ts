/**
 * Tests for atom lifecycle metrics tracking
 *
 * Verifies subscription count tracking, lifecycle events, and development logging
 */

import { describe, expect, test, beforeEach, vi, afterEach } from "vitest"
import {
	trackAtomLifecycle,
	getAtomMetrics,
	clearAtomMetrics,
	logAtomLifecycle,
	type AtomLifecycleEvent,
} from "./metrics"

describe("atom lifecycle metrics", () => {
	beforeEach(() => {
		clearAtomMetrics()
	})

	test("tracks atom creation", () => {
		const event: AtomLifecycleEvent = {
			atomId: "sessionsAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		}

		trackAtomLifecycle(event)

		const metrics = getAtomMetrics()
		expect(metrics).toHaveLength(1)
		expect(metrics[0]).toMatchObject({
			atomId: "sessionsAtom",
			tier: "session",
			subscriptionCount: 0,
		})
	})

	test("tracks subscription count changes", () => {
		// Create atom
		trackAtomLifecycle({
			atomId: "messagesAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		// Subscribe
		trackAtomLifecycle({
			atomId: "messagesAtom",
			tier: "session",
			event: "subscribed",
			subscriptionCount: 1,
			timestamp: new Date(),
		})

		const metrics = getAtomMetrics()
		expect(metrics[0]?.subscriptionCount).toBe(1)

		// Unsubscribe
		trackAtomLifecycle({
			atomId: "messagesAtom",
			tier: "session",
			event: "unsubscribed",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		const updatedMetrics = getAtomMetrics()
		expect(updatedMetrics[0]?.subscriptionCount).toBe(0)
	})

	test("tracks multiple subscriptions", () => {
		trackAtomLifecycle({
			atomId: "partsAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		// First subscription
		trackAtomLifecycle({
			atomId: "partsAtom",
			tier: "session",
			event: "subscribed",
			subscriptionCount: 1,
			timestamp: new Date(),
		})

		// Second subscription
		trackAtomLifecycle({
			atomId: "partsAtom",
			tier: "session",
			event: "subscribed",
			subscriptionCount: 2,
			timestamp: new Date(),
		})

		const metrics = getAtomMetrics()
		expect(metrics[0]?.subscriptionCount).toBe(2)
	})

	test("tracks atom disposal", () => {
		trackAtomLifecycle({
			atomId: "statusAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		trackAtomLifecycle({
			atomId: "statusAtom",
			tier: "session",
			event: "disposed",
			subscriptionCount: 0,
			timestamp: new Date(),
			reason: "idle_ttl",
		})

		const metrics = getAtomMetrics()
		expect(metrics).toHaveLength(0) // Disposed atom removed from registry
	})

	test("tracks multiple atoms by tier", () => {
		// Session tier atoms
		trackAtomLifecycle({
			atomId: "sessionsAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		trackAtomLifecycle({
			atomId: "messagesAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		// Global tier atoms
		trackAtomLifecycle({
			atomId: "worldStateAtom",
			tier: "global",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		const metrics = getAtomMetrics()
		expect(metrics).toHaveLength(3)

		const sessionAtoms = metrics.filter((m) => m.tier === "session")
		const globalAtoms = metrics.filter((m) => m.tier === "global")

		expect(sessionAtoms).toHaveLength(2)
		expect(globalAtoms).toHaveLength(1)
	})

	test("updates lastAccessedAt on subscription events", () => {
		const createdAt = new Date("2026-01-01T00:00:00Z")
		const accessedAt = new Date("2026-01-01T00:01:00Z")

		trackAtomLifecycle({
			atomId: "connectionStatusAtom",
			tier: "global",
			event: "created",
			subscriptionCount: 0,
			timestamp: createdAt,
		})

		trackAtomLifecycle({
			atomId: "connectionStatusAtom",
			tier: "global",
			event: "subscribed",
			subscriptionCount: 1,
			timestamp: accessedAt,
		})

		const metrics = getAtomMetrics()
		expect(metrics[0]?.createdAt).toEqual(createdAt)
		expect(metrics[0]?.lastAccessedAt).toEqual(accessedAt)
	})

	test("clearAtomMetrics resets registry", () => {
		trackAtomLifecycle({
			atomId: "testAtom",
			tier: "session",
			event: "created",
			subscriptionCount: 0,
			timestamp: new Date(),
		})

		expect(getAtomMetrics()).toHaveLength(1)

		clearAtomMetrics()

		expect(getAtomMetrics()).toHaveLength(0)
	})
})

describe("logAtomLifecycle", () => {
	let originalEnv: string | undefined

	beforeEach(() => {
		originalEnv = process.env.NODE_ENV
	})

	afterEach(() => {
		process.env.NODE_ENV = originalEnv
		vi.restoreAllMocks()
	})

	test("logs atom lifecycle events without error", () => {
		process.env.NODE_ENV = "development"

		const event: AtomLifecycleEvent = {
			atomId: "sessionsAtom",
			tier: "session",
			event: "subscribed",
			subscriptionCount: 1,
			timestamp: new Date(),
		}

		// Just verify the function runs without throwing
		expect(() => logAtomLifecycle(event)).not.toThrow()
	})

	test("formats disposal with reason without error", () => {
		process.env.NODE_ENV = "development"

		const event: AtomLifecycleEvent = {
			atomId: "statusAtom",
			tier: "session",
			event: "disposed",
			subscriptionCount: 0,
			timestamp: new Date(),
			reason: "idle_ttl",
		}

		// Just verify the function runs without throwing
		expect(() => logAtomLifecycle(event)).not.toThrow()
	})
})
