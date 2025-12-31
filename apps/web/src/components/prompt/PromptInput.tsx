/**
 * PromptInput - Main rich text input component with @ and / autocomplete.
 *
 * Integrates Wave 2 work:
 * - usePromptStore for state management
 * - parseFromDOM/renderPartsToDOM for DOM <-> parts conversion
 * - detectAtTrigger/detectSlashTrigger for autocomplete detection
 * - useFileSearch for @ autocomplete
 * - useCommands for / autocomplete
 * - Autocomplete component for dropdown UI
 * - FilePill component for file rendering
 *
 * Key features:
 * - contenteditable div for rich text
 * - @ trigger shows file autocomplete
 * - / trigger at line start shows slash commands
 * - Arrow keys navigate autocomplete
 * - Enter/Tab select autocomplete
 * - Enter (no autocomplete) submits
 * - Escape closes autocomplete
 * - File pills are non-editable inline elements
 */

"use client"

import { useRef, useEffect, useCallback, type KeyboardEvent, useState } from "react"
import { CornerDownLeftIcon, Loader2Icon } from "lucide-react"
import { usePromptStore } from "@/stores/prompt-store"
import {
	parseFromDOM,
	renderPartsToDOM,
	getCursorPosition,
	setCursorPosition,
	detectAtTrigger,
	detectSlashTrigger,
} from "@opencode-vibe/core/utils"
import { useFileSearch, useCommands } from "@opencode-vibe/react"
import { Autocomplete } from "./Autocomplete"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Prompt, SlashCommand } from "@/types/prompt"

export interface PromptInputProps {
	/** Session ID for context */
	sessionId?: string
	/** Callback when user submits (Enter key) */
	onSubmit?: (parts: Prompt) => void
	/** Placeholder text */
	placeholder?: string
	/** Disable input */
	disabled?: boolean
	/** Loading state - shows spinner on submit button */
	isLoading?: boolean
	/** Number of messages queued (shows badge when > 0) */
	queueLength?: number
	/** Additional class names */
	className?: string
}

/**
 * Main prompt input component with autocomplete
 */
export function PromptInput({
	sessionId,
	onSubmit,
	placeholder,
	disabled,
	isLoading,
	queueLength = 0,
	className,
}: PromptInputProps) {
	const editorRef = useRef<HTMLDivElement>(null)
	const [hasContent, setHasContent] = useState(false)

	// Store state
	const {
		parts,
		cursor,
		autocomplete,
		setParts,
		showAutocomplete,
		hideAutocomplete,
		setAutocompleteItems,
		setAutocompleteIndex,
		navigateAutocomplete,
		insertFilePart,
		reset,
	} = usePromptStore()

	// Hooks for autocomplete data
	const { files, isLoading: isFileSearchLoading } = useFileSearch(
		autocomplete.type === "file" ? autocomplete.query : "",
	)
	const { getSlashCommands } = useCommands()

	// Update autocomplete items when data changes
	useEffect(() => {
		if (autocomplete.type === "file") {
			setAutocompleteItems(files)
		} else if (autocomplete.type === "command") {
			const commands = getSlashCommands()
			// Filter by query
			const filtered = commands.filter((cmd) => cmd.trigger?.startsWith(autocomplete.query))
			// Cast to app's SlashCommand type (structurally identical)
			setAutocompleteItems(filtered as SlashCommand[])
		}
	}, [autocomplete.type, autocomplete.query, files, getSlashCommands, setAutocompleteItems])

	// Render parts to DOM when store changes
	useEffect(() => {
		if (!editorRef.current) return

		// Only re-render if DOM doesn't match store
		const currentParts = parseFromDOM(editorRef.current)
		const partsMatch =
			currentParts.length === parts.length &&
			currentParts.every((part, i) => {
				const storePart = parts[i]
				if (!storePart) return false
				if (part.type !== storePart.type) return false
				if (part.type === "text" && storePart.type === "text") {
					return part.content === storePart.content
				}
				if (part.type === "file" && storePart.type === "file") {
					return part.path === storePart.path && part.content === storePart.content
				}
				if (part.type === "image" && storePart.type === "image") {
					return part.id === storePart.id
				}
				return false
			})

		if (!partsMatch) {
			renderPartsToDOM(editorRef.current, parts)
			setCursorPosition(editorRef.current, cursor)
		}
	}, [parts, cursor])

	/**
	 * Handle input event - parse DOM and detect triggers
	 */
	const handleInput = useCallback(() => {
		if (!editorRef.current) return

		// Parse DOM to get updated parts
		const newParts = parseFromDOM(editorRef.current)
		const cursorPos = getCursorPosition(editorRef.current)

		// Update store
		setParts(newParts, cursorPos)

		// Track if there's content for submit button state
		const contentExists = newParts.some((p) => {
			if (p.type === "text") return p.content.trim().length > 0
			if (p.type === "file") return true
			if (p.type === "image") return true
			return false
		})
		setHasContent(contentExists)

		// Detect triggers for autocomplete
		// Get full text content for trigger detection
		const text = newParts
			.map((p) => {
				if (p.type === "text") return p.content
				if (p.type === "file") return p.content
				return ""
			})
			.join("")

		// Check for @ trigger (file autocomplete)
		const atResult = detectAtTrigger(text, cursorPos)
		if (atResult.match) {
			showAutocomplete("file", atResult.query)
			return
		}

		// Check for / trigger (slash commands) - only at line start
		const slashResult = detectSlashTrigger(text)
		if (slashResult.match) {
			showAutocomplete("command", slashResult.query)
			return
		}

		// No triggers, hide autocomplete
		hideAutocomplete()
	}, [setParts, showAutocomplete, hideAutocomplete])

	/**
	 * Handle autocomplete selection
	 */
	const selectAutocompleteItem = useCallback(() => {
		if (!autocomplete.visible || autocomplete.items.length === 0) return
		if (!editorRef.current) return

		const item = autocomplete.items[autocomplete.selectedIndex]

		if (autocomplete.type === "file" && typeof item === "string") {
			// Insert file part
			const path = item
			const cursorPos = getCursorPosition(editorRef.current)
			const replaceLength = autocomplete.query.length + 1 // +1 for @

			insertFilePart(path, cursorPos, replaceLength)

			// Wait for DOM update, then hide autocomplete and focus
			requestAnimationFrame(() => {
				hideAutocomplete()
				if (editorRef.current) {
					const newCursorPos = cursorPos - replaceLength + `@${path}`.length + 1
					setCursorPosition(editorRef.current, newCursorPos)
					editorRef.current.focus()
				}
			})
		} else if (autocomplete.type === "command" && typeof item === "object" && "trigger" in item) {
			// Replace slash command trigger with selected command
			const cmd = item as SlashCommand
			const text = parts
				.map((p) => {
					if (p.type === "text") return p.content
					if (p.type === "file") return p.content
					return ""
				})
				.join("")
			const newText = text.replace(`/${autocomplete.query}`, `/${cmd.trigger} `)

			setParts([{ type: "text", content: newText, start: 0, end: newText.length }])

			// Wait for DOM update, then hide autocomplete and focus
			requestAnimationFrame(() => {
				hideAutocomplete()
				if (editorRef.current) {
					setCursorPosition(editorRef.current, newText.length)
					editorRef.current.focus()
				}
			})
		}
	}, [autocomplete, parts, insertFilePart, hideAutocomplete, setParts])

	/**
	 * Handle keyboard events
	 */
	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			// If autocomplete is visible, handle navigation and selection
			if (autocomplete.visible) {
				if (e.key === "ArrowDown") {
					e.preventDefault()
					navigateAutocomplete("down")
					return
				}
				if (e.key === "ArrowUp") {
					e.preventDefault()
					navigateAutocomplete("up")
					return
				}
				if (e.key === "Enter" || e.key === "Tab") {
					e.preventDefault()
					selectAutocompleteItem()
					return
				}
				if (e.key === "Escape") {
					e.preventDefault()
					hideAutocomplete()
					return
				}
			}

			// Handle submit (Enter without Shift)
			if (e.key === "Enter" && !e.shiftKey && !autocomplete.visible) {
				e.preventDefault()

				// Submit if not empty
				const canSubmit = parts.some((p) => {
					if (p.type === "text") return p.content.trim().length > 0
					if (p.type === "file") return true
					return false
				})

				if (canSubmit && onSubmit) {
					onSubmit(parts)
					reset()
					setHasContent(false)

					// Clear DOM
					if (editorRef.current) {
						editorRef.current.innerHTML = ""
					}
				}
			}
		},
		[
			autocomplete,
			parts,
			navigateAutocomplete,
			selectAutocompleteItem,
			hideAutocomplete,
			onSubmit,
			reset,
		],
	)

	/**
	 * Handle submit button click
	 */
	const handleSubmit = useCallback(() => {
		if (!hasContent || disabled || isLoading) return

		if (onSubmit) {
			onSubmit(parts)
			reset()
			setHasContent(false)

			// Clear DOM
			if (editorRef.current) {
				editorRef.current.innerHTML = ""
			}
		}
	}, [hasContent, disabled, isLoading, onSubmit, parts, reset])

	return (
		<div className={cn("relative w-full", className)}>
			<Autocomplete
				type={autocomplete.type}
				items={autocomplete.items}
				selectedIndex={autocomplete.selectedIndex}
				visible={autocomplete.visible}
				isLoading={autocomplete.type === "file" && isFileSearchLoading}
				onSelect={(item) => {
					// Set selected index and trigger selection
					const index = autocomplete.items.findIndex((i) => {
						if (typeof i === "string" && typeof item === "string") return i === item
						if (typeof i === "object" && typeof item === "object") return i.id === item.id
						return false
					})
					if (index !== -1) {
						setAutocompleteIndex(index)
						selectAutocompleteItem()
					}
				}}
			/>

			<div
				className={cn(
					"group/input relative flex w-full flex-col rounded-lg border border-input shadow-sm",
					"bg-[var(--popover)]", // Match code block background
					"transition-[border-color,box-shadow] duration-200",
					"focus-within:ring-1 focus-within:ring-ring",
					disabled && "opacity-50 cursor-not-allowed",
				)}
			>
				{/* biome-ignore lint/a11y/useSemanticElements: contenteditable div is required for rich text input with inline file pills */}
				<div
					ref={editorRef}
					contentEditable={!disabled}
					suppressContentEditableWarning
					onInput={handleInput}
					onKeyDown={handleKeyDown}
					data-placeholder={placeholder}
					tabIndex={0}
					aria-label={placeholder || "Enter your prompt"}
					aria-multiline="true"
					role="textbox"
					className={cn(
						"min-h-[80px] max-h-48 overflow-y-auto px-3 py-3 text-sm",
						"focus:outline-none",
						"empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none",
						disabled && "pointer-events-none",
					)}
				/>

				{/* Footer with submit button and queue indicator */}
				<div className="flex items-center justify-between px-3 pb-3">
					{/* Queue indicator - only show when messages are queued */}
					{queueLength > 0 && (
						<output
							className="flex items-center gap-1.5 text-xs text-muted-foreground"
							aria-live="polite"
						>
							<span
								className="size-1.5 rounded-full bg-yellow-500 animate-pulse"
								aria-hidden="true"
							/>
							<span>
								{queueLength} message{queueLength === 1 ? "" : "s"} queued
							</span>
						</output>
					)}
					<div className="flex-1" />
					<Button
						type="button"
						size="icon"
						variant={hasContent ? "default" : "ghost"}
						className="size-8 shrink-0"
						disabled={!hasContent || disabled || isLoading}
						onClick={handleSubmit}
						aria-label="Send message"
					>
						{isLoading ? (
							<Loader2Icon className="size-4 animate-spin" />
						) : (
							<CornerDownLeftIcon className="size-4" />
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}
