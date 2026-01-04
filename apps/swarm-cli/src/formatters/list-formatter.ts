/**
 * List output formatter
 *
 * Formats hierarchical project→session display for CLI output
 */

import chalk from "chalk"
import { formatRelativeTime } from "@opencode-vibe/core/utils"
import type { EnrichedSession } from "@opencode-vibe/core/world"

/**
 * Session with hierarchy metadata (children and depth)
 */
export interface HierarchicalSession extends EnrichedSession {
	children?: HierarchicalSession[]
	depth?: number
}

/**
 * Project group with sessions
 */
export interface ProjectGroup {
	directory: string
	sessions: HierarchicalSession[]
	lastActivity: Date
	activeCount: number
}

/**
 * Format context usage as percentage
 *
 * @param session - Session with potential token data
 * @returns Percentage string (e.g., "45%") or "--" if data missing
 */
export function formatContextUsage(session: EnrichedSession): string {
	// Type guard: check if tokens exist and have required properties
	const tokens = session.tokens as { input: number; output: number } | undefined
	const model = session.model as { limits?: { context: number; output: number } } | undefined
	const contextLimit = model?.limits?.context

	// Guard: missing data
	if (!tokens || !contextLimit || contextLimit === 0) {
		return "--"
	}

	const totalTokens = tokens.input + tokens.output
	const percentage = Math.round((totalTokens / contextLimit) * 100)

	return `${percentage}%`
}

/**
 * Determine if session is active based on backend status
 *
 * @param session - Session to check
 * @returns True if session status is running or pending
 */
function isActiveSession(session: EnrichedSession): boolean {
	return session.status === "running" || session.status === "pending"
}

/**
 * Format a session row
 *
 * Format: 🟢/⚪ title relativeTime contextPct%
 *
 * @param session - Session to format
 * @param depth - Nesting depth for indentation (default 0)
 * @returns Formatted session row with columns aligned
 */
export function formatSessionRow(session: HierarchicalSession, depth = 0): string {
	// Indicator: 🟢 active, ⚪ inactive
	const indicator = isActiveSession(session) ? "🟢" : "⚪"

	// Tree prefix for hierarchical display (adds visual nesting)
	const treePrefix = depth > 0 ? "└─ " : ""

	// Title: truncate to 30 chars with ellipsis
	const maxTitleLength = 30
	let title = session.title
	if (title.length > maxTitleLength) {
		title = `${title.slice(0, maxTitleLength - 3)}...`
	}
	const titlePadded = title.padEnd(maxTitleLength, " ")

	// Relative time (right-aligned in 8 chars)
	const relativeTime = formatRelativeTime(session.time.updated)
	const timePadded = relativeTime.padStart(8, " ")

	// Context usage (right-aligned in 5 chars)
	const usage = formatContextUsage(session)
	const usagePadded = usage.padStart(5, " ")

	// Indent: base 3 spaces + 3 per depth level
	const indent = "   " + "   ".repeat(depth)

	return `${indent}${treePrefix}${indicator} ${titlePadded} ${timePadded}   ${usagePadded}`
}

/**
 * Format project header
 *
 * Format: 📁 path (N active)
 *
 * @param group - Project group with sessions
 * @returns Formatted project header line
 */
export function formatProjectHeader(group: ProjectGroup): string {
	return `📁 ${group.directory} ${chalk.dim(`(${group.activeCount} active)`)}`
}

/**
 * Format complete project list
 *
 * Groups projects with their sessions, separated by blank lines
 *
 * @param groups - Array of project groups
 * @returns Formatted multi-line string
 */
export function formatProjectList(groups: ProjectGroup[]): string {
	if (groups.length === 0) {
		return ""
	}

	const sections: string[] = []

	for (const group of groups) {
		// Project header
		sections.push(formatProjectHeader(group))

		// Session rows (hierarchical, with recursion for children)
		for (const session of group.sessions) {
			renderSessionHierarchy(session, sections)
		}
	}

	// Join with blank lines between projects
	// Find indices where new project starts (lines starting with 📁)
	const output: string[] = []
	for (let i = 0; i < sections.length; i++) {
		const current = sections[i]
		const next = sections[i + 1]
		if (current !== undefined) {
			output.push(current)
		}
		// Add blank line after last session of a project (before next project header)
		if (next !== undefined && next.startsWith("📁")) {
			output.push("")
		}
	}

	return output.join("\n")
}

/**
 * Recursively render session and its children
 *
 * @param session - Session to render (with potential children)
 * @param output - Array to append formatted lines to
 */
function renderSessionHierarchy(session: HierarchicalSession, output: string[]): void {
	const depth = session.depth ?? 0

	// Render current session
	output.push(formatSessionRow(session, depth))

	// Recursively render children if they exist
	if (session.children && session.children.length > 0) {
		for (const child of session.children) {
			renderSessionHierarchy(child, output)
		}
	}
}
