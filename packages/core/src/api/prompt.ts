/**
 * Prompt API - Utility functions
 *
 * Re-export of PromptUtil for consistency with other API modules.
 * PromptUtil contains pure functions (no Effect programs).
 *
 * @module api/prompt
 */

import { PromptUtil } from "../atoms/prompt.js"
import type { Prompt, SlashCommand } from "../types/prompt.js"
import type { AutocompleteState } from "../atoms/prompt.js"

/**
 * Prompt API namespace
 *
 * Pure utility functions for prompt operations.
 */
export const prompt = {
	/**
	 * Insert a file part into a prompt at a specific position
	 *
	 * @param parts - Current prompt parts
	 * @param path - File path to insert
	 * @param atPosition - Character position to insert at
	 * @param replaceLength - Number of characters to replace (for autocomplete)
	 * @returns New parts array with file inserted and new cursor position
	 */
	insertFilePart: PromptUtil.insertFilePart,

	/**
	 * Navigate autocomplete selection up or down
	 *
	 * @param currentIndex - Current selected index
	 * @param direction - "up" or "down"
	 * @param itemsLength - Total number of items
	 * @returns New selected index
	 */
	navigateAutocomplete: PromptUtil.navigateAutocomplete,
}

// Export types for consumers
export type { Prompt, SlashCommand, AutocompleteState }
