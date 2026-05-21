import { mkdir, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const TEST_DIR = join(tmpdir(), `manual-server-registry-test-${process.pid}`)

vi.mock("os", async () => {
	const actual = await vi.importActual<typeof import("os")>("os")
	return {
		...actual,
		homedir: () => TEST_DIR,
	}
})

import {
	addServer,
	type ManualServer,
	readRegistry,
	removeServer,
	verifyManualServer,
} from "./manual-server-registry"

const STATE_DIR = join(TEST_DIR, ".local", "state", "opencode")
const REGISTRY_PATH = join(STATE_DIR, "manual-servers.json")

describe("manual-server-registry", () => {
	beforeEach(async () => {
		await mkdir(STATE_DIR, { recursive: true })
	})

	afterEach(async () => {
		await rm(TEST_DIR, { recursive: true, force: true })
	})

	describe("readRegistry", () => {
		test("returns empty array when file does not exist", async () => {
			const servers = await readRegistry()
			expect(servers).toEqual([])
		})

		test("returns servers from valid file", async () => {
			const data = {
				servers: [{ url: "http://sandbox:4056", name: "test", addedAt: 1000, proxyPort: 50001 }],
			}
			await writeFile(REGISTRY_PATH, JSON.stringify(data))

			const servers = await readRegistry()
			expect(servers).toHaveLength(1)
			expect(servers[0]!.url).toBe("http://sandbox:4056")
			expect(servers[0]!.proxyPort).toBe(50001)
		})

		test("returns empty array for invalid JSON", async () => {
			await writeFile(REGISTRY_PATH, "not json")

			const servers = await readRegistry()
			expect(servers).toEqual([])
		})

		test("assigns proxy ports for legacy entries", async () => {
			const data = {
				servers: [{ url: "http://sandbox:4056", name: "legacy", addedAt: 1000 }],
			}
			await writeFile(REGISTRY_PATH, JSON.stringify(data))

			const servers = await readRegistry()
			expect(servers).toHaveLength(1)
			expect(servers[0]!.proxyPort).toBeGreaterThanOrEqual(49152)
			expect(servers[0]!.proxyPort).toBeLessThanOrEqual(65535)
		})

		test("returns empty array if servers is not an array", async () => {
			await writeFile(REGISTRY_PATH, JSON.stringify({ servers: "not an array" }))

			const servers = await readRegistry()
			expect(servers).toEqual([])
		})
	})

	describe("addServer", () => {
		test("adds server to empty registry", async () => {
			const server = await addServer("http://sandbox:4056", "my-sandbox")

			expect(server.url).toBe("http://sandbox:4056")
			expect(server.name).toBe("my-sandbox")
			expect(server.addedAt).toBeGreaterThan(0)
			expect(server.proxyPort).toBeGreaterThanOrEqual(49152)
			expect(server.proxyPort).toBeLessThanOrEqual(65535)

			const content = await readFile(REGISTRY_PATH, "utf-8")
			const data = JSON.parse(content)
			expect(data.servers).toHaveLength(1)
		})

		test("extracts credentials from URL", async () => {
			const server = await addServer("http://myuser:secret123@sandbox:4056")

			expect(server.url).toBe("http://sandbox:4056")
			expect(server.username).toBe("myuser")
			expect(server.password).toBe("secret123")
			expect(server.proxyPort).toBeGreaterThanOrEqual(49152)
			expect(server.proxyPort).toBeLessThanOrEqual(65535)
		})

		test("extracts password-only credentials (uses default username)", async () => {
			const server = await addServer("http://:secret123@sandbox:4056")

			expect(server.url).toBe("http://sandbox:4056")
			expect(server.username).toBeUndefined()
			expect(server.password).toBe("secret123")
			expect(server.proxyPort).toBeGreaterThanOrEqual(49152)
			expect(server.proxyPort).toBeLessThanOrEqual(65535)
		})

		test("adds protocol if missing", async () => {
			const server = await addServer("sandbox:4056")

			expect(server.url).toBe("http://sandbox:4056")
		})

		test("removes trailing slashes", async () => {
			const server = await addServer("http://sandbox:4056///")

			expect(server.url).toBe("http://sandbox:4056")
		})

		test("throws on invalid URL", async () => {
			await expect(addServer(":::invalid")).rejects.toThrow()
		})

		test("throws on duplicate URL", async () => {
			await addServer("http://sandbox:4056")

			await expect(addServer("http://sandbox:4056")).rejects.toThrow("already registered")
		})

		test("treats URLs with different credentials as same server", async () => {
			await addServer("http://user1:pass1@sandbox:4056")

			await expect(addServer("http://user2:pass2@sandbox:4056")).rejects.toThrow(
				"already registered",
			)
		})

		test("returns stable proxy port for same URL", async () => {
			const first = await addServer("http://sandbox:4056")
			await removeServer("http://sandbox:4056")
			const second = await addServer("http://sandbox:4056")

			expect(first.proxyPort).toBe(second.proxyPort)
		})

		test("trims whitespace from name", async () => {
			const server = await addServer("http://sandbox:4056", "  my sandbox  ")

			expect(server.name).toBe("my sandbox")
		})

		test("omits name if empty string", async () => {
			const server = await addServer("http://sandbox:4056", "")

			expect(server.name).toBeUndefined()
		})
	})

	describe("removeServer", () => {
		test("removes existing server", async () => {
			await addServer("http://sandbox:4056")

			const removed = await removeServer("http://sandbox:4056")

			expect(removed).toBe(true)
			const servers = await readRegistry()
			expect(servers).toHaveLength(0)
		})

		test("returns false for non-existent server", async () => {
			const removed = await removeServer("http://nonexistent:4056")

			expect(removed).toBe(false)
		})

		test("removes server by URL with credentials stripped", async () => {
			await addServer("http://user:pass@sandbox:4056")

			const removed = await removeServer("http://sandbox:4056")

			expect(removed).toBe(true)
		})
	})

	describe("verifyManualServer", () => {
		test("returns null on network error", async () => {
			const server: ManualServer = {
				url: "http://localhost:59999",
				proxyPort: 50010,
				addedAt: Date.now(),
			}

			const result = await verifyManualServer(server, 100)

			expect(result).toBeNull()
		})

		test("returns null on timeout", async () => {
			const server: ManualServer = {
				url: "http://10.255.255.1:4056",
				proxyPort: 50011,
				addedAt: Date.now(),
			}

			const start = Date.now()
			const result = await verifyManualServer(server, 100)
			const elapsed = Date.now() - start

			expect(result).toBeNull()
			expect(elapsed).toBeLessThan(500)
		})
	})
})
