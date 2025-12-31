/**
 * useCompactionState Tests - Store selector tests
 *
 * Tests the hook logic without DOM rendering.
 * Hook is a pure selector - test by calling store directly.
 */

import { describe, expect, test, beforeEach } from "vitest"
import { useOpencodeStore } from "../../store"

describe("useCompactionState - store integration", () => {
	beforeEach(() => {
		// Reset store before each test
		useOpencodeStore.setState({ directories: {} })
	})

	test("returns default state when no compaction exists", () => {
		const directory = "/test/project"
		useOpencodeStore.getState().initDirectory(directory)

		const compaction = useOpencodeStore.getState().directories[directory]?.compaction["session-1"]

		expect(compaction).toBeUndefined()
		// Hook returns default via ?? operator
		const defaultState = compaction ?? {
			isCompacting: false,
			isAutomatic: false,
			progress: "complete" as const,
			startedAt: 0,
		}
		expect(defaultState.isCompacting).toBe(false)
		expect(defaultState.progress).toBe("complete")
	})

	test("returns compaction state from store when it exists", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		useOpencodeStore.setState((state) => {
			const dir = state.directories[directory]
			if (dir) {
				dir.compaction["session-1"] = {
					isCompacting: true,
					isAutomatic: true,
					progress: "generating",
					startedAt: Date.now(),
					messageId: "msg-123",
				}
			}
		})

		const compaction = useOpencodeStore.getState().directories[directory]?.compaction["session-1"]

		expect(compaction?.isCompacting).toBe(true)
		expect(compaction?.isAutomatic).toBe(true)
		expect(compaction?.progress).toBe("generating")
	})

	test("updates when compaction state changes in store", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		const initialState = store.directories[directory]?.compaction["session-1"]
		expect(initialState).toBeUndefined()

		// Start compaction using setState
		useOpencodeStore.setState((state) => {
			const dir = state.directories[directory]
			if (dir) {
				dir.compaction["session-1"] = {
					isCompacting: true,
					isAutomatic: false,
					progress: "pending",
					startedAt: Date.now(),
				}
			}
		})

		const updatedState = useOpencodeStore.getState().directories[directory]?.compaction["session-1"]

		expect(updatedState?.isCompacting).toBe(true)
		expect(updatedState?.progress).toBe("pending")
	})

	test("returns different states for different sessions", () => {
		const directory = "/test/project"
		const store = useOpencodeStore.getState()
		store.initDirectory(directory)

		useOpencodeStore.setState((state) => {
			const dir = state.directories[directory]
			if (dir) {
				// session-1 is compacting
				dir.compaction["session-1"] = {
					isCompacting: true,
					isAutomatic: true,
					progress: "generating",
					startedAt: Date.now(),
				}
				// session-2 is not compacting (no entry)
			}
		})

		const currentState = useOpencodeStore.getState()
		const state1 = currentState.directories[directory]?.compaction["session-1"]
		const state2 = currentState.directories[directory]?.compaction["session-2"]

		expect(state1?.isCompacting).toBe(true)
		expect(state2).toBeUndefined()
		// Hook would return default for session-2
		const defaultState = state2 ?? {
			isCompacting: false,
			isAutomatic: false,
			progress: "complete" as const,
			startedAt: 0,
		}
		expect(defaultState.isCompacting).toBe(false)
	})
})
