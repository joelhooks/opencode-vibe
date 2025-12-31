/**
 * Factory Tests - Provider-free hooks generation
 *
 * Tests the generateOpencodeHelpers factory function that creates hooks
 * which read config from globalThis.__OPENCODE (injected by SSR plugin).
 *
 * Pattern: Test pure logic without DOM rendering (TDD doctrine)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { getOpencodeConfig, generateOpencodeHelpers } from "./factory"
import type { OpencodeConfig } from "./next-ssr-plugin"
import type { Session, Message } from "./store/types"
import { useOpencodeStore } from "./store"

// Mock window for node environment
const mockWindow = {
	__OPENCODE: undefined as OpencodeConfig | undefined,
}

vi.stubGlobal("window", mockWindow)

describe("generateOpencodeHelpers", () => {
	beforeEach(() => {
		// Reset window.__OPENCODE between tests
		mockWindow.__OPENCODE = undefined
	})

	describe("getOpencodeConfig", () => {
		it("reads from globalThis when available", () => {
			mockWindow.__OPENCODE = {
				baseUrl: "/api/opencode/4056",
				directory: "/path",
			}

			const config = getOpencodeConfig()

			expect(config.baseUrl).toBe("/api/opencode/4056")
			expect(config.directory).toBe("/path")
		})

		it("uses fallback config when globalThis empty", () => {
			const fallback: OpencodeConfig = {
				baseUrl: "/fallback",
				directory: "/fallback-path",
			}

			const config = getOpencodeConfig(fallback)

			expect(config.baseUrl).toBe("/fallback")
			expect(config.directory).toBe("/fallback-path")
		})

		it("prefers globalThis over fallback", () => {
			mockWindow.__OPENCODE = {
				baseUrl: "/global",
				directory: "/global-path",
			}

			const fallback: OpencodeConfig = {
				baseUrl: "/fallback",
				directory: "/fallback-path",
			}

			const config = getOpencodeConfig(fallback)

			expect(config.baseUrl).toBe("/global")
			expect(config.directory).toBe("/global-path")
		})

		it("throws when no config available", () => {
			expect(() => {
				getOpencodeConfig()
			}).toThrow(/No configuration found/)
		})

		it("throws with helpful error message mentioning SSR plugin", () => {
			expect(() => {
				getOpencodeConfig()
			}).toThrow(/Did you forget to add <OpencodeSSRPlugin>/)
		})

		it("rejects fallback without baseUrl", () => {
			const invalidFallback = {
				baseUrl: "",
				directory: "/path",
			}

			expect(() => {
				getOpencodeConfig(invalidFallback)
			}).toThrow(/No configuration found/)
		})
	})

	describe("config serialization", () => {
		it("config is JSON-serializable", () => {
			const config: OpencodeConfig = {
				baseUrl: "/api",
				directory: "/path",
			}

			expect(() => JSON.stringify(config)).not.toThrow()
			const serialized = JSON.stringify(config)
			const deserialized = JSON.parse(serialized)

			expect(deserialized).toEqual(config)
		})
	})

	describe("type safety", () => {
		it("OpencodeConfig has required fields", () => {
			const config: OpencodeConfig = {
				baseUrl: "/api",
				directory: "/path",
			}

			expect(config).toHaveProperty("baseUrl")
			expect(config).toHaveProperty("directory")
		})
	})

	describe("generated hooks", () => {
		let helpers: ReturnType<typeof generateOpencodeHelpers>

		beforeEach(() => {
			// Set up config for hook generation
			mockWindow.__OPENCODE = {
				baseUrl: "/api/opencode/4056",
				directory: "/test/project",
			}

			// Generate hooks
			helpers = generateOpencodeHelpers()
		})

		describe("factory returns all 9 hooks", () => {
			it("returns useSession hook function", () => {
				expect(helpers.useSession).toBeDefined()
				expect(typeof helpers.useSession).toBe("function")
			})

			it("returns useMessages hook function", () => {
				expect(helpers.useMessages).toBeDefined()
				expect(typeof helpers.useMessages).toBe("function")
			})

			it("returns useSendMessage hook function", () => {
				expect(helpers.useSendMessage).toBeDefined()
				expect(typeof helpers.useSendMessage).toBe("function")
			})

			it("returns useSessionList hook function", () => {
				expect(helpers.useSessionList).toBeDefined()
				expect(typeof helpers.useSessionList).toBe("function")
			})

			it("returns useProviders hook function", () => {
				expect(helpers.useProviders).toBeDefined()
				expect(typeof helpers.useProviders).toBe("function")
			})

			it("returns useProjects hook function", () => {
				expect(helpers.useProjects).toBeDefined()
				expect(typeof helpers.useProjects).toBe("function")
			})

			it("returns useCommands hook function", () => {
				expect(helpers.useCommands).toBeDefined()
				expect(typeof helpers.useCommands).toBe("function")
			})

			it("returns useCreateSession hook function", () => {
				expect(helpers.useCreateSession).toBeDefined()
				expect(typeof helpers.useCreateSession).toBe("function")
			})

			it("returns useFileSearch hook function", () => {
				expect(helpers.useFileSearch).toBeDefined()
				expect(typeof helpers.useFileSearch).toBe("function")
			})
		})

		describe("config integration", () => {
			it("hooks share same config from globalThis", () => {
				const config = getOpencodeConfig()
				expect(config.baseUrl).toBe("/api/opencode/4056")
				expect(config.directory).toBe("/test/project")
			})

			it("factory works without explicit config parameter", () => {
				// All hooks use getOpencodeConfig() internally
				expect(helpers).toHaveProperty("useSession")
				expect(helpers).toHaveProperty("useMessages")
				expect(helpers).toHaveProperty("useSendMessage")
				expect(helpers).toHaveProperty("useSessionList")
				expect(helpers).toHaveProperty("useProviders")
				expect(helpers).toHaveProperty("useProjects")
				expect(helpers).toHaveProperty("useCommands")
				expect(helpers).toHaveProperty("useCreateSession")
				expect(helpers).toHaveProperty("useFileSearch")
			})

			it("factory can be called with explicit config override", () => {
				const customConfig: OpencodeConfig = {
					baseUrl: "/custom",
					directory: "/custom/path",
				}

				const customHelpers = generateOpencodeHelpers(customConfig)
				expect(customHelpers.useSession).toBeDefined()
			})
		})

		describe("hook name consistency", () => {
			it("hook names match expected pattern", () => {
				const hookNames = Object.keys(helpers)
				expect(hookNames).toContain("useSession")
				expect(hookNames).toContain("useMessages")
				expect(hookNames).toContain("useSendMessage")
				expect(hookNames).toContain("useSessionList")
				expect(hookNames).toContain("useProviders")
				expect(hookNames).toContain("useProjects")
				expect(hookNames).toContain("useCommands")
				expect(hookNames).toContain("useCreateSession")
				expect(hookNames).toContain("useFileSearch")
			})

			it("generates exactly 9 hooks", () => {
				const hookCount = Object.keys(helpers).length
				expect(hookCount).toBe(9)
			})
		})
	})
})
