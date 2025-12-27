import { describe, expect, test, beforeEach } from "bun:test"
import { useOpencodeStore } from "./store"

/**
 * Test types matching OpenCode API responses
 */
type Session = {
	id: string
	title: string
	directory: string
	parentID?: string
	time: {
		created: number
		updated: number
	}
}

type Message = {
	id: string
	sessionID: string
	role: string
	time?: { created: number; completed?: number }
}

describe("OpencodeStore", () => {
	// Reset store before each test to avoid state leakage
	beforeEach(() => {
		useOpencodeStore.setState({
			sessions: [],
			messages: {},
		})
	})

	describe("Initial State", () => {
		test("starts with empty sessions and messages", () => {
			const store = useOpencodeStore.getState()
			expect(store.sessions).toEqual([])
			expect(Object.keys(store.messages)).toHaveLength(0)
		})
	})

	describe("Session Management", () => {
		test("addSession inserts session in sorted order", () => {
			const store = useOpencodeStore.getState()

			// Insert in non-sorted order to test binary insert
			const sessionC: Session = {
				id: "session-c",
				title: "Session C",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}
			const sessionA: Session = {
				id: "session-a",
				title: "Session A",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}
			const sessionB: Session = {
				id: "session-b",
				title: "Session B",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession(sessionC)
			store.addSession(sessionA)
			store.addSession(sessionB)

			const sessions = useOpencodeStore.getState().sessions
			expect(sessions).toHaveLength(3)
			expect(sessions[0].id).toBe("session-a")
			expect(sessions[1].id).toBe("session-b")
			expect(sessions[2].id).toBe("session-c")
		})

		test("getSession returns session by id using binary search", () => {
			const store = useOpencodeStore.getState()

			const session1: Session = {
				id: "session-1",
				title: "Session 1",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}
			const session2: Session = {
				id: "session-2",
				title: "Session 2",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession(session1)
			store.addSession(session2)

			const found = store.getSession("session-2")
			expect(found).toBeDefined()
			expect(found?.id).toBe("session-2")
			expect(found?.title).toBe("Session 2")

			const notFound = store.getSession("session-999")
			expect(notFound).toBeUndefined()
		})

		test("updateSession updates existing session", () => {
			const store = useOpencodeStore.getState()

			const session: Session = {
				id: "session-1",
				title: "Original Title",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession(session)

			const updatedTime = Date.now() + 1000
			store.updateSession("session-1", (draft) => {
				draft.title = "Updated Title"
				draft.time.updated = updatedTime
			})

			const updated = store.getSession("session-1")
			expect(updated?.title).toBe("Updated Title")
			expect(updated?.time.updated).toBe(updatedTime)
		})

		test("removeSession removes session by id", () => {
			const store = useOpencodeStore.getState()

			const session1: Session = {
				id: "session-1",
				title: "Session 1",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}
			const session2: Session = {
				id: "session-2",
				title: "Session 2",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession(session1)
			store.addSession(session2)

			store.removeSession("session-1")

			const sessions = useOpencodeStore.getState().sessions
			expect(sessions).toHaveLength(1)
			expect(sessions[0].id).toBe("session-2")
			expect(store.getSession("session-1")).toBeUndefined()
		})
	})

	describe("Message Management", () => {
		test("addMessage inserts message in sorted order for session", () => {
			const store = useOpencodeStore.getState()

			// Insert messages in non-sorted order
			const messageC: Message = {
				id: "msg-c",
				sessionID: "session-1",
				role: "user",
			}
			const messageA: Message = {
				id: "msg-a",
				sessionID: "session-1",
				role: "user",
			}
			const messageB: Message = {
				id: "msg-b",
				sessionID: "session-1",
				role: "assistant",
			}

			store.addMessage(messageC)
			store.addMessage(messageA)
			store.addMessage(messageB)

			const messages = store.getMessages("session-1")
			expect(messages).toHaveLength(3)
			expect(messages[0].id).toBe("msg-a")
			expect(messages[1].id).toBe("msg-b")
			expect(messages[2].id).toBe("msg-c")
		})

		test("getMessages returns messages for session", () => {
			const store = useOpencodeStore.getState()

			const msg1: Message = {
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			}
			const msg2: Message = {
				id: "msg-2",
				sessionID: "session-1",
				role: "assistant",
			}
			const msg3: Message = {
				id: "msg-3",
				sessionID: "session-2",
				role: "user",
			}

			store.addMessage(msg1)
			store.addMessage(msg2)
			store.addMessage(msg3)

			const session1Messages = store.getMessages("session-1")
			expect(session1Messages).toHaveLength(2)
			expect(session1Messages[0].id).toBe("msg-1")
			expect(session1Messages[1].id).toBe("msg-2")

			const session2Messages = store.getMessages("session-2")
			expect(session2Messages).toHaveLength(1)
			expect(session2Messages[0].id).toBe("msg-3")

			const emptyMessages = store.getMessages("session-999")
			expect(emptyMessages).toEqual([])
		})

		test("updateMessage updates existing message", () => {
			const store = useOpencodeStore.getState()

			const message: Message = {
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			}

			store.addMessage(message)

			const completedTime = Date.now()
			store.updateMessage("session-1", "msg-1", (draft) => {
				draft.role = "assistant"
				draft.time = { created: Date.now(), completed: completedTime }
			})

			const messages = store.getMessages("session-1")
			expect(messages[0].role).toBe("assistant")
			expect(messages[0].time?.completed).toBe(completedTime)
		})

		test("removeMessage removes message by id", () => {
			const store = useOpencodeStore.getState()

			const msg1: Message = {
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			}
			const msg2: Message = {
				id: "msg-2",
				sessionID: "session-1",
				role: "assistant",
			}

			store.addMessage(msg1)
			store.addMessage(msg2)

			store.removeMessage("session-1", "msg-1")

			const messages = store.getMessages("session-1")
			expect(messages).toHaveLength(1)
			expect(messages[0].id).toBe("msg-2")
		})
	})

	describe("Binary Search Correctness", () => {
		test("handles ULID-compatible IDs (lexicographic sorting)", () => {
			const store = useOpencodeStore.getState()

			// ULIDs sort lexicographically by timestamp
			const session1: Session = {
				id: "01HX0000000000000000000000", // Earlier timestamp
				title: "First",
				directory: "/test",
				time: { created: 1, updated: 1 },
			}
			const session2: Session = {
				id: "01HX0000000000000000000001", // Later timestamp
				title: "Second",
				directory: "/test",
				time: { created: 2, updated: 2 },
			}

			store.addSession(session2)
			store.addSession(session1)

			const sessions = useOpencodeStore.getState().sessions
			expect(sessions[0].id).toBe("01HX0000000000000000000000")
			expect(sessions[1].id).toBe("01HX0000000000000000000001")
		})

		test("immutability - original arrays not modified", () => {
			const store = useOpencodeStore.getState()

			const session: Session = {
				id: "session-1",
				title: "Test",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}

			const beforeSessions = useOpencodeStore.getState().sessions
			store.addSession(session)
			const afterSessions = useOpencodeStore.getState().sessions

			// Different array references (immutable)
			expect(beforeSessions).not.toBe(afterSessions)
			expect(beforeSessions).toHaveLength(0)
			expect(afterSessions).toHaveLength(1)
		})
	})

	describe("Edge Cases", () => {
		test("handles empty arrays", () => {
			const store = useOpencodeStore.getState()

			expect(store.getSession("any-id")).toBeUndefined()
			expect(store.getMessages("any-session")).toEqual([])
		})

		test("handles single item arrays", () => {
			const store = useOpencodeStore.getState()

			const session: Session = {
				id: "only-session",
				title: "Only",
				directory: "/test",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession(session)
			expect(store.getSession("only-session")).toBeDefined()

			store.removeSession("only-session")
			expect(useOpencodeStore.getState().sessions).toHaveLength(0)
		})

		test("handles duplicate IDs gracefully", () => {
			const store = useOpencodeStore.getState()

			const session1: Session = {
				id: "duplicate",
				title: "First",
				directory: "/test",
				time: { created: 1, updated: 1 },
			}
			const session2: Session = {
				id: "duplicate",
				title: "Second",
				directory: "/test",
				time: { created: 2, updated: 2 },
			}

			store.addSession(session1)
			store.addSession(session2)

			const sessions = useOpencodeStore.getState().sessions
			// Binary.insert places duplicates at leftmost position
			// So we should have both, but second one should be first
			expect(sessions).toHaveLength(2)
		})
	})
})
