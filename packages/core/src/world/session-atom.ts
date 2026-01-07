/**
 * Session Atoms - ADR-019 Phase 2: SessionAtom Tier
 *
 * Per-session atoms for granular subscriptions.
 * Components can subscribe to exactly what they need.
 *
 * Key Design:
 * - SessionAtom contains 5 atoms per session
 * - Session atoms use idleTTL (auto-cleanup when idle)
 * - Derived atoms use keepAlive (always available)
 * - Lazy creation via getOrCreateSessionAtom()
 * - Registry tracks active sessions
 */

import { Atom } from "@effect-atom/atom"
import { Duration } from "effect"
import type { Message, Part, Session } from "../types/domain.js"
import type { SessionStatus } from "../types/events.js"
import type { EnrichedMessage, EnrichedSession } from "./types.js"

/**
 * SessionAtom - Collection of atoms for a single session
 *
 * Contains both primitive atoms (with idleTTL) and derived atoms (with keepAlive).
 * Primitive atoms are writable, derived atoms are read-only.
 */
export interface SessionAtom {
	/** Session data atom - with idleTTL for auto-cleanup */
	sessionAtom: ReturnType<typeof Atom.make<Session | null>>

	/** Messages for this session - with idleTTL */
	messagesAtom: ReturnType<typeof Atom.make<Message[]>>

	/** Parts for this session - with idleTTL */
	partsAtom: ReturnType<typeof Atom.make<Part[]>>

	/** Derived status from session state - with keepAlive (read-only) */
	statusAtom: Atom.Atom<SessionStatus>

	/** Derived enriched session with computed fields - with keepAlive (read-only) */
	enrichedSessionAtom: Atom.Atom<EnrichedSession>
}

/**
 * Global registry of SessionAtom instances
 * Maps sessionId → SessionAtom
 */
export const sessionAtomRegistry = new Map<string, SessionAtom>()

/**
 * Get or create SessionAtom for a session ID
 *
 * Lazily creates SessionAtom on first access.
 * Reuses existing instance for subsequent calls.
 *
 * @param sessionId - Unique session identifier
 * @returns SessionAtom instance
 */
export function getOrCreateSessionAtom(sessionId: string): SessionAtom {
	// Check if already exists
	const existing = sessionAtomRegistry.get(sessionId)
	if (existing) {
		return existing
	}

	// Create new SessionAtom
	const sessionAtom = createSessionAtom(sessionId)

	// Store in registry
	sessionAtomRegistry.set(sessionId, sessionAtom)

	return sessionAtom
}

/**
 * Clear session atom registry
 * Used for testing cleanup
 */
export function clearSessionAtomRegistry(): void {
	sessionAtomRegistry.clear()
}

/**
 * Create SessionAtom for a session
 *
 * Primitive atoms (session, messages, parts) have idleTTL for auto-cleanup.
 * Derived atoms (status, enriched) have keepAlive for always-available reads.
 */
function createSessionAtom(sessionId: string): SessionAtom {
	// Primitive atoms with idleTTL (5 minutes)
	const sessionAtom = Atom.make<Session | null>(null).pipe(Atom.setIdleTTL(Duration.minutes(5)))

	const messagesAtom = Atom.make<Message[]>([]).pipe(Atom.setIdleTTL(Duration.minutes(5)))

	const partsAtom = Atom.make<Part[]>([]).pipe(Atom.setIdleTTL(Duration.minutes(5)))

	// Derived atom: status from session state
	const statusAtom = Atom.make((get): SessionStatus => {
		const session = get(sessionAtom)
		if (!session) {
			return "completed" // Default status when no session
		}
		// For now, always return "completed" (status will be set separately)
		// TODO: In future, status might be stored in Session itself
		return "completed"
	}).pipe(Atom.keepAlive)

	// Derived atom: enriched session with computed fields
	const enrichedSessionAtom = Atom.make((get): EnrichedSession => {
		const session = get(sessionAtom)
		const messages = get(messagesAtom)
		const parts = get(partsAtom)
		const status = get(statusAtom)

		// If no session, return minimal enriched session
		if (!session) {
			return {
				id: sessionId,
				title: "",
				directory: "",
				time: { created: 0, updated: 0 },
				status: "completed",
				isActive: false,
				messages: [],
				unreadCount: 0,
				contextUsagePercent: 0,
				lastActivityAt: 0,
			}
		}

		// Build message ID → parts map
		const partsByMessage = new Map<string, Part[]>()
		for (const part of parts) {
			const existing = partsByMessage.get(part.messageID) ?? []
			existing.push(part)
			partsByMessage.set(part.messageID, existing)
		}

		// Enrich messages with parts and isStreaming
		const enrichedMessages: EnrichedMessage[] = messages.map((msg) => {
			const msgParts = partsByMessage.get(msg.id) ?? []
			return {
				...msg,
				parts: msgParts,
				// Message is streaming if it's assistant role and has no completed time
				isStreaming: msg.role === "assistant" && !msg.time?.completed,
			}
		})

		// Compute last activity
		const lastMessageTime =
			enrichedMessages.length > 0
				? Math.max(...enrichedMessages.map((m) => m.time?.created ?? 0))
				: 0
		const lastActivityAt = Math.max(lastMessageTime, session.time.updated)

		// Determine if session is active
		const isActive = status === "running"

		return {
			...session,
			status,
			isActive,
			messages: enrichedMessages,
			unreadCount: 0, // TODO: implement unread tracking
			contextUsagePercent: 0, // TODO: compute from message tokens
			lastActivityAt,
		}
	}).pipe(Atom.keepAlive)

	return {
		sessionAtom,
		messagesAtom,
		partsAtom,
		statusAtom,
		enrichedSessionAtom,
	}
}
