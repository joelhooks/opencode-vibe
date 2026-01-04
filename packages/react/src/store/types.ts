/**
 * Type definitions for Zustand store
 *
 * Matches DirectoryState pattern from ADR-010.
 * Each directory has isolated state with sessions, messages, parts, todos, etc.
 */

import type { SessionStatus, GlobalEvent, Part, Message } from "@opencode-vibe/core/types"

/**
 * Session type matching OpenCode API
 */
export type Session = {
	id: string
	title: string
	directory: string
	parentID?: string
	time: {
		created: number
		updated: number
		archived?: number
	}
}

/**
 * Todo type for session tasks
 */
export type Todo = {
	id: string
	sessionID: string
	content: string
	completed: boolean
}

/**
 * File diff type for session changes
 */
export type FileDiff = {
	path: string
	additions: number
	deletions: number
}

/**
 * Context usage for a session
 */
export type ContextUsage = {
	used: number
	limit: number
	percentage: number
	isNearLimit: boolean
	tokens: {
		input: number
		output: number
		cached: number
	}
	lastUpdated: number
}

/**
 * Compaction state for a session
 */
export type CompactionState = {
	isCompacting: boolean
	isAutomatic: boolean
	startedAt: number
	messageId?: string
	progress: "pending" | "generating" | "complete"
}

/**
 * Directory-scoped state
 */
export interface DirectoryState {
	ready: boolean
	sessions: Session[]
	todos: Record<string, Todo[]>
	messages: Record<string, Message[]>
	parts: Record<string, Part[]>
	modelLimits: Record<string, { context: number; output: number }>
}

// Re-export canonical types from core (used in DirectoryState above)
export type { SessionStatus, GlobalEvent, Part, Message }
