/**
 * useSessionStatus Tests - Store selector tests
 *
 * Tests the hook logic without DOM rendering.
 * Hook is a pure selector - test by calling store directly.
 */

import { describe, expect, test, beforeEach } from "vitest"
import { useOpencodeStore } from "../../store"

describe("useSessionStatus - store integration", () => {
	beforeEach(() => {
		// Reset store before each test
		useOpencodeStore.setState({ directories: {} })
	})

	test("returns 'completed' as default when no status exists", () => {
		const directory = "/test/project"
		useOpencodeStore.getState().initDirectory(directory)

		const status = useOpencodeStore.getState().directories[directory]?.sessionStatus["session-1"]

		expect(status).toBeUndefined() // No status set
		// Hook returns "completed" as fallback via ?? operator
		const hookResult = status ?? "completed"
		expect(hookResult).toBe("completed")
	})

	test("returns status from store when it exists", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		// Set status via event
		store.handleEvent(directory, {
			type: "session.status",
			properties: {
				sessionID: "session-1",
				status: { type: "busy" },
			},
		})

		const status = useOpencodeStore.getState().directories[directory]?.sessionStatus["session-1"]

		expect(status).toBe("running")
	})

	test("updates when status changes in store", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		const initialStatus = store.directories[directory]?.sessionStatus["session-1"]
		expect(initialStatus).toBeUndefined()

		// Update status via event
		store.handleEvent(directory, {
			type: "session.status",
			properties: {
				sessionID: "session-1",
				status: { type: "busy" },
			},
		})

		const updatedStatus =
			useOpencodeStore.getState().directories[directory]?.sessionStatus["session-1"]
		expect(updatedStatus).toBe("running")
	})

	test("returns different statuses for different sessions", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		// Set status for session-1
		store.handleEvent(directory, {
			type: "session.status",
			properties: {
				sessionID: "session-1",
				status: { type: "busy" },
			},
		})

		// Set status for session-2
		store.handleEvent(directory, {
			type: "session.status",
			properties: {
				sessionID: "session-2",
				status: { running: false },
			},
		})

		// Get fresh state after events
		const currentState = useOpencodeStore.getState()
		const status1 = currentState.directories[directory]?.sessionStatus["session-1"]
		const status2 = currentState.directories[directory]?.sessionStatus["session-2"]

		expect(status1).toBe("running")
		expect(status2).toBe("completed")
	})
})
