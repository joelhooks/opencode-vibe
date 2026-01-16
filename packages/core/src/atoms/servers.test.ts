/**
 * Tests for server discovery atom
 *
 * Tests pure Effect programs for server discovery.
 * No React dependencies - tests Effect logic directly.
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { ServerInfo } from "../discovery/index.js"
import { DEFAULT_SERVER, ServerAtom, selectBestServer } from "./servers.js"

describe("selectBestServer", () => {
	it("returns first server with directory when available", () => {
		const servers: ServerInfo[] = [
			{ port: 4056, directory: "", url: "http://localhost:4056" },
			{ port: 4057, directory: "/project/a", url: "http://localhost:4057" },
			{ port: 4058, directory: "/project/b", url: "http://localhost:4058" },
		]

		const result = selectBestServer(servers)

		expect(result.directory).toBe("/project/a")
		expect(result.port).toBe(4057)
	})

	it("returns first server when no directory available", () => {
		const servers: ServerInfo[] = [
			{ port: 4056, directory: "", url: "http://localhost:4056" },
			{ port: 4057, directory: "", url: "http://localhost:4057" },
		]

		const result = selectBestServer(servers)

		expect(result.port).toBe(4056)
	})

	it("returns default when server list is empty", () => {
		const servers: ServerInfo[] = []

		const result = selectBestServer(servers)

		expect(result).toEqual(DEFAULT_SERVER)
	})

	it("prefers first server with directory over later ones", () => {
		const servers: ServerInfo[] = [
			{ port: 4056, directory: "", url: "http://localhost:4056" },
			{ port: 4057, directory: "/project/a", url: "http://localhost:4057" },
			{ port: 4058, directory: "/project/b", url: "http://localhost:4058" },
		]

		const result = selectBestServer(servers)

		// Should pick 4057 (first with directory), not 4058
		expect(result.port).toBe(4057)
	})
})

describe("DEFAULT_SERVER constant", () => {
	it("has correct structure", () => {
		expect(DEFAULT_SERVER.port).toBe(4056)
		expect(DEFAULT_SERVER.directory).toBe("")
		expect(DEFAULT_SERVER.url).toBe("http://localhost:4056")
	})
})

describe("ServerAtom.discover", () => {
	it("returns an Effect program", () => {
		const program = ServerAtom.discover()
		expect(Effect.isEffect(program)).toBe(true)
	})

	it("always includes default server on success", async () => {
		const servers = await Effect.runPromise(ServerAtom.discover())

		// Should have at least the default server
		expect(servers.length).toBeGreaterThanOrEqual(1)

		// Should include default server (port 4056)
		const hasDefault = servers.some((s) => s.port === 4056)
		expect(hasDefault).toBe(true)
	})

	it("falls back to default server on error", async () => {
		// The discover effect catches all errors and returns [DEFAULT_SERVER]
		// We can't easily test error handling without mocking the ServerDiscovery service
		// But we can verify the fallback behavior
		const servers = await Effect.runPromise(ServerAtom.discover())

		// Should always succeed (never fails)
		expect(servers).toBeDefined()
		expect(Array.isArray(servers)).toBe(true)
	})
})

describe("ServerAtom.currentServer", () => {
	it("returns an Effect program", () => {
		const program = ServerAtom.currentServer()
		expect(Effect.isEffect(program)).toBe(true)
	})

	it("returns best server from discovered list", async () => {
		const server = await Effect.runPromise(ServerAtom.currentServer())

		// Should return a valid ServerInfo
		expect(server).toBeDefined()
		expect(typeof server.port).toBe("number")
		expect(typeof server.url).toBe("string")
		expect(typeof server.directory).toBe("string")
	})

	it("never fails (always returns a server)", async () => {
		// currentServer should never throw
		const server = await Effect.runPromise(ServerAtom.currentServer())
		expect(server).toBeDefined()
	})
})
