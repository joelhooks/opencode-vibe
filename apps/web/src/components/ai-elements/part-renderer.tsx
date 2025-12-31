"use client"

import React from "react"
import type { Part } from "@opencode-vibe/react"

export type PartRendererProps = {
	part: Part
}

/**
 * Renders individual message parts based on type.
 *
 * Handles:
 * - text: Plain text content with whitespace preservation
 * - tool: Tool execution status with icon, name, and title
 * - unknown: Null render (graceful degradation)
 *
 * @param part - Part from store with type, content, and metadata
 */
const PartRendererInternal = ({ part }: PartRendererProps) => {
	switch (part.type) {
		case "text":
			return <div className="text-sm whitespace-pre-wrap">{part.content}</div>
		case "tool":
			return <ToolPartView part={part} />
		default:
			return null
	}
}

/**
 * Maps tool status to Unicode icon.
 * ✓ = completed
 * ⏳ = running
 * ◯ = pending/error
 */
function getStatusIcon(status: string): string {
	const icons: Record<string, string> = {
		completed: "✓",
		running: "⏳",
		pending: "◯",
		error: "◯", // error uses same icon as pending
	}
	return icons[status] || "◯"
}

/**
 * Renders tool execution part with status indicator and metadata.
 *
 * Shows:
 * - Status icon (✓/⏳/◯)
 * - Tool name (monospace)
 * - Title if available (from state.title)
 *
 * Running tools have animate-pulse on the icon.
 */
function ToolPartView({ part }: { part: Part }) {
	// Extract tool metadata
	const toolName = (part as any).tool || "unknown"
	const state = (part as any).state || {}
	const status = state.status || "pending"
	const title = state.title

	const icon = getStatusIcon(status)
	const isRunning = status === "running"

	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/30 rounded">
			<span className={isRunning ? "animate-pulse" : ""}>{icon}</span>
			<span className="font-mono">{toolName}</span>
			{title && <span className="text-foreground">{title}</span>}
		</div>
	)
}

/**
 * Memoized version with content-aware comparison.
 *
 * Problem: Immer creates new object references on every store update,
 * breaking React.memo shallow comparison even when content is identical.
 *
 * Solution: Deep compare part content (id, type, content, state) instead
 * of reference equality.
 */
export const PartRenderer = React.memo(PartRendererInternal, (prevProps, nextProps) => {
	const prev = prevProps.part
	const next = nextProps.part

	// Fast path: Compare IDs
	if (prev.id !== next.id) return false

	// Fast path: Compare type
	if (prev.type !== next.type) return false

	// Fast path: Compare content
	if (prev.content !== next.content) return false

	// For tool parts, compare state
	if (prev.type === "tool" && next.type === "tool") {
		const prevState = (prev as any).state || {}
		const nextState = (next as any).state || {}

		if (prevState.status !== nextState.status) return false
		if (prevState.title !== nextState.title) return false

		const prevTool = (prev as any).tool
		const nextTool = (next as any).tool
		if (prevTool !== nextTool) return false
	}

	// All checks passed - equal
	return true
})
