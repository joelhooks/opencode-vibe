/**
 * Tests for World Stream debug utilities
 */

import { describe, test, expect } from "vitest"
import { Registry } from "@effect-atom/atom"
import { getWorldDebugStats } from "./debug"
import { messagesAtom, sessionsAtom, partsAtom, connectionStatusAtom } from "./atoms"
import type { Message, Session, Part } from "../types/domain.js"

describe("getWorldDebugStats", () => {
	test("returns zero counts for empty atoms", () => {
		const registry = Registry.make()

		const stats = getWorldDebugStats(registry)

		expect(stats.totalMessages).toBe(0)
		expect(stats.totalSessions).toBe(0)
		expect(stats.totalParts).toBe(0)
		expect(stats.connectionStatus).toBe("disconnected")
		expect(stats.messagesBySession.size).toBe(0)
	})

	test("counts messages globally", () => {
		const registry = Registry.make()

		// Add messages to atom
		const messages = new Map<string, Message>()
		messages.set("msg-1", { id: "msg-1", sessionID: "session-1" } as Message)
		messages.set("msg-2", { id: "msg-2", sessionID: "session-1" } as Message)
		messages.set("msg-3", { id: "msg-3", sessionID: "session-2" } as Message)
		registry.set(messagesAtom, messages)

		const stats = getWorldDebugStats(registry)

		expect(stats.totalMessages).toBe(3)
		expect(stats.messagesBySession.size).toBe(2)
		expect(stats.messagesBySession.get("session-1")).toBe(2)
		expect(stats.messagesBySession.get("session-2")).toBe(1)
	})

	test("counts sessions", () => {
		const registry = Registry.make()

		// Add sessions to atom
		const sessions = new Map<string, Session>()
		sessions.set("session-1", { id: "session-1" } as Session)
		sessions.set("session-2", { id: "session-2" } as Session)
		registry.set(sessionsAtom, sessions)

		const stats = getWorldDebugStats(registry)

		expect(stats.totalSessions).toBe(2)
	})

	test("counts parts", () => {
		const registry = Registry.make()

		// Add parts to atom
		const parts = new Map<string, Part>()
		parts.set("part-1", { id: "part-1", messageID: "msg-1" } as Part)
		parts.set("part-2", { id: "part-2", messageID: "msg-1" } as Part)
		parts.set("part-3", { id: "part-3", messageID: "msg-2" } as Part)
		registry.set(partsAtom, parts)

		const stats = getWorldDebugStats(registry)

		expect(stats.totalParts).toBe(3)
	})

	test("reflects connection status", () => {
		const registry = Registry.make()

		registry.set(connectionStatusAtom, "connected")

		const stats = getWorldDebugStats(registry)

		expect(stats.connectionStatus).toBe("connected")
	})

	test("groups messages by session correctly", () => {
		const registry = Registry.make()

		// Add messages across multiple sessions
		const messages = new Map<string, Message>()
		messages.set("msg-1", { id: "msg-1", sessionID: "session-a" } as Message)
		messages.set("msg-2", { id: "msg-2", sessionID: "session-a" } as Message)
		messages.set("msg-3", { id: "msg-3", sessionID: "session-a" } as Message)
		messages.set("msg-4", { id: "msg-4", sessionID: "session-b" } as Message)
		messages.set("msg-5", { id: "msg-5", sessionID: "session-c" } as Message)
		messages.set("msg-6", { id: "msg-6", sessionID: "session-c" } as Message)
		registry.set(messagesAtom, messages)

		const stats = getWorldDebugStats(registry)

		expect(stats.totalMessages).toBe(6)
		expect(stats.messagesBySession.size).toBe(3)
		expect(stats.messagesBySession.get("session-a")).toBe(3)
		expect(stats.messagesBySession.get("session-b")).toBe(1)
		expect(stats.messagesBySession.get("session-c")).toBe(2)
	})
})
