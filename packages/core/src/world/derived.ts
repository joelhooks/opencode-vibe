/**
 * Derived World Atom - ADR-018 Reactive World Stream
 *
 * Creates enriched world state by deriving from base atoms.
 * Uses effect-atom's Atom.make((get) => ...) for automatic dependency tracking.
 *
 * This is the TDD migration from WorldStore.deriveWorldState to effect-atom.
 */

import { Atom } from "@effect-atom/atom"
import type { Part } from "../types/domain.js"
import type { EnrichedMessage, EnrichedSession, WorldState } from "./types.js"
import {
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	connectionStatusAtom,
	instancesAtom,
	projectsAtom,
	sessionToInstancePortAtom,
} from "./atoms.js"
import type { Instance } from "./types.js"

// Re-export base atoms for consumers that need them
export {
	sessionsAtom,
	messagesAtom,
	partsAtom,
	statusAtom,
	connectionStatusAtom,
	instancesAtom,
	projectsAtom,
	sessionToInstancePortAtom,
}

/**
 * Derived world atom with enrichment logic
 *
 * Automatically recomputes when any base atom changes.
 * Implements the same enrichment logic as WorldStore.deriveWorldState.
 *
 * NOTE: atoms.ts now exports Map-based atoms. We convert to arrays here for iteration.
 */
export const worldAtom = Atom.make((get) => {
	const sessions = Array.from(get(sessionsAtom).values())
	const messages = Array.from(get(messagesAtom).values())
	const parts = Array.from(get(partsAtom).values())
	const status = get(statusAtom)
	const connectionStatus = get(connectionStatusAtom)
	const instances = Array.from(get(instancesAtom).values())
	const projects = Array.from(get(projectsAtom).values())
	const sessionToInstancePort = get(sessionToInstancePortAtom)

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
		const sessionStatus = status.get(session.id) ?? "completed"
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

	// Build instance maps
	const instanceByPort = new Map<number, Instance>()
	for (const instance of instances) {
		instanceByPort.set(instance.port, instance)
	}

	const instancesByDirectory = new Map<string, Instance[]>()
	for (const instance of instances) {
		const existing = instancesByDirectory.get(instance.directory) ?? []
		existing.push(instance)
		instancesByDirectory.set(instance.directory, existing)
	}

	const connectedInstanceCount = instances.filter((i) => i.status === "connected").length

	// Build sessionToInstance map from sessionToInstancePort
	const sessionToInstance = new Map<string, Instance>()
	for (const [sessionId, port] of sessionToInstancePort.entries()) {
		const instance = instanceByPort.get(port)
		if (instance) {
			sessionToInstance.set(sessionId, instance)
		}
	}

	// Enrich projects with instances and sessions
	const enrichedProjects = projects.map((project) => {
		const projectInstances = instancesByDirectory.get(project.worktree) ?? []
		const projectSessions = byDirectory.get(project.worktree) ?? []

		const activeInstanceCount = projectInstances.filter((i) => i.status === "connected").length
		const sessionCount = projectSessions.length
		const projectActiveSessionCount = projectSessions.filter((s) => s.isActive).length

		const lastActivityAt =
			projectSessions.length > 0 ? Math.max(...projectSessions.map((s) => s.lastActivityAt)) : 0

		return {
			...project,
			instances: projectInstances,
			activeInstanceCount,
			sessions: projectSessions,
			sessionCount,
			activeSessionCount: projectActiveSessionCount,
			lastActivityAt,
		}
	})

	const projectByDirectory = new Map<string, (typeof enrichedProjects)[0]>()
	for (const project of enrichedProjects) {
		projectByDirectory.set(project.worktree, project)
	}

	const worldState: WorldState = {
		sessions: enrichedSessions,
		activeSessionCount,
		activeSession,
		connectionStatus,
		lastUpdated: Date.now(),
		byDirectory,
		stats,
		instances, // Already converted to array above
		instanceByPort,
		instancesByDirectory,
		connectedInstanceCount,
		projects: enrichedProjects,
		projectByDirectory,
		sessionToInstance,
	}

	return worldState
})
