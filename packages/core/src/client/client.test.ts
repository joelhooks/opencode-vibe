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

describe("runWithDiscovery helper", () => {
	it("runs Effect program with DiscoveryBrowserLive layer", async () => {
		const { runWithDiscovery } = await import("./client.js")
		const { Effect } = await import("effect")
		const { Discovery } = await import("../discovery/index.js")

		const result = await runWithDiscovery(
			Effect.gen(function* () {
				const discovery = yield* Discovery
				// Mock discovery returns empty array (graceful degradation)
				return yield* discovery.discover()
			}),
		)

		// Discovery should return an array (empty in test environment)
		expect(Array.isArray(result)).toBe(true)
	})
})
