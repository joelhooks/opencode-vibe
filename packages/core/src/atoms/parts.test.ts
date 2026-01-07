/**
 * Parts Atom Tests - Effect Programs
 *
 * Tests for part list management with Effect programs.
 * Following TDD: Write tests first, implement to make them pass.
 */

import { describe, it, expect, vi } from "vitest"
import { Effect } from "effect"
import { Binary } from "../utils/binary.js"
import { PartAtom } from "./parts.js"
import type { Part } from "../types/index.js"

/**
 * Factory for creating test parts with minimal fields
 */
function createPart(
	id: string,
	messageID: string,
	sessionID = "ses-1",
	type = "text",
	text = "",
): Part {
	return {
		id,
		sessionID,
		messageID,
		type,
		text,
	} as Part
}

/**
 * Mock createClient for testing
 */
vi.mock("../client/index.js", () => ({
	createClient: vi.fn((directory?: string) => ({
		session: {
			messages: vi.fn(({ path }: { path: { id: string } }) =>
				Promise.resolve({
					data: [
						{
							info: { id: "msg-1", sessionID: path.id },
							parts: [createPart("part-a", "msg-1"), createPart("part-b", "msg-1")],
						},
						{
							info: { id: "msg-2", sessionID: path.id },
							parts: [createPart("part-c", "msg-2")],
						},
					],
				}),
			),
		},
	})),
}))

describe("Binary search utilities for parts", () => {
	it("should find existing part by ID", () => {
		const parts: Part[] = [
			createPart("part-a", "msg-1"),
			createPart("part-c", "msg-1"),
			createPart("part-e", "msg-1"),
		]

		const result = Binary.search(parts, "part-c", (p) => p.id)

		expect(result.found).toBe(true)
		expect(result.index).toBe(1)
	})

	it("should return insertion index when part not found", () => {
		const parts: Part[] = [
			createPart("part-a", "msg-1"),
			createPart("part-c", "msg-1"),
			createPart("part-e", "msg-1"),
		]

		const result = Binary.search(parts, "part-d", (p) => p.id)

		expect(result.found).toBe(false)
		expect(result.index).toBe(2) // Should insert between part-c and part-e
	})

	it("should insert part at correct position", () => {
		const parts: Part[] = [createPart("part-a", "msg-1"), createPart("part-c", "msg-1")]

		const newPart = createPart("part-b", "msg-1")
		const result = Binary.insert(parts, newPart, (p) => p.id)

		expect(result).toHaveLength(3)
		expect(result[0]?.id).toBe("part-a")
		expect(result[1]?.id).toBe("part-b")
		expect(result[2]?.id).toBe("part-c")
	})

	it("should maintain sorted order after multiple insertions", () => {
		let parts: Part[] = []

		// Insert in random order
		parts = Binary.insert(parts, createPart("part-e", "msg-1"), (p) => p.id)
		parts = Binary.insert(parts, createPart("part-b", "msg-1"), (p) => p.id)
		parts = Binary.insert(parts, createPart("part-d", "msg-1"), (p) => p.id)
		parts = Binary.insert(parts, createPart("part-a", "msg-1"), (p) => p.id)
		parts = Binary.insert(parts, createPart("part-c", "msg-1"), (p) => p.id)

		// Verify sorted order
		expect(parts.map((p) => p.id)).toEqual(["part-a", "part-b", "part-c", "part-d", "part-e"])
	})

	it("should handle insertion into empty array", () => {
		const parts: Part[] = []
		const newPart = createPart("part-a", "msg-1")

		const result = Binary.insert(parts, newPart, (p) => p.id)

		expect(result).toHaveLength(1)
		expect(result[0]?.id).toBe("part-a")
	})

	it("should handle insertion at beginning", () => {
		const parts: Part[] = [createPart("part-b", "msg-1"), createPart("part-c", "msg-1")]

		const newPart = createPart("part-a", "msg-1")
		const result = Binary.insert(parts, newPart, (p) => p.id)

		expect(result[0]?.id).toBe("part-a")
	})

	it("should handle insertion at end", () => {
		const parts: Part[] = [createPart("part-a", "msg-1"), createPart("part-b", "msg-1")]

		const newPart = createPart("part-z", "msg-1")
		const result = Binary.insert(parts, newPart, (p) => p.id)

		expect(result[result.length - 1]?.id).toBe("part-z")
	})
})

describe("Binary search performance", () => {
	it("should handle large part list efficiently (O(log n))", () => {
		// Create a large sorted array (10,000 parts)
		const parts: Part[] = []
		for (let i = 0; i < 10000; i++) {
			parts.push(createPart(`part-${String(i).padStart(5, "0")}`, "msg-1"))
		}

		// Search should be fast (log2(10000) ≈ 13 iterations)
		const start = performance.now()
		const result = Binary.search(parts, "part-05000", (p) => p.id)
		const elapsed = performance.now() - start

		expect(result.found).toBe(true)
		expect(elapsed).toBeLessThan(1) // Should be sub-millisecond
	})

	it("should handle insertion into large list efficiently", () => {
		// Create a large sorted array
		const parts: Part[] = []
		for (let i = 0; i < 1000; i++) {
			parts.push(createPart(`part-${String(i * 2).padStart(5, "0")}`, "msg-1"))
		}

		// Insert should be fast
		const start = performance.now()
		const newPart = createPart("part-00500", "msg-1")
		Binary.insert(parts, newPart, (p) => p.id)
		const elapsed = performance.now() - start

		expect(elapsed).toBeLessThan(5) // Binary search + splice should be fast
	})
})

describe("PartAtom.list Effect program", () => {
	it("fetches parts for a session", async () => {
		const parts = await Effect.runPromise(PartAtom.list("session-1"))

		expect(parts).toHaveLength(3)
		expect(parts[0]?.id).toBe("part-a")
		expect(parts[1]?.id).toBe("part-b")
		expect(parts[2]?.id).toBe("part-c")
	})

	it("sorts parts by ID (lexicographically)", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() =>
					Promise.resolve({
						data: [
							{
								info: { id: "msg-1", sessionID: "session-1" },
								parts: [createPart("part-z", "msg-1"), createPart("part-a", "msg-1")],
							},
							{
								info: { id: "msg-2", sessionID: "session-1" },
								parts: [createPart("part-m", "msg-2")],
							},
						],
					}),
				),
			},
		} as any)

		const parts = await Effect.runPromise(PartAtom.list("session-1"))

		expect(parts[0]?.id).toBe("part-a")
		expect(parts[1]?.id).toBe("part-m")
		expect(parts[2]?.id).toBe("part-z")
	})

	it("handles empty part list", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() => Promise.resolve({ data: [] })),
			},
		} as any)

		const parts = await Effect.runPromise(PartAtom.list("session-1"))

		expect(parts).toHaveLength(0)
	})

	it("handles messages with no parts", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() =>
					Promise.resolve({
						data: [
							{
								info: { id: "msg-1", sessionID: "session-1" },
								parts: [],
							},
						],
					}),
				),
			},
		} as any)

		const parts = await Effect.runPromise(PartAtom.list("session-1"))

		expect(parts).toHaveLength(0)
	})

	it("handles null/undefined data gracefully", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() => Promise.resolve({ data: null })),
			},
		} as any)

		const parts = await Effect.runPromise(PartAtom.list("session-1"))

		expect(parts).toHaveLength(0)
	})

	it("propagates errors through Effect error channel", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() => Promise.reject(new Error("Network error"))),
			},
		} as any)

		await expect(Effect.runPromise(PartAtom.list("session-1"))).rejects.toThrow(
			"Failed to fetch parts",
		)
	})
})

describe("PartAtom.get Effect program", () => {
	it("fetches single part by ID", async () => {
		const part = await Effect.runPromise(PartAtom.get("session-1", "part-b"))

		expect(part).not.toBeNull()
		expect(part?.id).toBe("part-b")
		expect(part?.messageID).toBe("msg-1")
	})

	it("returns null when part not found", async () => {
		const part = await Effect.runPromise(PartAtom.get("session-1", "part-nonexistent"))

		expect(part).toBeNull()
	})
})

describe("PartAtom session-based routing", () => {
	it("passes sessionId to createClient for list()", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() => Promise.resolve({ data: [] })),
			},
		} as any)

		await Effect.runPromise(PartAtom.list("ses_routing_test", "/test/project"))

		// Verify createClient was called with both directory AND sessionId
		expect(createClient).toHaveBeenCalledWith("/test/project", "ses_routing_test")
	})

	it("passes sessionId to createClient for get()", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() =>
					Promise.resolve({
						data: [
							{
								info: { id: "msg-1", sessionID: "ses_get_test" },
								parts: [createPart("part-test", "msg-1")],
							},
						],
					}),
				),
			},
		} as any)

		await Effect.runPromise(PartAtom.get("ses_get_test", "part-test", "/test/project"))

		// Verify createClient was called with both directory AND sessionId
		expect(createClient).toHaveBeenCalledWith("/test/project", "ses_get_test")
	})
})

describe("PartAtom composability", () => {
	it("can be composed with other Effect programs", async () => {
		const program = Effect.gen(function* () {
			const parts = yield* PartAtom.list("session-1")
			// Filter parts by type
			return parts.filter((p) => p.type === "text")
		})

		const filtered = await Effect.runPromise(program)

		// All test parts have type="text" by default
		expect(filtered).toHaveLength(3)
	})

	it("supports Effect error handling combinators", async () => {
		const { createClient } = await import("../client/index.js")

		vi.mocked(createClient).mockReturnValueOnce({
			session: {
				messages: vi.fn(() => Promise.reject(new Error("Network error"))),
			},
		} as any)

		// Use Effect.catchAll to provide fallback
		const program = PartAtom.list("session-1").pipe(
			Effect.catchAll(() => Effect.succeed([] as Part[])),
		)

		const parts = await Effect.runPromise(program)

		expect(parts).toHaveLength(0)
	})
})

describe("Part list operations", () => {
	it("should handle parts with ULID IDs (sortable)", () => {
		// ULIDs are lexicographically sortable by timestamp
		const parts: Part[] = [
			createPart("01ARZ3NDEKTSV4RRFFQ69G5FAV", "msg-1"), // Older
			createPart("01HZ3NDEKTSV4RRFFQ69G5FAV", "msg-1"), // Newer
		]

		// Binary search should work on ULID IDs
		const result = Binary.search(parts, "01ARZ3NDEKTSV4RRFFQ69G5FAV", (p) => p.id)
		expect(result.found).toBe(true)
		expect(result.index).toBe(0)
	})

	it("should maintain part immutability on insert", () => {
		const parts: Part[] = [createPart("part-a", "msg-1"), createPart("part-c", "msg-1")]

		const originalLength = parts.length
		const newPart = createPart("part-b", "msg-1")

		Binary.insert(parts, newPart, (p) => p.id)

		// Original array should be unchanged (immutable operation)
		expect(parts).toHaveLength(originalLength)
	})

	it("should handle parts with different messageIDs", () => {
		const parts: Part[] = [
			createPart("part-a", "msg-1"),
			createPart("part-b", "msg-2"),
			createPart("part-c", "msg-1"),
		]

		// Binary search by ID should work regardless of messageID
		const result = Binary.search(parts, "part-b", (p) => p.id)
		expect(result.found).toBe(true)
		expect(parts[result.index]?.messageID).toBe("msg-2")
	})

	it("should handle parts with different types", () => {
		const parts: Part[] = [
			createPart("part-a", "msg-1", "ses-1", "text"),
			createPart("part-b", "msg-1", "ses-1", "tool_call"),
			createPart("part-c", "msg-1", "ses-1", "compaction"),
		]

		// Binary search should work regardless of type
		const result = Binary.search(parts, "part-b", (p) => p.id)
		expect(result.found).toBe(true)
		expect(parts[result.index]?.type).toBe("tool_call")
	})
})

describe("Part filtering by session", () => {
	it("filters parts for a specific session via message lookup", async () => {
		// PartAtom.list already filters by session because it fetches
		// messages for a specific session
		const parts = await Effect.runPromise(PartAtom.list("session-1"))

		// All parts should belong to messages in session-1
		expect(parts).toHaveLength(3)
		expect(parts.every((p) => ["msg-1", "msg-2"].includes(p.messageID))).toBe(true)
	})
})
