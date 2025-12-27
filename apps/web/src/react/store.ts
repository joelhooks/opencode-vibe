/**
 * Zustand store for OpenCode state management
 *
 * Uses Immer middleware for immutable updates and Binary utilities
 * for O(log n) session/message operations on sorted arrays.
 *
 * Arrays are sorted by ID (lexicographic, ULID-compatible).
 */

import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { Binary } from "@/lib/binary"

/**
 * Session type matching OpenCode API
 */
export type Session = {
	id: string
	title: string
	directory: string
	parentID?: string
	time: {
		created: number
		updated: number
	}
}

/**
 * Message type matching OpenCode API
 */
export type Message = {
	id: string
	sessionID: string
	role: string
	time?: { created: number; completed?: number }
	[key: string]: unknown // Allow additional fields
}

/**
 * Store state shape
 */
type OpencodeState = {
	// Sorted by id (lexicographic)
	sessions: Session[]
	// Record of sessionID -> Message[] (each array sorted by id)
	// Using Record instead of Map to avoid Immer draft proxy issues
	messages: Record<string, Message[]>
}

/**
 * Store actions
 */
type OpencodeActions = {
	// Session operations
	addSession: (session: Session) => void
	updateSession: (id: string, updater: (draft: Session) => void) => void
	removeSession: (id: string) => void
	getSession: (id: string) => Session | undefined

	// Message operations
	addMessage: (message: Message) => void
	updateMessage: (sessionID: string, messageID: string, updater: (draft: Message) => void) => void
	removeMessage: (sessionID: string, messageID: string) => void
	getMessages: (sessionID: string) => Message[]
}

/**
 * Zustand store with Immer middleware for immutable updates
 *
 * @example
 * const store = useOpencodeStore()
 * store.addSession({ id: "session-1", title: "Test", ... })
 * const session = store.getSession("session-1")
 */
export const useOpencodeStore = create<OpencodeState & OpencodeActions>()(
	immer((set, get) => ({
		// Initial state
		sessions: [],
		messages: {},

		// Session operations
		addSession: (session) =>
			set((state) => {
				state.sessions = Binary.insert(state.sessions, session, (s) => s.id)
			}),

		updateSession: (id, updater) =>
			set((state) => {
				const result = Binary.search(state.sessions, id, (s) => s.id)
				if (result.found) {
					updater(state.sessions[result.index])
				}
			}),

		removeSession: (id) =>
			set((state) => {
				const result = Binary.search(state.sessions, id, (s) => s.id)
				if (result.found) {
					state.sessions.splice(result.index, 1)
				}
			}),

		getSession: (id) => {
			const { sessions } = get()
			const result = Binary.search(sessions, id, (s) => s.id)
			return result.found ? sessions[result.index] : undefined
		},

		// Message operations
		addMessage: (message) =>
			set((state) => {
				const { sessionID } = message
				const existing = state.messages[sessionID]
				if (existing) {
					state.messages[sessionID] = Binary.insert(existing, message, (m) => m.id)
				} else {
					state.messages[sessionID] = [message]
				}
			}),

		updateMessage: (sessionID, messageID, updater) =>
			set((state) => {
				const messages = state.messages[sessionID]
				if (!messages) return

				const result = Binary.search(messages, messageID, (m) => m.id)
				if (result.found) {
					updater(messages[result.index])
				}
			}),

		removeMessage: (sessionID, messageID) =>
			set((state) => {
				const messages = state.messages[sessionID]
				if (!messages) return

				const result = Binary.search(messages, messageID, (m) => m.id)
				if (result.found) {
					messages.splice(result.index, 1)
				}
			}),

		getMessages: (sessionID) => {
			const { messages } = get()
			return messages[sessionID] || []
		},
	})),
)
