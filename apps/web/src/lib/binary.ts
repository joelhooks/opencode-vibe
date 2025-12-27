/**
 * Binary search utilities for O(log n) operations on sorted arrays
 *
 * CRITICAL: OpenCode arrays are sorted by ID (lexicographic).
 * Use these utilities for efficient session/message updates in Zustand store.
 */

export namespace Binary {
	/**
	 * Binary search for an item by ID in a sorted array
	 *
	 * @param array - Sorted array to search
	 * @param id - ID to search for
	 * @param compare - Function to extract ID from array items
	 * @returns Object with `found` boolean and `index` (item position if found, insertion index if not)
	 *
	 * @example
	 * const sessions = [{ id: "a" }, { id: "c" }, { id: "e" }]
	 * Binary.search(sessions, "c", s => s.id) // { found: true, index: 1 }
	 * Binary.search(sessions, "d", s => s.id) // { found: false, index: 2 }
	 */
	export function search<T>(
		array: T[],
		id: string,
		compare: (item: T) => string,
	): { found: boolean; index: number } {
		let left = 0
		let right = array.length - 1

		while (left <= right) {
			const mid = Math.floor((left + right) / 2)
			const midId = compare(array[mid])

			if (midId === id) {
				return { found: true, index: mid }
			}
			if (midId < id) {
				left = mid + 1
			} else {
				right = mid - 1
			}
		}

		return { found: false, index: left }
	}

	/**
	 * Insert an item into a sorted array at the correct position
	 *
	 * @param array - Sorted array to insert into
	 * @param item - Item to insert
	 * @param compare - Function to extract ID from array items
	 * @returns New array with item inserted (immutable operation)
	 *
	 * @example
	 * const sessions = [{ id: "a" }, { id: "c" }]
	 * Binary.insert(sessions, { id: "b" }, s => s.id)
	 * // Returns: [{ id: "a" }, { id: "b" }, { id: "c" }]
	 */
	export function insert<T>(array: T[], item: T, compare: (item: T) => string): T[] {
		const id = compare(item)
		let left = 0
		let right = array.length

		while (left < right) {
			const mid = Math.floor((left + right) / 2)
			const midId = compare(array[mid])

			if (midId < id) {
				left = mid + 1
			} else {
				right = mid
			}
		}

		const result = [...array]
		result.splice(left, 0, item)
		return result
	}
}
