/**
 * Unit tests for binary search utilities
 *
 * Tests Binary.search and Binary.insert for O(log n) operations on sorted arrays.
 * Used by Zustand store for efficient session/message updates.
 */

import { describe, test, expect } from "bun:test"
import { Binary } from "./binary"

describe("Binary.search", () => {
	test("finds existing item in array", () => {
		const array = [{ id: "a" }, { id: "c" }, { id: "e" }]
		const result = Binary.search(array, "c", (item) => item.id)

		expect(result.found).toBe(true)
		expect(result.index).toBe(1)
	})

	test("returns insertion index for missing item", () => {
		const array = [{ id: "a" }, { id: "c" }, { id: "e" }]
		const result = Binary.search(array, "d", (item) => item.id)

		expect(result.found).toBe(false)
		expect(result.index).toBe(2) // Should insert between 'c' and 'e'
	})

	test("handles empty array", () => {
		const array: { id: string }[] = []
		const result = Binary.search(array, "a", (item) => item.id)

		expect(result.found).toBe(false)
		expect(result.index).toBe(0)
	})

	test("returns insertion index at start", () => {
		const array = [{ id: "b" }, { id: "c" }]
		const result = Binary.search(array, "a", (item) => item.id)

		expect(result.found).toBe(false)
		expect(result.index).toBe(0)
	})

	test("returns insertion index at end", () => {
		const array = [{ id: "a" }, { id: "b" }]
		const result = Binary.search(array, "z", (item) => item.id)

		expect(result.found).toBe(false)
		expect(result.index).toBe(2)
	})

	test("finds item in single-element array", () => {
		const array = [{ id: "x" }]
		const result = Binary.search(array, "x", (item) => item.id)

		expect(result.found).toBe(true)
		expect(result.index).toBe(0)
	})

	test("works with ULID-style IDs (lexicographic sort)", () => {
		const array = [{ id: "01HQVXK9T2ABC" }, { id: "01HQVXK9T3XYZ" }, { id: "01HQVXK9T5MNO" }]
		const result = Binary.search(array, "01HQVXK9T3XYZ", (item) => item.id)

		expect(result.found).toBe(true)
		expect(result.index).toBe(1)
	})
})

describe("Binary.insert", () => {
	test("inserts item in correct position", () => {
		const array = [{ id: "a" }, { id: "c" }]
		const result = Binary.insert(array, { id: "b" }, (item) => item.id)

		expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }])
	})

	test("inserts into empty array", () => {
		const array: { id: string }[] = []
		const result = Binary.insert(array, { id: "x" }, (item) => item.id)

		expect(result).toEqual([{ id: "x" }])
	})

	test("inserts at start", () => {
		const array = [{ id: "b" }, { id: "c" }]
		const result = Binary.insert(array, { id: "a" }, (item) => item.id)

		expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }])
	})

	test("inserts at end", () => {
		const array = [{ id: "a" }, { id: "b" }]
		const result = Binary.insert(array, { id: "z" }, (item) => item.id)

		expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "z" }])
	})

	test("returns new array (immutable)", () => {
		const array = [{ id: "a" }, { id: "c" }]
		const result = Binary.insert(array, { id: "b" }, (item) => item.id)

		expect(result).not.toBe(array) // Different reference
		expect(array).toEqual([{ id: "a" }, { id: "c" }]) // Original unchanged
	})

	test("handles duplicate IDs (inserts at first occurrence)", () => {
		const array = [{ id: "a" }, { id: "c" }, { id: "c" }]
		const result = Binary.insert(array, { id: "c" }, (item) => item.id)

		// Should insert at leftmost position for 'c'
		expect(result[1].id).toBe("c")
		expect(result.length).toBe(4)
	})

	test("maintains sort order with complex IDs", () => {
		const array = [{ id: "01HQVXK9T2ABC" }, { id: "01HQVXK9T5MNO" }]
		const result = Binary.insert(array, { id: "01HQVXK9T3XYZ" }, (item) => item.id)

		expect(result).toEqual([
			{ id: "01HQVXK9T2ABC" },
			{ id: "01HQVXK9T3XYZ" },
			{ id: "01HQVXK9T5MNO" },
		])
	})
})
