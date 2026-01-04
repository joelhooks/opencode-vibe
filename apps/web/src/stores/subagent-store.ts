/**
 * @deprecated This Zustand store is deprecated. Use `atoms/subagents.ts` instead.
 *
 * Zustand store for subagent state management
 *
 * Manages child agent sessions spawned via Task tool, tracking their messages,
 * parts, status, and UI expansion state.
 *
 * Migration: Replace `useSubagentStore()` with `useSubagents()` from `@/atoms/subagents`
 */

import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { enableMapSet } from "immer"
import type { Message, Part } from "@/app/hooks"

// Enable Immer MapSet plugin for Set support
enableMapSet()

/**
 * Subagent session state
 */
export interface SubagentSession {
	id: string
	parentSessionId: string
	parentPartId: string // The Task tool part that spawned this
	agentName: string
	status: "running" | "completed" | "error"
	messages: Message[]
	parts: Record<string, Part[]> // By message ID
}

/**
 * Subagent store state and actions
 */
interface SubagentState {
	// Map of child session ID -> subagent data
	sessions: Record<string, SubagentSession>

	// Map of parent part ID -> child session ID (for quick lookup)
	partToSession: Record<string, string>

	// Expanded state for UI
	expanded: Set<string> // Set of expanded part IDs

	// Actions
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
	isExpanded: (partId: string) => boolean

	getByParentPart: (partId: string) => SubagentSession | undefined
}

/**
 * Zustand store with Immer middleware for subagent management
 *
 * @example
 * const store = useSubagentStore()
 * store.registerSubagent("child-123", "parent-456", "part-789", "TestAgent")
 * store.addMessage("child-123", message)
 */
export const useSubagentStore = create<SubagentState>()(
	immer((set, get) => ({
		sessions: {},
		partToSession: {},
		expanded: new Set(),

		registerSubagent: (childSessionId, parentSessionId, parentPartId, agentName) =>
			set((state) => {
				state.sessions[childSessionId] = {
					id: childSessionId,
					parentSessionId,
					parentPartId,
					agentName,
					status: "running",
					messages: [],
					parts: {},
				}
				if (parentPartId) {
					state.partToSession[parentPartId] = childSessionId
					// Auto-expand running subagents so users can see activity
					state.expanded.add(parentPartId)
				}
			}),

		updateParentPartId: (childSessionId, parentPartId) =>
			set((state) => {
				const session = state.sessions[childSessionId]
				if (session) {
					session.parentPartId = parentPartId
					state.partToSession[parentPartId] = childSessionId
					// Auto-expand when we learn the parentPartId (subagent is running)
					if (session.status === "running") {
						state.expanded.add(parentPartId)
					}
				}
			}),

		addMessage: (sessionId, message) =>
			set((state) => {
				const session = state.sessions[sessionId]
				if (session) {
					session.messages.push(message)
					session.parts[message.id] = []
				}
			}),

		updateMessage: (sessionId, message) =>
			set((state) => {
				const session = state.sessions[sessionId]
				if (session) {
					const idx = session.messages.findIndex((m: any) => m.id === message.id)
					if (idx !== -1) {
						session.messages[idx] = message
					}
				}
			}),

		addPart: (sessionId, messageId, part) =>
			set((state) => {
				const session = state.sessions[sessionId]
				if (session) {
					if (!session.parts[messageId]) {
						session.parts[messageId] = []
					}
					session.parts[messageId].push(part)
				}
			}),

		updatePart: (sessionId, messageId, part) =>
			set((state) => {
				const session = state.sessions[sessionId]
				if (session && session.parts[messageId]) {
					const idx = session.parts[messageId].findIndex((p: any) => p.id === part.id)
					if (idx !== -1) {
						session.parts[messageId][idx] = part
					}
				}
			}),

		setStatus: (sessionId, status) =>
			set((state) => {
				const session = state.sessions[sessionId]
				if (session) {
					session.status = status
				}
			}),

		toggleExpanded: (partId) =>
			set((state) => {
				if (state.expanded.has(partId)) {
					state.expanded.delete(partId)
				} else {
					state.expanded.add(partId)
				}
			}),

		isExpanded: (partId) => get().expanded.has(partId),

		getByParentPart: (partId) => {
			const sessionId = get().partToSession[partId]
			return sessionId ? get().sessions[sessionId] : undefined
		},
	})),
)
