/**
 * Status utilities - Wrapper around Core layer
 *
 * Status computation logic has been migrated to `@opencode-vibe/core/api`.
 * This file provides a compatibility layer for existing React code.
 */

import { computeStatusSync } from "@opencode-vibe/core/api"
import type { SessionStatus } from "./types"

/**
 * OpencodeState type (minimal subset needed for deriveSessionStatus)
 */
interface OpencodeState {
	directories: Record<
		string,
		{
			sessionStatus?: Record<string, SessionStatus>
			messages?: Record<
				string,
				Array<{
					id: string
					role?: string
					time?: { created: number; completed?: number }
				}>
			>
			parts?: Record<
				string,
				Array<{
					id: string
					messageID: string
					type: string
					tool?: string
					state?: unknown // Flexible to accept Core Part state shapes (different per Part type)
				}>
			>
		}
	>
}

/**
 * Options for deriveSessionStatus
 */
export interface DeriveSessionStatusOptions {
	/**
	 * Include sub-agent activity in status check
	 * @default true
	 */
	includeSubAgents?: boolean

	/**
	 * Include last message check (bootstrap edge case)
	 * @default false
	 */
	includeLastMessage?: boolean
}

/**
 * Derive session status from multiple sources
 *
 * This is a compatibility wrapper around Core's `computeStatusSync`.
 * Extracts data from Zustand store state and calls Core API.
 *
 * @deprecated Prefer using `computeStatusSync` from `@opencode-vibe/core/api` directly
 *
 * @param state - Zustand store state
 * @param sessionId - Session ID
 * @param directory - Project directory path
 * @param options - Status derivation options
 * @returns Session status ("running" | "completed")
 */
export function deriveSessionStatus(
	state: OpencodeState,
	sessionId: string,
	directory: string,
	options: DeriveSessionStatusOptions = {},
): SessionStatus {
	const dir = state.directories[directory]
	if (!dir) return "completed"

	// Extract messages for this session
	const messages = (dir.messages?.[sessionId] || []).map((m) => ({
		id: m.id,
		role: m.role || "user",
		time: m.time,
	}))

	// Extract all parts for this session's messages
	const sessionMessages = dir.messages?.[sessionId] || []
	const parts = sessionMessages.flatMap((msg) =>
		(dir.parts?.[msg.id] || []).map((p) => ({
			messageId: p.messageID,
			type: p.type,
			tool: p.tool,
			state: p.state,
		})),
	)

	// Call Core API
	return computeStatusSync(sessionId, dir.sessionStatus || {}, messages, parts, options)
}
