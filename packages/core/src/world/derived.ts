/**
 * Derived World Atom - ADR-018 Reactive World Stream
 *
 * Creates enriched world state by deriving from base atoms.
 * Uses effect-atom's Atom.make((get) => ...) for automatic dependency tracking.
 *
 * This is the TDD migration from WorldStore.deriveWorldState to effect-atom.
 */

import { Atom } from "@effect-atom/atom"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import type { EnrichedMessage, EnrichedSession, WorldState } from "./types.js"
import {
	sessionsAtom as sessionsMapAtom,
	messagesAtom as messagesMapAtom,
	partsAtom as partsMapAtom,
	statusAtom as statusMapAtom,
	connectionStatusAtom,
} from "./atoms.js"

/**
 * Array/Record-based derived atoms for enrichment logic
 *
 * These convert Map-based atoms from atoms.ts to arrays/records for simpler iteration.
 * The Map-based atoms in atoms.ts are canonical (single source of truth) and optimized for O(1) SSE updates.
 * These derived atoms provide array/record views for the enrichment layer.
 */

/**
 * Sessions as array (derived from Map)
 */
export const sessionsAtom = Atom.make((get) => Array.from(get(sessionsMapAtom).values()))

/**
 * Messages as array (derived from Map, flattened from Map<sessionID, Message[]>)
 */
export const messagesAtom = Atom.make((get) => {
	const messagesMap = get(messagesMapAtom)
	const allMessages: Message[] = []
	for (const sessionMessages of messagesMap.values()) {
		allMessages.push(...sessionMessages)
	}
	return allMessages
})

/**
 * Parts as array (derived from Map, flattened from Map<messageID, Part[]>)
 */
export const partsAtom = Atom.make((get) => {
	const partsMap = get(partsMapAtom)
	const allParts: Part[] = []
	for (const messageParts of partsMap.values()) {
		allParts.push(...messageParts)
	}
	return allParts
})

/**
 * Status as record (derived from Map)
 */
export const statusAtom = Atom.make((get) => {
	const statusMap = get(statusMapAtom)
	const record: Record<string, SessionStatus> = {}
	for (const [sessionId, status] of statusMap.entries()) {
		record[sessionId] = status
	}
	return record
})

// Re-export connectionStatusAtom directly (it's already a primitive atom)
export { connectionStatusAtom }

/**
 * Derived world atom with enrichment logic
 *
 * Automatically recomputes when any base atom changes.
 * Implements the same enrichment logic as WorldStore.deriveWorldState.
 */
export const worldAtom = Atom.make((get) => {
	const sessions = get(sessionsAtom)
	const messages = get(messagesAtom)
	const parts = get(partsAtom)
	const status = get(statusAtom)
	const connectionStatus = get(connectionStatusAtom)

	// Build message ID -> parts map
	const partsByMessage = new Map<string, Part[]>()
	for (const part of parts) {
		const existing = partsByMessage.get(part.messageID) ?? []
		existing.push(part)
		partsByMessage.set(part.messageID, existing)
	}

	// Build session ID -> enriched messages map
	const messagesBySession = new Map<string, EnrichedMessage[]>()
	for (const msg of messages) {
		const msgParts = partsByMessage.get(msg.id) ?? []
		const enrichedMsg: EnrichedMessage = {
			...msg,
			parts: msgParts,
			// Message is streaming if it's assistant role and has no completed time
			isStreaming: msg.role === "assistant" && !msg.time?.completed,
		}

		const existing = messagesBySession.get(msg.sessionID) ?? []
		existing.push(enrichedMsg)
		messagesBySession.set(msg.sessionID, existing)
	}

	// Build enriched sessions
	const enrichedSessions: EnrichedSession[] = sessions.map((session) => {
		const sessionMessages = messagesBySession.get(session.id) ?? []
		const sessionStatus = status[session.id] ?? "completed"
		const isActive = sessionStatus === "running"

		// Last activity is most recent message or session update
		const lastMessageTime =
			sessionMessages.length > 0 ? Math.max(...sessionMessages.map((m) => m.time?.created ?? 0)) : 0
		const lastActivityAt = Math.max(lastMessageTime, session.time.updated)

		// Context usage percent - compute from last assistant message tokens
		// Total tokens = input + output + reasoning + cache.read + cache.write
		let contextUsagePercent = 0
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role === "assistant" && msg.tokens && msg.model?.limits?.context) {
				const totalTokens =
					msg.tokens.input +
					msg.tokens.output +
					(msg.tokens.reasoning ?? 0) +
					(msg.tokens.cache?.read ?? 0) +
					(msg.tokens.cache?.write ?? 0)
				contextUsagePercent = (totalTokens / msg.model.limits.context) * 100
				break
			}
		}

		return {
			...session,
			status: sessionStatus,
			isActive,
			messages: sessionMessages,
			unreadCount: 0, // TODO: implement unread tracking
			contextUsagePercent,
			lastActivityAt,
		}
	})

	// Sort sessions by last activity (most recent first)
	enrichedSessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)

	// Active session is the most recently active one
	const activeSession = enrichedSessions.find((s) => s.isActive) ?? enrichedSessions[0] ?? null
	const activeSessionCount = enrichedSessions.filter((s) => s.isActive).length

	// Group sessions by directory
	const byDirectory = new Map<string, EnrichedSession[]>()
	for (const session of enrichedSessions) {
		const existing = byDirectory.get(session.directory) ?? []
		existing.push(session)
		byDirectory.set(session.directory, existing)
	}

	// Compute stats
	const stats = {
		total: enrichedSessions.length,
		active: activeSessionCount,
		streaming: enrichedSessions.filter((s) => s.messages.some((m) => m.isStreaming)).length,
	}

	const worldState: WorldState = {
		sessions: enrichedSessions,
		activeSessionCount,
		activeSession,
		connectionStatus,
		lastUpdated: Date.now(),
		byDirectory,
		stats,
	}

	return worldState
})
