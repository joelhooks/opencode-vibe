/**
 * Event Router - Routes SSE events to World Stream atoms
 *
 * Pure function that takes an SSEEvent and updates the appropriate atoms.
 * Extracted from WorldSSE.handleEvent() for testability and reusability.
 *
 * Pattern: Parse at boundary (sse.ts), route here (event-router.ts), consume everywhere.
 *
 * Also provides synthetic event factories for bootstrap data.
 * Bootstrap can create fake SSE events from REST API data and feed them through routeEvent().
 */

import type { Registry } from "@effect-atom/atom"
import {
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	sessionToInstancePortAtom,
	instancesAtom,
} from "./atoms.js"
import type { SSEEvent } from "../sse/schemas.js"
import type { SessionStatus } from "../types/events.js"
import type { Session, Message, Part } from "../types/domain.js"
import type { BackendSessionStatus } from "../types/sessions.js"

/**
 * Route an SSE event to the appropriate atom
 *
 * @param event - Parsed SSE event (already validated via Effect Schema)
 * @param registry - Atom registry to update
 * @param sourcePort - Port of the instance that sent the event (for session-to-instance mapping)
 */
export function routeEvent(event: SSEEvent, registry: Registry.Registry, sourcePort: number): void {
	// TypeScript discriminates based on event.type
	switch (event.type) {
		case "session.created":
		case "session.updated": {
			// SessionInfo from schema IS Session domain type (type alias)
			const session = event.properties.info as Session
			// Upsert session in sessionsAtom (Map)
			const sessions = registry.get(sessionsAtom)
			const updated = new Map(sessions)
			updated.set(session.id, session)
			registry.set(sessionsAtom, updated)

			// Map session to instance for routing
			const instances = registry.get(instancesAtom)
			const instance = instances.get(sourcePort)
			if (instance) {
				const mapping = registry.get(sessionToInstancePortAtom)
				const updatedMapping = new Map(mapping)
				updatedMapping.set(session.id, instance.port)
				registry.set(sessionToInstancePortAtom, updatedMapping)
			}

			break
		}

		case "session.deleted": {
			const session = event.properties.info as Session
			// Remove session from sessionsAtom
			const sessions = registry.get(sessionsAtom)
			const updated = new Map(sessions)
			updated.delete(session.id)
			registry.set(sessionsAtom, updated)

			// Remove session-to-instance mapping
			const mapping = registry.get(sessionToInstancePortAtom)
			const updatedMapping = new Map(mapping)
			updatedMapping.delete(session.id)
			registry.set(sessionToInstancePortAtom, updatedMapping)

			break
		}

		case "message.updated": {
			// MessageInfo from schema has `model: unknown`, Message domain type has typed model
			// Safe cast: Runtime structure is compatible, types differ for static analysis
			const message = event.properties.info as any as Message
			// Upsert message in messagesAtom (Map)
			const messages = registry.get(messagesAtom)
			const updated = new Map(messages)
			updated.set(message.id, message)
			registry.set(messagesAtom, updated)

			// CRITICAL: Receiving message events = session is active
			// Mark as "running" since we're getting live data
			const sessionId = message.sessionID
			if (sessionId) {
				const statuses = registry.get(statusAtom)
				const updatedStatuses = new Map(statuses)
				updatedStatuses.set(sessionId, "running")
				registry.set(statusAtom, updatedStatuses)

				// Map session to instance
				const instances = registry.get(instancesAtom)
				const instance = instances.get(sourcePort)
				if (instance) {
					const mapping = registry.get(sessionToInstancePortAtom)
					const updatedMapping = new Map(mapping)
					updatedMapping.set(sessionId, instance.port)
					registry.set(sessionToInstancePortAtom, updatedMapping)
				}
			}

			break
		}

		case "message.removed": {
			const { messageID } = event.properties
			// Remove message from messagesAtom
			const messages = registry.get(messagesAtom)
			const updated = new Map(messages)
			updated.delete(messageID)
			registry.set(messagesAtom, updated)

			break
		}

		case "message.part.updated": {
			// Part from schema IS the Part domain type (type alias: Part = SSEPart)
			const partData = event.properties.part as Part

			// Upsert part in partsAtom (Map)
			const parts = registry.get(partsAtom)
			const updated = new Map(parts)
			updated.set(partData.id, partData)
			registry.set(partsAtom, updated)

			// CRITICAL: part.sessionID is available directly - NO message lookup!
			// This is the key insight from mem-b8ab15188f533bf4
			const sessionId = partData.sessionID

			if (sessionId) {
				// CRITICAL: Receiving part events = session is DEFINITELY running
				// This is a STRONG SIGNAL - we're getting live streaming content
				const statuses = registry.get(statusAtom)
				const updatedStatuses = new Map(statuses)
				updatedStatuses.set(sessionId, "running")
				registry.set(statusAtom, updatedStatuses)

				// Map session to instance
				const instances = registry.get(instancesAtom)
				const instance = instances.get(sourcePort)
				if (instance) {
					const mapping = registry.get(sessionToInstancePortAtom)
					const updatedMapping = new Map(mapping)
					updatedMapping.set(sessionId, instance.port)
					registry.set(sessionToInstancePortAtom, updatedMapping)
				}
			}

			break
		}

		case "message.part.removed": {
			const { partID } = event.properties
			// Remove part from partsAtom
			const parts = registry.get(partsAtom)
			const updated = new Map(parts)
			updated.delete(partID)
			registry.set(partsAtom, updated)

			break
		}

		case "session.status": {
			const { sessionID, status } = event.properties

			// Convert backend SessionStatus object to string union
			// TODO: Update statusAtom to use SessionStatus schema object
			let statusString: SessionStatus
			if (status.type === "idle") {
				statusString = "idle"
			} else if (status.type === "busy") {
				statusString = "running"
			} else {
				statusString = "running" // retry = running
			}

			// Update status in statusAtom (Map)
			const statuses = registry.get(statusAtom)
			const updated = new Map(statuses)
			updated.set(sessionID, statusString)
			registry.set(statusAtom, updated)

			// Map session to instance for status events too
			const instances = registry.get(instancesAtom)
			const instance = instances.get(sourcePort)
			if (instance) {
				const mapping = registry.get(sessionToInstancePortAtom)
				const updatedMapping = new Map(mapping)
				updatedMapping.set(sessionID, instance.port)
				registry.set(sessionToInstancePortAtom, updatedMapping)
			}

			break
		}

		case "session.idle": {
			const { sessionID } = event.properties

			// Update status to idle
			const statuses = registry.get(statusAtom)
			const updated = new Map(statuses)
			updated.set(sessionID, "idle")
			registry.set(statusAtom, updated)

			break
		}

		case "session.compacted": {
			// Compaction complete - could trigger re-fetch if needed
			// TODO: Implement compaction handling
			break
		}

		case "session.error": {
			const { sessionID, error } = event.properties

			if (sessionID) {
				// Update status to error
				const statuses = registry.get(statusAtom)
				const updated = new Map(statuses)
				updated.set(sessionID, "error")
				registry.set(statusAtom, updated)
			}

			break
		}

		case "session.diff": {
			// File diff event - could be used for live file change tracking
			// TODO: Implement diff tracking in World Stream
			break
		}

		default: {
			// Unknown event type - silently ignore
			// TODO: Log these to help identify missing event handlers
			break
		}
	}
}

// ============================================================================
// Synthetic Event Factories
// ============================================================================

/**
 * Bootstrap Event Ordering
 *
 * CRITICAL: Status events must be applied LAST during bootstrap.
 *
 * Why: Message and part events set status to "running" (strong signal from live data).
 * If status events are applied first, they get overwritten by subsequent message/part events.
 *
 * Correct order:
 * 1. Sessions (session.created)
 * 2. Messages (message.updated)
 * 3. Parts (message.part.updated)
 * 4. Status (session.status) - LAST to reflect true state
 *
 * Example:
 * ```ts
 * const sessionEvents = createSessionEvents(sessions)
 * const messageEvents = createMessageEvents(messages)
 * const partEvents = createPartEvents(parts)
 * const statusEvents = createStatusEvents(statusMap)
 *
 * for (const event of [...sessionEvents, ...messageEvents, ...partEvents, ...statusEvents]) {
 *   routeEvent(event, registry, sourcePort)
 * }
 * ```
 */

/**
 * Create synthetic session.created events from bootstrap data
 *
 * Bootstrap fetches sessions from /session endpoint.
 * This converts them to SSE events so bootstrap can use routeEvent() instead of direct registry.set().
 *
 * @param sessions - Array of sessions from REST API
 * @returns Array of synthetic SSE events
 */
export function createSessionEvents(sessions: Session[]): SSEEvent[] {
	return sessions.map((session) => ({
		type: "session.created" as const,
		properties: {
			info: session,
		},
	}))
}

/**
 * Create synthetic session.status events from bootstrap status map
 *
 * Bootstrap fetches status from /session/status endpoint.
 * Backend returns Map<sessionId, BackendSessionStatus>.
 * This converts to SSE events matching session.status schema.
 *
 * @param statusMap - Map of session IDs to backend status objects
 * @returns Array of synthetic SSE events
 */
export function createStatusEvents(statusMap: Record<string, BackendSessionStatus>): SSEEvent[] {
	return Object.entries(statusMap).map(([sessionID, status]) => ({
		type: "session.status" as const,
		properties: {
			sessionID,
			status,
		},
	}))
}

/**
 * Create synthetic message.updated events from bootstrap data
 *
 * Bootstrap fetches messages from /session/{id}/message endpoint.
 * This converts them to SSE events so bootstrap can use routeEvent().
 *
 * @param messages - Array of messages from REST API
 * @returns Array of synthetic SSE events
 */
export function createMessageEvents(messages: Message[]): SSEEvent[] {
	return messages.map((message) => ({
		type: "message.updated" as const,
		properties: {
			info: message,
		},
	}))
}

/**
 * Create synthetic message.part.updated events from bootstrap data
 *
 * Bootstrap fetches parts from /session/{id}/message/{messageId}/part endpoint.
 * This converts them to SSE events so bootstrap can use routeEvent().
 *
 * CRITICAL: Part events have nested structure: properties.part
 * Not flat like other events.
 *
 * @param parts - Array of parts from REST API
 * @returns Array of synthetic SSE events
 */
export function createPartEvents(parts: Part[]): SSEEvent[] {
	return parts.map((part) => ({
		type: "message.part.updated" as const,
		properties: {
			part,
			// delta is optional - only present during live streaming
			// Bootstrap data doesn't have deltas
		},
	}))
}

/**
 * TECH DEBT: No event schema exists for project data
 *
 * Bootstrap fetches project from /project/current endpoint and stores in projectsAtom.
 * However, there is NO SSE event type for projects in the schema.
 *
 * Options:
 * 1. Create new event type: project.updated (requires backend changes)
 * 2. Leave as direct registry.set() (current approach)
 * 3. Create synthetic event with custom type (breaks schema validation)
 *
 * Decision: Document as tech debt. Project data is relatively static (rarely changes).
 * Direct mutation is acceptable until we have proper project.updated events.
 *
 * TODO: Add project.updated event to backend SSE schema
 * TODO: Update sse/schemas.ts with ProjectUpdatedEvent
 * TODO: Create createProjectEvents() factory
 */
