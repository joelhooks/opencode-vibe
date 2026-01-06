/**
 * Layout Client Tests
 *
 * Tests removed - World Stream handles SSE internally (ADR-018).
 * multiServerSSE no longer exposed as public API.
 * Event routing happens inside createMergedWorldStream, not in layout-client.tsx.
 */

import { describe, it, expect } from "vitest"

describe("LayoutClient", () => {
	it("placeholder test - World Stream handles SSE internally", () => {
		// World Stream tests live in packages/core/src/world/*.test.ts
		expect(true).toBe(true)
	})
})
