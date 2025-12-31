/**
 * useSubagents - Promise-based subagent state management
 *
 * Wraps subagents API from @opencode-vibe/core and manages React state.
 * Provides a stateful store for subagent sessions using Promise API.
 *
 * Note: This hook uses the Promise API from @opencode-vibe/core/api which
 * wraps Effect.Ref internally but doesn't expose Effect types to React.
 *
 * @example
 * ```tsx
 * function SubagentMonitor() {
 *   const { sessions, partToSession, expanded, actions } = useSubagents()
 *
 *   // Register a subagent when Task tool spawns one
 *   const handleTaskSpawn = (childId: string, parentId: string, partId: string) => {
 *     actions.registerSubagent(childId, parentId, partId, "Explorer")
 *   }
 *
 *   // Toggle expansion state
 *   const handleToggle = (partId: string) => {
 *     actions.toggleExpanded(partId)
 *   }
 *
 *   return (
 *     <div>
 *       <h3>Subagent Sessions</h3>
 *       {Object.values(sessions).map(s => (
 *         <div key={s.id}>{s.agentName} - {s.status}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useState, useEffect, useMemo } from "react"
import {
	subagents,
	type SubagentSession,
	type SubagentState,
	type SubagentStateRef,
} from "@opencode-vibe/core/api"
import type { Message, Part } from "@opencode-vibe/core/types"

export interface UseSubagentsReturn {
	/** All subagent sessions by ID */
	sessions: Record<string, SubagentSession>
	/** Mapping from parent part ID to session ID */
	partToSession: Record<string, string>
	/** Set of expanded part IDs */
	expanded: Set<string>
	/** Imperative actions for updating subagent state */
	actions: {
		registerSubagent: (
			childSessionId: string,
			parentSessionId: string,
			parentPartId: string,
			agentName: string,
		) => void
		updateParentPartId: (childSessionId: string, parentPartId: string) => void
		addMessage: (sessionId: string, message: Message) => void
		updateMessage: (sessionId: string, message: Message) => void
		addPart: (sessionId: string, messageId: string, part: Part) => void
		updatePart: (sessionId: string, messageId: string, part: Part) => void
		setStatus: (sessionId: string, status: SubagentSession["status"]) => void
		toggleExpanded: (partId: string) => void
		getByParentPart: (partId: string) => SubagentSession | undefined
	}
}

/**
 * Hook to manage subagent sessions using Promise API from core
 *
 * Creates a state ref and exposes imperative actions for updating
 * subagent state while keeping React in sync. Uses Promise-based API
 * internally, avoiding direct Effect imports.
 *
 * @returns Object with sessions, partToSession, expanded, and actions
 */
export function useSubagents(): UseSubagentsReturn {
	const [state, setState] = useState<SubagentState>({
		sessions: {},
		partToSession: {},
		expanded: new Set(),
	})

	const [stateRef, setStateRef] = useState<SubagentStateRef | null>(null)

	// Initialize the state ref on mount
	useEffect(() => {
		subagents.create().then((ref) => {
			setStateRef(ref)
		})
	}, [])

	// Sync React state with ref whenever actions are called
	const syncState = useMemo(
		() => async () => {
			if (!stateRef) return
			const newState = await subagents.getState(stateRef)
			setState(newState)
		},
		[stateRef],
	)

	// Imperative actions that use Promise API and sync state
	const actions = useMemo(() => {
		if (!stateRef) {
			// Return no-op actions until stateRef is initialized
			return {
				registerSubagent: () => {},
				updateParentPartId: () => {},
				addMessage: () => {},
				updateMessage: () => {},
				addPart: () => {},
				updatePart: () => {},
				setStatus: () => {},
				toggleExpanded: () => {},
				getByParentPart: () => undefined,
			}
		}

		return {
			registerSubagent: (
				childSessionId: string,
				parentSessionId: string,
				parentPartId: string,
				agentName: string,
			) => {
				subagents
					.registerSubagent(stateRef, childSessionId, parentSessionId, parentPartId, agentName)
					.then(syncState)
			},
			updateParentPartId: (childSessionId: string, parentPartId: string) => {
				subagents.updateParentPartId(stateRef, childSessionId, parentPartId).then(syncState)
			},
			addMessage: (sessionId: string, message: Message) => {
				subagents.addMessage(stateRef, sessionId, message).then(syncState)
			},
			updateMessage: (sessionId: string, message: Message) => {
				subagents.updateMessage(stateRef, sessionId, message).then(syncState)
			},
			addPart: (sessionId: string, messageId: string, part: Part) => {
				subagents.addPart(stateRef, sessionId, messageId, part).then(syncState)
			},
			updatePart: (sessionId: string, messageId: string, part: Part) => {
				subagents.updatePart(stateRef, sessionId, messageId, part).then(syncState)
			},
			setStatus: (sessionId: string, status: SubagentSession["status"]) => {
				subagents.setStatus(stateRef, sessionId, status).then(syncState)
			},
			toggleExpanded: (partId: string) => {
				subagents.toggleExpanded(stateRef, partId).then(syncState)
			},
			getByParentPart: (partId: string): SubagentSession | undefined => {
				// Synchronous getter - reads from React state
				const sessionId = state.partToSession[partId]
				return sessionId ? state.sessions[sessionId] : undefined
			},
		}
	}, [stateRef, syncState, state])

	return {
		sessions: state.sessions,
		partToSession: state.partToSession,
		expanded: state.expanded,
		actions,
	}
}

// Re-export types for convenience
export type { SubagentSession, SubagentState }
