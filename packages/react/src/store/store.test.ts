/**
 * Unit tests for Zustand store with DirectoryState pattern
 *
 * Tests store initialization, event handling, and binary search operations.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { useOpencodeStore } from "./store"

describe("useOpencodeStore", () => {
	beforeEach(() => {
		// Reset store before each test
		useOpencodeStore.setState({ directories: {} })
	})

	describe("initDirectory", () => {
		it("should initialize directory with empty state", () => {
			const store = useOpencodeStore.getState()
			store.initDirectory("/test/project")

			const dir = useOpencodeStore.getState().directories["/test/project"]
			expect(dir).toBeDefined()
			expect(dir?.ready).toBe(false)
			expect(dir?.sessions).toEqual([])
			expect(dir?.messages).toEqual({})
			expect(dir?.parts).toEqual({})
		})

		it("should not overwrite existing directory state", () => {
			const store = useOpencodeStore.getState()
			store.initDirectory("/test/project")
			store.setSessions("/test/project", [
				{
					id: "session-1",
					title: "Test",
					directory: "/test/project",
					time: { created: Date.now(), updated: Date.now() },
				},
			])

			store.initDirectory("/test/project")

			const dir = useOpencodeStore.getState().directories["/test/project"]
			expect(dir?.sessions).toHaveLength(1)
		})
	})

	describe("session management", () => {
		beforeEach(() => {
			useOpencodeStore.getState().initDirectory("/test/project")
		})

		it("should add session in sorted order", () => {
			const store = useOpencodeStore.getState()

			store.addSession("/test/project", {
				id: "c",
				title: "Session C",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			})

			store.addSession("/test/project", {
				id: "a",
				title: "Session A",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			})

			const sessions = useOpencodeStore.getState().directories["/test/project"]?.sessions
			expect(sessions?.map((s) => s.id)).toEqual(["a", "c"])
		})

		it("should get session by ID", () => {
			const store = useOpencodeStore.getState()
			const session = {
				id: "test-session",
				title: "Test",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession("/test/project", session)
			const result = store.getSession("/test/project", "test-session")

			expect(result).toEqual(session)
		})

		it("should update session", () => {
			const store = useOpencodeStore.getState()
			store.addSession("/test/project", {
				id: "test",
				title: "Original",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			})

			store.updateSession("/test/project", "test", (draft) => {
				draft.title = "Updated"
			})

			const session = store.getSession("/test/project", "test")
			expect(session?.title).toBe("Updated")
		})

		it("should remove session", () => {
			const store = useOpencodeStore.getState()
			store.addSession("/test/project", {
				id: "test",
				title: "Test",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			})

			store.removeSession("/test/project", "test")

			const session = store.getSession("/test/project", "test")
			expect(session).toBeUndefined()
		})
	})

	describe("message management", () => {
		beforeEach(() => {
			useOpencodeStore.getState().initDirectory("/test/project")
		})

		it("should add message in sorted order", () => {
			const store = useOpencodeStore.getState()

			store.addMessage("/test/project", {
				id: "msg-c",
				sessionID: "session-1",
				role: "user",
			})

			store.addMessage("/test/project", {
				id: "msg-a",
				sessionID: "session-1",
				role: "user",
			})

			const messages = store.getMessages("/test/project", "session-1")
			expect(messages.map((m) => m.id)).toEqual(["msg-a", "msg-c"])
		})

		it("should update message", () => {
			const store = useOpencodeStore.getState()
			store.addMessage("/test/project", {
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			})

			store.updateMessage("/test/project", "session-1", "msg-1", (draft) => {
				draft.role = "assistant"
			})

			const messages = store.getMessages("/test/project", "session-1")
			expect(messages[0]?.role).toBe("assistant")
		})

		it("should remove message", () => {
			const store = useOpencodeStore.getState()
			store.addMessage("/test/project", {
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			})

			store.removeMessage("/test/project", "session-1", "msg-1")

			const messages = store.getMessages("/test/project", "session-1")
			expect(messages).toHaveLength(0)
		})
	})

	describe("handleEvent", () => {
		beforeEach(() => {
			useOpencodeStore.getState().initDirectory("/test/project")
		})

		it("should handle session.created event", () => {
			const store = useOpencodeStore.getState()
			const session = {
				id: "new-session",
				title: "New Session",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.handleEvent("/test/project", {
				type: "session.created",
				properties: { info: session },
			})

			const result = store.getSession("/test/project", "new-session")
			expect(result).toEqual(session)
		})

		it("should handle session.updated event", () => {
			const store = useOpencodeStore.getState()
			const session = {
				id: "test",
				title: "Original",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.addSession("/test/project", session)

			store.handleEvent("/test/project", {
				type: "session.updated",
				properties: {
					info: { ...session, title: "Updated" },
				},
			})

			const result = store.getSession("/test/project", "test")
			expect(result?.title).toBe("Updated")
		})

		it("should handle message.updated event", () => {
			const store = useOpencodeStore.getState()
			const message = {
				id: "msg-1",
				sessionID: "session-1",
				role: "user",
			}

			store.handleEvent("/test/project", {
				type: "message.updated",
				properties: { info: message },
			})

			const messages = store.getMessages("/test/project", "session-1")
			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual(message)
		})

		it("should handle message.part.updated event", () => {
			const store = useOpencodeStore.getState()
			const part = {
				id: "part-1",
				messageID: "msg-1",
				type: "text",
				content: "Hello",
			}

			store.handleEvent("/test/project", {
				type: "message.part.updated",
				properties: { part },
			})

			const parts = useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]
			expect(parts).toHaveLength(1)
			expect(parts?.[0]).toEqual(part)
		})

		it("should auto-create directory if not exists", () => {
			const store = useOpencodeStore.getState()

			store.handleEvent("/new/directory", {
				type: "session.created",
				properties: {
					info: {
						id: "session-1",
						title: "Test",
						directory: "/new/directory",
						time: { created: Date.now(), updated: Date.now() },
					},
				},
			})

			const dir = useOpencodeStore.getState().directories["/new/directory"]
			expect(dir).toBeDefined()
			expect(dir?.sessions).toHaveLength(1)
		})
	})

	describe("handleSSEEvent", () => {
		it("should handle GlobalEvent and route to handleEvent", () => {
			const store = useOpencodeStore.getState()
			const session = {
				id: "test",
				title: "Test",
				directory: "/test/project",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.handleSSEEvent({
				directory: "/test/project",
				payload: {
					type: "session.created",
					properties: { info: session },
				},
			})

			const result = store.getSession("/test/project", "test")
			expect(result).toEqual(session)
		})

		it("should auto-create directory from SSE event", () => {
			const store = useOpencodeStore.getState()

			store.handleSSEEvent({
				directory: "/auto/directory",
				payload: {
					type: "session.created",
					properties: {
						info: {
							id: "session-1",
							title: "Test",
							directory: "/auto/directory",
							time: { created: Date.now(), updated: Date.now() },
						},
					},
				},
			})

			const dir = useOpencodeStore.getState().directories["/auto/directory"]
			expect(dir).toBeDefined()
		})
	})

	/**
	 * REMOVED: multi-directory session status tests
	 *
	 * These tests verified that Zustand store updated sessionStatus/sessionLastActivity
	 * fields from SSE events. Those fields were removed in Phase 6.1 cleanup because:
	 * - World Stream now provides session.status (EnrichedSession.status)
	 * - Hooks read from World Stream, not Zustand
	 * - The Zustand fields were write-only (SSE updated them, nothing read them)
	 *
	 * Related: opencode-next--xts0a-mjz41bm4b8w (Migrate useMultiDirectoryStatus to World Stream)
	 */

	// describe("multi-directory session status", () => {
		it("should update session status in directory B even when directory A was initialized first", () => {
			const store = useOpencodeStore.getState()

			// Initialize directory A first
			store.initDirectory("/project/A")

			// Session status event for directory B (not yet initialized)
			store.handleSSEEvent({
				directory: "/project/B",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-b-1",
						status: "running",
					},
				},
			})

			// Verify directory B was auto-created and status was set
			const dirB = useOpencodeStore.getState().directories["/project/B"]
			expect(dirB).toBeDefined()
			expect(dirB?.sessionStatus["session-b-1"]).toBe("running")
			expect(dirB?.sessionLastActivity["session-b-1"]).toBeDefined()

			// Verify directory A is unaffected
			const dirA = useOpencodeStore.getState().directories["/project/A"]
			expect(dirA?.sessionStatus["session-b-1"]).toBeUndefined()
		})

		it("should handle session status updates for multiple directories simultaneously", () => {
			const store = useOpencodeStore.getState()

			// Initialize both directories
			store.initDirectory("/project/A")
			store.initDirectory("/project/B")

			// Update session status for directory A
			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-a-1",
						status: "running",
					},
				},
			})

			// Update session status for directory B
			store.handleSSEEvent({
				directory: "/project/B",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-b-1",
						status: "running",
					},
				},
			})

			// Verify both directories have their own status
			const state = useOpencodeStore.getState()
			expect(state.directories["/project/A"]?.sessionStatus["session-a-1"]).toBe("running")
			expect(state.directories["/project/B"]?.sessionStatus["session-b-1"]).toBe("running")

			// Verify status is isolated (directory A doesn't have B's session)
			expect(state.directories["/project/A"]?.sessionStatus["session-b-1"]).toBeUndefined()
			expect(state.directories["/project/B"]?.sessionStatus["session-a-1"]).toBeUndefined()
		})

		it("should handle session.status event with normalized status values", () => {
			const store = useOpencodeStore.getState()
			store.initDirectory("/project/A")

			// Status is already normalized to "running" | "completed" by Core layer
			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-1",
						status: "running",
					},
				},
			})

			let status = useOpencodeStore.getState().directories["/project/A"]?.sessionStatus["session-1"]
			expect(status).toBe("running")

			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-2",
						status: "completed",
					},
				},
			})

			status = useOpencodeStore.getState().directories["/project/A"]?.sessionStatus["session-2"]
			expect(status).toBe("completed")
		})

		it("should update sessionLastActivity timestamp on status change", () => {
			const store = useOpencodeStore.getState()
			store.initDirectory("/project/A")

			const beforeTime = Date.now()

			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-1",
						status: "running",
					},
				},
			})

			const afterTime = Date.now()
			const activity =
				useOpencodeStore.getState().directories["/project/A"]?.sessionLastActivity["session-1"]

			expect(activity).toBeDefined()
			expect(activity).toBeGreaterThanOrEqual(beforeTime)
			expect(activity).toBeLessThanOrEqual(afterTime)
		})

		it("should handle session.created events in correct directory state", () => {
			const store = useOpencodeStore.getState()

			// Create sessions in different directories
			const sessionA = {
				id: "session-a",
				title: "Session A",
				directory: "/project/A",
				time: { created: Date.now(), updated: Date.now() },
			}

			const sessionB = {
				id: "session-b",
				title: "Session B",
				directory: "/project/B",
				time: { created: Date.now(), updated: Date.now() },
			}

			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.created",
					properties: { info: sessionA },
				},
			})

			store.handleSSEEvent({
				directory: "/project/B",
				payload: {
					type: "session.created",
					properties: { info: sessionB },
				},
			})

			// Verify sessions are in correct directories
			const dirA = useOpencodeStore.getState().directories["/project/A"]
			const dirB = useOpencodeStore.getState().directories["/project/B"]

			expect(dirA?.sessions).toHaveLength(1)
			expect(dirA?.sessions[0]?.id).toBe("session-a")

			expect(dirB?.sessions).toHaveLength(1)
			expect(dirB?.sessions[0]?.id).toBe("session-b")

			// Verify isolation - session-a is not in directory B
			const sessionInB = store.getSession("/project/B", "session-a")
			expect(sessionInB).toBeUndefined()

			// Verify isolation - session-b is not in directory A
			const sessionInA = store.getSession("/project/A", "session-b")
			expect(sessionInA).toBeUndefined()
		})

		it("should handle multiple status updates for same session across time", () => {
			const store = useOpencodeStore.getState()
			store.initDirectory("/project/A")

			// Session starts running (status already normalized by Core layer)
			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.status",
					properties: {
						sessionID: "session-1",
						status: "running",
					},
				},
			})

			const firstActivity =
				useOpencodeStore.getState().directories["/project/A"]?.sessionLastActivity["session-1"]
			expect(
				useOpencodeStore.getState().directories["/project/A"]?.sessionStatus["session-1"],
			).toBe("running")

			// Small delay to ensure timestamp difference
			const delay = () => new Promise((resolve) => setTimeout(resolve, 10))
			return delay().then(() => {
				// Session completes (status already normalized by Core layer)
				store.handleSSEEvent({
					directory: "/project/A",
					payload: {
						type: "session.status",
						properties: {
							sessionID: "session-1",
							status: "completed",
						},
					},
				})

				const secondActivity =
					useOpencodeStore.getState().directories["/project/A"]?.sessionLastActivity["session-1"]
				expect(
					useOpencodeStore.getState().directories["/project/A"]?.sessionStatus["session-1"],
				).toBe("completed")
				expect(secondActivity).toBeGreaterThan(firstActivity!)
			})
		})

		it("should maintain independent session arrays for multiple directories", () => {
			const store = useOpencodeStore.getState()

			// Create multiple sessions in directory A
			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.created",
					properties: {
						info: {
							id: "session-a-1",
							title: "A1",
							directory: "/project/A",
							time: { created: Date.now(), updated: Date.now() },
						},
					},
				},
			})

			store.handleSSEEvent({
				directory: "/project/A",
				payload: {
					type: "session.created",
					properties: {
						info: {
							id: "session-a-2",
							title: "A2",
							directory: "/project/A",
							time: { created: Date.now(), updated: Date.now() },
						},
					},
				},
			})

			// Create session in directory B
			store.handleSSEEvent({
				directory: "/project/B",
				payload: {
					type: "session.created",
					properties: {
						info: {
							id: "session-b-1",
							title: "B1",
							directory: "/project/B",
							time: { created: Date.now(), updated: Date.now() },
						},
					},
				},
			})

			// Verify directory A has 2 sessions
			const sessionsA = store.getSessions("/project/A")
			expect(sessionsA).toHaveLength(2)
			expect(sessionsA.map((s) => s.id)).toEqual(["session-a-1", "session-a-2"])

			// Verify directory B has 1 session
			const sessionsB = store.getSessions("/project/B")
			expect(sessionsB).toHaveLength(1)
			expect(sessionsB[0]?.id).toBe("session-b-1")
		})
	})

	describe("model limits - store as single source of truth", () => {
		beforeEach(() => {
			useOpencodeStore.getState().initDirectory("/test/project")
		})

		it("should use cached model limits from store, not message.model.limits", () => {
			const store = useOpencodeStore.getState()

			// Populate store with model limits FIRST (bootstrap phase)
			store.setModelLimits("/test/project", {
				"claude-opus-4": { context: 200000, output: 8192 },
			})

			// Message arrives with tokens but WITHOUT model.limits (backend sends modelID)
			// This tests that we ONLY use store, not message.model.limits fallback
			store.handleEvent("/test/project", {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "assistant",
						modelID: "claude-opus-4",
						tokens: {
							input: 50000,
							output: 2000,
							cache: { read: 10000 },
						},
					},
				},
			})

			const contextUsage =
				useOpencodeStore.getState().directories["/test/project"]?.contextUsage["session-1"]
			expect(contextUsage).toBeDefined()
			// usableContext = 200000 - min(8192, 32000) = 200000 - 8192 = 191808
			// used = 50000 + 10000 + 2000 = 62000
			// percentage = (62000 / 191808) * 100 = ~32%
			expect(contextUsage?.limit).toBe(200000)
			expect(contextUsage?.used).toBe(62000)
			expect(contextUsage?.percentage).toBe(32) // Math.round((62000 / 191808) * 100)
		})

		it("should fallback to DEFAULT_MODEL_LIMITS when model not in store", () => {
			const store = useOpencodeStore.getState()

			// Message with unknown modelID (not in store)
			store.handleEvent("/test/project", {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "assistant",
						modelID: "unknown-model",
						tokens: {
							input: 50000,
							output: 2000,
							cache: { read: 10000 },
						},
					},
				},
			})

			const contextUsage =
				useOpencodeStore.getState().directories["/test/project"]?.contextUsage["session-1"]
			expect(contextUsage).toBeDefined()
			// Should use DEFAULT_MODEL_LIMITS: { context: 128000, output: 4096 }
			// usableContext = 128000 - min(4096, 32000) = 128000 - 4096 = 123904
			// used = 62000
			// percentage = (62000 / 123904) * 100 = ~50%
			expect(contextUsage?.limit).toBe(128000)
			expect(contextUsage?.used).toBe(62000)
			expect(contextUsage?.percentage).toBe(50) // Math.round((62000 / 123904) * 100)
		})

		it("should NOT cache message.model.limits in store", () => {
			const store = useOpencodeStore.getState()

			// Message with model.limits (old behavior - should be ignored)
			store.handleEvent("/test/project", {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "assistant",
						modelID: "claude-opus-4",
						model: {
							name: "claude-opus-4",
							limits: { context: 999999, output: 999999 }, // These should be IGNORED
						},
						tokens: {
							input: 50000,
							output: 2000,
						},
					},
				},
			})

			// Store should NOT have cached these limits
			const cachedLimits =
				useOpencodeStore.getState().directories["/test/project"]?.modelLimits["claude-opus-4"]
			expect(cachedLimits).toBeUndefined()

			// Context usage should use DEFAULT_MODEL_LIMITS (128000, 4096) since model not in store
			const contextUsage =
				useOpencodeStore.getState().directories["/test/project"]?.contextUsage["session-1"]
			expect(contextUsage?.limit).toBe(128000) // DEFAULT, not 999999
		})

		it("should handle message without modelID gracefully", () => {
			const store = useOpencodeStore.getState()

			// Message without modelID (edge case)
			store.handleEvent("/test/project", {
				type: "message.updated",
				properties: {
					info: {
						id: "msg-1",
						sessionID: "session-1",
						role: "assistant",
						tokens: {
							input: 50000,
							output: 2000,
						},
					},
				},
			})

			const contextUsage =
				useOpencodeStore.getState().directories["/test/project"]?.contextUsage["session-1"]
			// Should still calculate context usage with DEFAULT_MODEL_LIMITS
			expect(contextUsage).toBeDefined()
			expect(contextUsage?.limit).toBe(128000)
		})
	})

	describe("part update reference equality (for React.memo)", () => {
		beforeEach(() => {
			useOpencodeStore.getState().initDirectory("/test/project")
		})

		it("should produce NEW part reference when part.updated event arrives", () => {
			const actions = useOpencodeStore.getState()

			// Initial part
			const initialPart = {
				id: "part-1",
				messageID: "msg-1",
				type: "text",
				content: "Hello",
				state: {
					status: "streaming",
					metadata: {
						summary: "Initial summary",
					},
				},
			}

			actions.handleEvent("/test/project", {
				type: "message.part.updated",
				properties: { part: initialPart },
			})

			// Get reference to the part in store
			const firstPartRef =
				useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]?.[0]
			expect(firstPartRef).toBeDefined()
			expect(firstPartRef?.state?.metadata?.summary).toBe("Initial summary")

			// Update part with new metadata
			const updatedPart = {
				id: "part-1",
				messageID: "msg-1",
				type: "text",
				content: "Hello",
				state: {
					status: "complete",
					metadata: {
						summary: "Updated summary",
					},
				},
			}

			actions.handleEvent("/test/project", {
				type: "message.part.updated",
				properties: { part: updatedPart },
			})

			// Get reference to the updated part
			const secondPartRef =
				useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]?.[0]

			// CRITICAL ASSERTIONS for React.memo
			// 1. Object.is should return false (different references)
			expect(Object.is(firstPartRef, secondPartRef)).toBe(false)

			// 2. Nested metadata should be updated
			expect(secondPartRef?.state?.metadata?.summary).toBe("Updated summary")
			expect(secondPartRef?.state?.status).toBe("complete")

			// 3. Parts array should still have only one item
			const partsArray = useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]
			expect(partsArray).toHaveLength(1)
		})

		it("should produce NEW part reference even when only nested metadata changes", () => {
			const actions = useOpencodeStore.getState()

			// Initial part
			const initialPart = {
				id: "part-1",
				messageID: "msg-1",
				type: "task",
				content: "Running task",
				state: {
					status: "running",
					metadata: {
						summary: "Task running",
					},
				},
			}

			actions.handleEvent("/test/project", {
				type: "message.part.updated",
				properties: { part: initialPart },
			})

			const firstPartRef =
				useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]?.[0]

			// Update ONLY nested metadata (same content, same status)
			const updatedPart = {
				id: "part-1",
				messageID: "msg-1",
				type: "task",
				content: "Running task", // Same
				state: {
					status: "running", // Same
					metadata: {
						summary: "Task completed with result", // Changed
					},
				},
			}

			actions.handleEvent("/test/project", {
				type: "message.part.updated",
				properties: { part: updatedPart },
			})

			const secondPartRef =
				useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]?.[0]

			// Even though only nested metadata changed, should still produce new reference
			expect(Object.is(firstPartRef, secondPartRef)).toBe(false)
			expect(secondPartRef?.state?.metadata?.summary).toBe("Task completed with result")
		})

		it("should handle multiple sequential updates with new references each time", () => {
			const actions = useOpencodeStore.getState()

			const partUpdates = [
				{
					id: "part-1",
					messageID: "msg-1",
					type: "text",
					content: "Step 1",
					state: { status: "pending", metadata: { summary: "Step 1" } },
				},
				{
					id: "part-1",
					messageID: "msg-1",
					type: "text",
					content: "Step 2",
					state: { status: "running", metadata: { summary: "Step 2" } },
				},
				{
					id: "part-1",
					messageID: "msg-1",
					type: "text",
					content: "Step 3",
					state: { status: "complete", metadata: { summary: "Step 3" } },
				},
			]

			const refs: unknown[] = []

			for (const part of partUpdates) {
				actions.handleEvent("/test/project", {
					type: "message.part.updated",
					properties: { part },
				})

				const currentRef =
					useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]?.[0]
				refs.push(currentRef)
			}

			// All three references should be different
			expect(Object.is(refs[0], refs[1])).toBe(false)
			expect(Object.is(refs[1], refs[2])).toBe(false)
			expect(Object.is(refs[0], refs[2])).toBe(false)

			// Final state should match last update
			const finalPart =
				useOpencodeStore.getState().directories["/test/project"]?.parts["msg-1"]?.[0]
			expect(finalPart?.state?.status).toBe("complete")
			expect(finalPart?.state?.metadata?.summary).toBe("Step 3")
		})
	})
})
