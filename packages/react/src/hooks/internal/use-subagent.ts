/**
 * useSubagent - Component-level hook for accessing a specific part's subagent
 *
 * Wraps useSubagents (global state) and provides filtered view for a single part.
 * Returns subagent session, expansion state, and toggle action.
 *
 * @example
 * ```tsx
 * function ToolComponent({ part }: { part: Part }) {
 *   const { subagent, isExpanded, toggleExpanded, hasSubagent, isRunning } = useSubagent({
 *     partId: part.id
 *   })
 *
 *   if (!hasSubagent) return null
 *
 *   return (
 *     <div>
 *       <button onClick={toggleExpanded}>
 *         {isExpanded ? "Collapse" : "Expand"} Subagent
 *       </button>
 *       {isExpanded && <SubagentView session={subagent} />}
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useMemo, useCallback } from "react"
import type { SubagentSession } from "@opencode-vibe/core/api"
import { useSubagents } from "./use-subagents"

export interface UseSubagentOptions {
	partId: string
}

export interface UseSubagentReturn {
	/** The subagent session for this part, if one exists */
	subagent: SubagentSession | undefined
	/** Whether this part's subagent view is expanded */
	isExpanded: boolean
	/** Toggle expansion state for this part */
	toggleExpanded: () => void
	/** Whether this part has a subagent */
	hasSubagent: boolean
	/** Whether the subagent is currently running */
	isRunning: boolean
	/** Whether the subagent has completed */
	isCompleted: boolean
}

/**
 * Hook to access a specific part's subagent
 *
 * Filters global subagent state to return only data for the given partId.
 * Provides convenient derived values (hasSubagent, isRunning, isCompleted).
 *
 * @param options - Object with partId
 * @returns Subagent state and actions for this part
 */
export function useSubagent(options: UseSubagentOptions): UseSubagentReturn {
	const { partId } = options
	const { partToSession, sessions, expanded, actions } = useSubagents()

	// Get the subagent for this part
	const subagent = useMemo(() => {
		const sessionId = partToSession[partId]
		return sessionId ? sessions[sessionId] : undefined
	}, [partToSession, sessions, partId])

	// Check if expanded
	const isExpanded = expanded.has(partId)

	// Toggle expansion - stable reference
	const toggleExpanded = useCallback(() => {
		actions.toggleExpanded(partId)
	}, [actions, partId])

	// Derived values
	const hasSubagent = subagent !== undefined
	const isRunning = subagent?.status === "running"
	const isCompleted = subagent?.status === "completed"

	return {
		subagent,
		isExpanded,
		toggleExpanded,
		hasSubagent,
		isRunning,
		isCompleted,
	}
}
