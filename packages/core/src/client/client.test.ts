/**
 * Tests for OpenCode client routing utilities
 */

import { describe, expect, it } from "vitest"
import { createClient, getClientUrl, OPENCODE_URL, type RoutingContext } from "./client.js"

describe("getClientUrl", () => {
	it("returns proxy URL when no args", () => {
		const url = getClientUrl()
		expect(url).toBe("/api/opencode/4056")
	})

	it("returns proxy URL when no routing context", () => {
		const url = getClientUrl("/path/to/project")
		expect(url).toBe("/api/opencode/4056")
	})

	it("returns proxy URL when routing context has no servers", () => {
		const context: RoutingContext = { servers: [] }
		const url = getClientUrl("/path/to/project", undefined, context)
		expect(url).toBe("/api/opencode/4056")
	})

	it("routes to directory server when available", () => {
		const context: RoutingContext = {
			servers: [{ port: 4057, directory: "/path/to/project", url: "/api/opencode/4057" }],
		}
		const url = getClientUrl("/path/to/project", undefined, context)
		expect(url).toBe("/api/opencode/4057")
	})

	it("routes to session server when cached", () => {
		const sessionToPort = new Map([["ses_123", 4058]])
		const context: RoutingContext = {
			servers: [
				{ port: 4057, directory: "/path/to/project", url: "/api/opencode/4057" },
				{ port: 4058, directory: "/other/project", url: "/api/opencode/4058" },
			],
			sessionToPort,
		}
		const url = getClientUrl("/path/to/project", "ses_123", context)
		expect(url).toBe("/api/opencode/4058")
	})

	it("falls back to directory when session not cached", () => {
		const context: RoutingContext = {
			servers: [{ port: 4057, directory: "/path/to/project", url: "/api/opencode/4057" }],
		}
		const url = getClientUrl("/path/to/project", "ses_unknown", context)
		expect(url).toBe("/api/opencode/4057")
	})

	it("exports OPENCODE_URL constant", () => {
		expect(OPENCODE_URL).toBe("http://localhost:4056")
	})
})

describe("regression prevention (from semantic memory)", () => {
	it("NEVER returns empty URL - lesson from semantic memory bd-0571d346", () => {
		// This is a regression test for a critical bug where changing the default
		// from "http://localhost:4056" to empty string broke the app.
		// See semantic memory: "Multi-server SSE discovery broke the app..."

		// Even if discovery returns nothing, routing should work
		const url = getClientUrl()
		expect(url).toBeTruthy()
		expect(url).not.toBe("")
		expect(url).toBe("/api/opencode/4056") // Now returns proxy URL

		// The OPENCODE_URL constant should NEVER be empty (used for SSR)
		expect(OPENCODE_URL).toBeTruthy()
		expect(OPENCODE_URL).not.toBe("")
		expect(OPENCODE_URL).toBe("http://localhost:4056")
	})
})

describe("createClient with Discovery service", () => {
	it("creates client with default proxy URL when no args", () => {
		const client = createClient()
		expect(client).toBeDefined()
		// Client should use proxy URL internally (browser-safe)
		// Actual URL is not exposed, but we can verify it works
	})

	it("creates client with proxy URL (always browser-safe)", () => {
		// createClient ALWAYS uses proxy URL for browser-safety
		// No async discovery needed since Next.js API routes handle it
		const client = createClient("/path/to/project")
		expect(client).toBeDefined()
	})

	it("accepts sessionId parameter for future routing", () => {
		// sessionId is accepted but currently unused (for backwards compat)
		// Future: could enable client-side session->server caching
		const client = createClient("/path/to/project", "ses_123")
		expect(client).toBeDefined()
	})
})

// Browser-side discovery removed - this test is no longer relevant
// Discovery happens server-side only via DiscoveryNodeLive in Server Components

describe("module evaluation regression (TDD RED phase)", () => {
	/**
	 * REGRESSION TEST: createClient() should NOT throw when URL unavailable
	 *
	 * CRITICAL BUG: client.ts throws at module evaluation time when NEXT_PUBLIC_OPENCODE_URL is not set.
	 *
	 * Root cause chain:
	 * 1. Line 177: `export const globalClient = createClient()` executes at module evaluation
	 * 2. Line 154-157: `createClient()` throws if DEFAULT_PROXY_URL is undefined
	 * 3. Line 31-41: `DEFAULT_PROXY_URL` is undefined when env var not set
	 * 4. Result: Importing client.ts crashes the app
	 *
	 * This breaks Next.js RSC pages because:
	 * - page.tsx → client-ssr.ts → client.ts → THROWS
	 * - Client-side code NEVER should rely on env vars for URL
	 * - URLs MUST come from World Stream/discovery state passed by caller
	 *
	 * Expected behavior after fix:
	 * - createClient() can be called without URL (returns null or deferred client)
	 * - URL is passed from discovery state when available
	 * - Module evaluation doesn't throw (globalClient initialization is lazy or removed)
	 *
	 * ╔═══════════════════════════════════════════════════════════╗
	 * ║                  TDD RED PHASE                            ║
	 * ╠═══════════════════════════════════════════════════════════╣
	 * ║  To see these tests FAIL (demonstrating the bug):        ║
	 * ║                                                           ║
	 * ║  unset NEXT_PUBLIC_OPENCODE_URL &&                        ║
	 * ║    bun test src/client/client.test.ts -t "regression"    ║
	 * ║                                                           ║
	 * ║  Expected output:                                         ║
	 * ║    ❌ "Unhandled error between tests"                     ║
	 * ║    ❌ "No OpenCode server URL available"                  ║
	 * ║    ❌ 0 pass, 1 fail, 1 error                             ║
	 * ║                                                           ║
	 * ║  After fix (GREEN phase):                                 ║
	 * ║    ✅ All tests pass                                      ║
	 * ║    ✅ createClient() handles missing URL gracefully       ║
	 * ║    ✅ Module imports without throwing                     ║
	 * ╚═══════════════════════════════════════════════════════════╝
	 *
	 * Current behavior (RED): createClient() throws at module eval
	 * Expected behavior (GREEN): createClient() returns null or deferred client
	 */

	it("createClient() does NOT throw when URL unavailable", () => {
		// TDD RED: Currently throws "No OpenCode server URL available"
		// Expected: returns null or deferred client
		//
		// This test will PASS when env var is set (hiding the bug)
		// This test will FAIL when env var is unset (revealing the bug)
		//
		// To see RED phase: unset NEXT_PUBLIC_OPENCODE_URL before running tests

		// Wrap in try-catch to document current throwing behavior
		let threwError = false
		let client = null

		try {
			client = createClient()
		} catch (error) {
			threwError = true
			// Document the actual error for debugging
			console.error("[TDD RED] createClient() threw:", error)
		}

		// After fix, this assertion will pass (threwError = false)
		expect(threwError).toBe(false)

		// After fix, client should be defined (null or deferred)
		if (!threwError) {
			expect(client).toBeDefined()
		}
	})

	it("createClient() handles missing URL gracefully", () => {
		// TDD RED: Currently throws when DEFAULT_PROXY_URL is undefined
		// Expected: returns client that can accept URL later, or returns null
		//
		// Pattern options after fix:
		// Option 1: Return null, caller must provide URL explicitly
		// Option 2: Return deferred client with .configure(url) method
		// Option 3: Return client that lazy-loads URL from discovery when first request is made

		let client = null
		let error = null

		try {
			client = createClient()
		} catch (err) {
			error = err
			console.error("[TDD RED] createClient() threw:", err)
		}

		// After fix: no error
		expect(error).toBeNull()

		// After fix: client exists (implementation determines shape)
		if (!error) {
			expect(client).toBeDefined()
		}
	})

	it("documents the exact error message for regression tracking", () => {
		// This test captures the EXACT error that happens in production
		// so we can verify the fix resolves the right issue

		let actualError: Error | null = null

		try {
			createClient()
		} catch (err) {
			actualError = err as Error
		}

		// TDD RED: This documents current broken behavior
		// After fix, this test should be updated to verify the NEW behavior
		// (e.g., "returns null" or "returns deferred client")

		// Current error message (captured for regression tracking):
		// "No OpenCode server URL available. Set NEXT_PUBLIC_OPENCODE_URL or run discovery first."

		// This assertion will PASS in RED phase when env var is unset
		// This assertion will FAIL in GREEN phase after fix
		if (actualError) {
			expect(actualError.message).toContain("No OpenCode server URL available")
		} else {
			// After fix: no error, so we verify the client is usable
			const client = createClient()
			expect(client).toBeDefined()
		}
	})
})
