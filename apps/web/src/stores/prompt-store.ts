/**
 * Zustand store for prompt input state management.
 * Handles rich text parts, file attachments, and autocomplete state.
 */

import { create } from "zustand"
import type { Prompt, SlashCommand } from "../types/prompt"

const DEFAULT_AUTOCOMPLETE = {
	visible: false as const,
	type: null as "file" | "command" | null,
	query: "",
	items: [] as string[] | SlashCommand[],
	selectedIndex: 0,
}

interface PromptState {
	parts: Prompt
	cursor: number
	autocomplete: {
		visible: boolean
		type: "file" | "command" | null
		query: string
		items: string[] | SlashCommand[]
		selectedIndex: number
	}

	// Actions
	setParts: (parts: Prompt, cursor?: number) => void
	insertFilePart: (path: string, atPosition: number, replaceLength: number) => void
	showAutocomplete: (type: "file" | "command", query: string) => void
	hideAutocomplete: () => void
	setAutocompleteItems: (items: string[] | SlashCommand[]) => void
	setAutocompleteIndex: (index: number) => void
	navigateAutocomplete: (direction: "up" | "down") => void
	reset: () => void
}

export const usePromptStore = create<PromptState>((set, get) => ({
	parts: [{ type: "text", content: "", start: 0, end: 0 }],
	cursor: 0,
	autocomplete: DEFAULT_AUTOCOMPLETE,

	setParts: (parts, cursor) =>
		set({
			parts,
			cursor: cursor ?? get().cursor,
		}),

	insertFilePart: (path, atPosition, replaceLength) => {
		const { parts } = get()
		const content = `@${path}`

		// Find the text part containing the cursor
		let charCount = 0
		const newParts: Prompt = []
		let newCursorPosition = atPosition

		for (const part of parts) {
			if (part.type === "image") {
				// Image parts don't have start/end positions
				newParts.push(part)
				continue
			}

			if (part.type === "file") {
				newParts.push(part)
				charCount += part.content.length
				continue
			}

			const partStart = charCount
			const partEnd = charCount + part.content.length

			if (atPosition >= partStart && atPosition <= partEnd) {
				// This is the part to split
				const localPos = atPosition - partStart
				const before = part.content.slice(0, localPos - replaceLength)
				const after = part.content.slice(localPos)

				if (before) {
					newParts.push({
						type: "text",
						content: before,
						start: partStart,
						end: partStart + before.length,
					})
				}

				newParts.push({
					type: "file",
					path,
					content,
					start: partStart + before.length,
					end: partStart + before.length + content.length,
				})

				if (after) {
					newParts.push({
						type: "text",
						content: " " + after,
						start: partStart + before.length + content.length,
						end: partStart + before.length + content.length + after.length + 1,
					})
				} else {
					newParts.push({
						type: "text",
						content: " ",
						start: partStart + before.length + content.length,
						end: partStart + before.length + content.length + 1,
					})
				}

				// Calculate new cursor position:
				// before.length + content.length + 1 (trailing space)
				newCursorPosition = partStart + before.length + content.length + 1
			} else {
				newParts.push(part)
			}

			charCount = partEnd
		}

		set({ parts: newParts, cursor: newCursorPosition })
	},

	showAutocomplete: (type, query) =>
		set({
			autocomplete: {
				visible: true,
				type,
				query,
				items: [],
				selectedIndex: 0,
			},
		}),

	hideAutocomplete: () =>
		set({
			autocomplete: DEFAULT_AUTOCOMPLETE,
		}),

	setAutocompleteItems: (items) =>
		set((state) => ({
			autocomplete: { ...state.autocomplete, items },
		})),

	setAutocompleteIndex: (index) =>
		set((state) => ({
			autocomplete: { ...state.autocomplete, selectedIndex: index },
		})),

	navigateAutocomplete: (direction) =>
		set((state) => ({
			autocomplete: {
				...state.autocomplete,
				selectedIndex:
					direction === "up"
						? Math.max(0, state.autocomplete.selectedIndex - 1)
						: Math.min(state.autocomplete.items.length - 1, state.autocomplete.selectedIndex + 1),
			},
		})),

	reset: () =>
		set({
			parts: [{ type: "text", content: "", start: 0, end: 0 }],
			cursor: 0,
			autocomplete: DEFAULT_AUTOCOMPLETE,
		}),
}))
