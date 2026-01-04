/**
 * Domain types for OpenCode entities
 *
 * These are LOOSE types compatible with Effect Schema types.
 * Effect Schema validates structure; these provide wider compatibility.
 */

import type {
	SessionInfo as SSESessionInfo,
	MessageInfo as SSEMessageInfo,
	Part as SSEPart,
} from "../sse/schemas.js"

/**
 * Session - Compatible with Effect Schema SessionInfo
 */
export type Session = SSESessionInfo

/**
 * Message - Domain type with typed refinements
 *
 * Compatible with Effect Schema MessageInfo but provides typed access to
 * `tokens` and `model` fields (which are `unknown` in MessageInfo).
 */
export interface Message {
	readonly id: string
	readonly sessionID: string
	readonly role: string
	readonly time: {
		readonly created: number
		readonly completed?: number
	}
	readonly summary?: unknown
	readonly agent?: string
	readonly model?: {
		name?: string
		providerID?: string
		modelID?: string
		limits?: {
			context: number
			output: number
		}
	}
	readonly system?: unknown
	readonly tools?: unknown
	readonly variant?: unknown
	readonly error?: unknown
	readonly parentID?: string
	readonly modelID?: string
	readonly providerID?: string
	readonly mode?: string
	readonly path?: unknown
	readonly cost?: unknown
	readonly tokens?: {
		input: number
		output: number
		reasoning?: number
		cache?: {
			read: number
			write: number
		}
	}
	readonly finish?: string
}

/**
 * Part - Compatible with Effect Schema Part
 */
export type Part = SSEPart

/**
 * Backward-compatible SessionStatus type (loose string union)
 * Effect Schema uses object discriminated union - this is for consumers that need strings
 */
export type SessionStatusCompat = "pending" | "running" | "completed" | "error" | "idle"

/**
 * Session with computed status
 * Used for rendering session lists with real-time status
 */
export interface SessionWithStatus {
	session: Session
	status: SessionStatusCompat
}
