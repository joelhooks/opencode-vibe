/**
 * Servers API Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { servers } from "./servers.js"

/**
 * Mock ServerAtom for testing
 * Note: ServerAtom uses Effect.provide, so we need to mock the whole module
 */
vi.mock("../atoms/servers.js", () => ({
	ServerAtom: {
		discover: vi.fn(() => ({
			pipe: vi.fn(() => ({
				[Symbol.iterator]: function* () {
					yield { port: 4056, directory: "", url: "http://localhost:4056" }
				},
			})),
		})),
		currentServer: vi.fn(() => ({
			pipe: vi.fn(() => ({
				[Symbol.iterator]: function* () {
					yield { port: 4056, directory: "/test", url: "http://localhost:4056" }
				},
			})),
		})),
	},
}))

describe("servers API", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should have discover method", () => {
		expect(servers.discover).toBeDefined()
	})

	it("should have currentServer method", () => {
		expect(servers.currentServer).toBeDefined()
	})
})
