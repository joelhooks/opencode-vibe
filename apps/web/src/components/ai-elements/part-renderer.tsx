"use client"

import React from "react"
import type { Part } from "@/app/hooks"

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
			return <div className="text-sm whitespace-pre-wrap">{part.text}</div>
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
 *
 * EXCEPTION: Task tools need deep comparison of metadata.summary because
 * sub-agent activity updates the summary array while status stays "running".
 */
export const PartRenderer = React.memo(PartRendererInternal, (prevProps, nextProps) => {
	const prev = prevProps.part
	const next = nextProps.part

	// Fast path: Compare IDs
	if (prev.id !== next.id) return false

	// Fast path: Compare type
	if (prev.type !== next.type) return false

	// For text parts, compare text content
	if (prev.type === "text" && next.type === "text") {
		if (prev.text !== next.text) return false
	}

	// For tool parts, compare state
	if (prev.type === "tool" && next.type === "tool") {
		const prevState = (prev as any).state || {}
		const nextState = (next as any).state || {}

		if (prevState.status !== nextState.status) return false
		if (prevState.title !== nextState.title) return false

		const prevTool = (prev as any).tool
		const nextTool = (next as any).tool
		if (prevTool !== nextTool) return false

		// Task tools: Compare metadata.summary for sub-agent activity updates
		if (prevTool === "task" && nextTool === "task") {
			// Extract metadata safely - only non-pending states have metadata
			const prevMetadata =
				prevState.status !== "pending"
					? (prevState.metadata as
							| { summary?: Array<{ id: string; state: { status: string } }> }
							| undefined)
					: undefined
			const nextMetadata =
				nextState.status !== "pending"
					? (nextState.metadata as
							| { summary?: Array<{ id: string; state: { status: string } }> }
							| undefined)
					: undefined

			const prevSummary = prevMetadata?.summary
			const nextSummary = nextMetadata?.summary

			// Both undefined/null - equal
			if (!prevSummary && !nextSummary) return true

			// One undefined, one defined - not equal
			if (!prevSummary || !nextSummary) return false

			// Different lengths - not equal
			if (prevSummary.length !== nextSummary.length) return false

			// Compare summary item count and last item status (common case)
			// Catches new tools being added AND status changes of existing tools
			const prevLast = prevSummary[prevSummary.length - 1]
			const nextLast = nextSummary[nextSummary.length - 1]

			return prevLast?.id === nextLast?.id && prevLast?.state.status === nextLast?.state.status
		}
	}

	// All checks passed - equal
	return true
})
