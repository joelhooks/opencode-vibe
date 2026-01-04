"use client"

import React from "react"
import type { SubagentSession } from "@/stores/subagent-store"
import { PartRenderer } from "./part-renderer"
import { Loader2 } from "lucide-react"

export type SubagentViewProps = {
	subagent: SubagentSession
}

/**
 * Renders full child session content for a subagent.
 *
 * Displays:
 * - Header with agent name and status indicator (sticky)
 * - Messages and their parts (assistant messages only)
 * - Running indicator when subagent is active
 *
 * Max height of 400px with vertical scroll for long sessions.
 *
 * @param subagent - SubagentSession from store with messages, parts, status
 */
const SubagentViewInternal = ({ subagent }: SubagentViewProps) => {
	return (
		<div className="border-t border-border bg-background max-h-[400px] overflow-y-auto">
			<div className="flex items-center justify-between p-2 bg-muted/50 border-b border-border sticky top-0">
				<span className="font-medium text-primary">@{subagent.agentName}</span>
				<StatusIndicator status={subagent.status} />
			</div>

			<div className="p-3 space-y-2">
				{subagent.messages.map((message) => (
					<div key={message.id}>
						{message.role === "assistant" && (
							<div className="space-y-2">
								{(subagent.parts[message.id] || []).map((part) => (
									<PartRenderer key={part.id} part={part} />
								))}
							</div>
						)}
					</div>
				))}
			</div>

			{subagent.status === "running" && (
				<div className="flex items-center justify-center gap-2 p-4 text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>Working...</span>
				</div>
			)}
		</div>
	)
}

/**
 * Status indicator badge for subagent.
 *
 * Shows:
 * - Running: Blue text with pulse animation
 * - Completed: Green text
 * - Error: Red text
 *
 * @param status - Current subagent status
 */
function StatusIndicator({ status }: { status: string }) {
	if (status === "running") {
		return <span className="text-xs text-blue-500 animate-pulse">Running</span>
	}
	if (status === "completed") {
		return <span className="text-xs text-green-500">Completed</span>
	}
	if (status === "error") {
		return <span className="text-xs text-red-500">Error</span>
	}
	return null
}

/**
 * Memoized version with content-aware comparison.
 *
 * Problem: Immer creates new object references on every store update,
 * breaking React.memo shallow comparison even when content is identical.
 *
 * Solution: Deep compare subagent content (id, status, messages, parts)
 * instead of reference equality.
 */
export const SubagentView = React.memo(SubagentViewInternal, (prevProps, nextProps) => {
	const prev = prevProps.subagent
	const next = nextProps.subagent

	// Fast path: Compare IDs
	if (prev.id !== next.id) return false

	// Fast path: Compare status
	if (prev.status !== next.status) return false

	// Fast path: Compare agent name
	if (prev.agentName !== next.agentName) return false

	// Compare messages array length
	if (prev.messages.length !== next.messages.length) return false

	// Compare message IDs (shallow - just check if same messages exist)
	const prevMessageIds = prev.messages.map((m) => m.id).join(",")
	const nextMessageIds = next.messages.map((m) => m.id).join(",")
	if (prevMessageIds !== nextMessageIds) return false

	// Compare parts by checking keys and part counts
	const prevPartKeys = Object.keys(prev.parts).sort().join(",")
	const nextPartKeys = Object.keys(next.parts).sort().join(",")
	if (prevPartKeys !== nextPartKeys) return false

	// For each message, compare part counts and IDs
	for (const messageId of Object.keys(prev.parts)) {
		const prevParts = prev.parts[messageId] || []
		const nextParts = next.parts[messageId] || []

		if (prevParts.length !== nextParts.length) return false

		// Compare part IDs, types, and state
		for (let i = 0; i < prevParts.length; i++) {
			const prevPart = prevParts[i]
			const nextPart = nextParts[i]
			if (!prevPart || !nextPart) return false
			if (prevPart.id !== nextPart.id) return false
			if (prevPart.type !== nextPart.type) return false

			// For text parts, compare text content
			if (prevPart.type === "text" && nextPart.type === "text") {
				if (prevPart.text !== nextPart.text) return false
			}

			// For tool parts, compare state to detect updates
			if (prevPart.type === "tool" && nextPart.type === "tool") {
				// Compare state.status (all tools have this)
				if (prevPart.state?.status !== nextPart.state?.status) return false

				// Task tools: Compare metadata.summary for sub-agent activity updates
				if (prevPart.tool === "task" && nextPart.tool === "task") {
					// Extract metadata safely - check if state exists
					const prevMetadata = prevPart.state?.metadata as
						| { summary?: Array<{ id: string; state: { status: string } }> }
						| undefined
					const nextMetadata = nextPart.state?.metadata as
						| { summary?: Array<{ id: string; state: { status: string } }> }
						| undefined

					const prevSummary = prevMetadata?.summary
					const nextSummary = nextMetadata?.summary

					// Both undefined/null - equal
					if (!prevSummary && !nextSummary) continue

					// One undefined, one defined - not equal
					if (!prevSummary || !nextSummary) return false

					// Different lengths - not equal
					if (prevSummary.length !== nextSummary.length) return false

					// Compare last item status (common case - new items or status change)
					// Full deep comparison handled by SubagentCurrentActivity's own memo
					const prevLast = prevSummary[prevSummary.length - 1]
					const nextLast = nextSummary[nextSummary.length - 1]

					if (prevLast?.id !== nextLast?.id || prevLast?.state.status !== nextLast?.state.status) {
						return false
					}
				}
			}
		}
	}

	// All checks passed - equal
	return true
})
