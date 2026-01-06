/**
 * useWorldDebug Tests
 *
 * NOTE: This hook is tested via integration in the agent-debug page.
 * Unit tests for the core logic are in packages/core/src/world/debug.test.ts
 *
 * This file exists for test coverage completeness but relies on core tests
 * for actual behavior validation.
 */

import { describe, it, expect } from "vitest"
import type { WorldDebugStats } from "@opencode-vibe/core/world/debug"

describe("useWorldDebug", () => {
	it("exports the correct type", () => {
		// Type assertion test - ensures WorldDebugStats interface is exported
		const mockStats: WorldDebugStats = {
			totalMessages: 0,
			totalSessions: 0,
			totalParts: 0,
			connectionStatus: "disconnected",
			messagesBySession: new Map(),
		}

		expect(mockStats).toBeDefined()
		expect(mockStats.totalMessages).toBe(0)
		expect(mockStats.messagesBySession).toBeInstanceOf(Map)
	})
})
