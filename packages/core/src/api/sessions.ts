/**
 * Sessions API - Promise-based wrapper
 *
 * Promise-based API for session operations.
 * Wraps SessionAtom Effect programs with Effect.runPromise.
 *
 * @module api/sessions
 */

import { Effect } from "effect"
import { SessionAtom, type ModelSelection } from "../atoms/sessions.js"
import type { Session, Part, SessionWithStatus, SessionStatus } from "../types/index.js"
import { runWithRuntime } from "../runtime/run-with-runtime.js"
import { StatusService } from "../services/status-service.js"
import { createClient } from "../client/index.js"
import { normalizeBackendStatus, type BackendSessionStatus } from "../types/sessions.js"

/**
 * Session API namespace
 *
 * Promise-based wrappers around SessionAtom.
 */
export const sessions = {
	/**
	 * Fetch all sessions for a directory
	 *
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Session array
	 *
	 * @example
	 * ```typescript
	 * const sessions = await sessions.list("/my/project")
	 * console.log(sessions.length)
	 * ```
	 */
	list: (directory?: string): Promise<Session[]> => Effect.runPromise(SessionAtom.list(directory)),

	/**
	 * Fetch a single session by ID
	 *
	 * @param id - Session ID
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to Session or null
	 *
	 * @example
	 * ```typescript
	 * const session = await sessions.get("ses_123")
	 * if (session) {
	 *   console.log(session.title)
	 * }
	 * ```
	 */
	get: (id: string, directory?: string): Promise<Session | null> =>
		Effect.runPromise(SessionAtom.get(id, directory)),

	/**
	 * Create a new session
	 *
	 * @param title - Optional session title
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves to created Session
	 *
	 * @example
	 * ```typescript
	 * const session = await sessions.create("My Session")
	 * console.log(session.id)
	 * ```
	 */
	create: (title?: string, directory?: string): Promise<Session> =>
		Effect.runPromise(SessionAtom.create(title, directory)),

	/**
	 * Send a prompt to a session asynchronously (fire-and-forget)
	 *
	 * @param sessionId - Session ID
	 * @param parts - Array of prompt parts
	 * @param model - Optional model selection (e.g., { providerID: "anthropic", modelID: "claude-3-sonnet" })
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves when prompt is sent
	 *
	 * @example
	 * ```typescript
	 * await sessions.promptAsync("ses_123", [
	 *   { type: "text", content: "Hello", start: 0, end: 5 }
	 * ])
	 * ```
	 */
	promptAsync: (
		sessionId: string,
		parts: unknown[],
		model?: ModelSelection,
		directory?: string,
	): Promise<void> =>
		Effect.runPromise(SessionAtom.promptAsync(sessionId, parts, model, directory)),

	/**
	 * Execute a slash command in a session
	 *
	 * @param sessionId - Session ID
	 * @param command - Slash command name (without the /)
	 * @param args - Command arguments as string
	 * @param directory - Project directory (optional)
	 * @returns Promise that resolves when command is executed
	 *
	 * @example
	 * ```typescript
	 * await sessions.command("ses_123", "swarm", "Add auth")
	 * ```
	 */
	command: (sessionId: string, command: string, args: string, directory?: string): Promise<void> =>
		Effect.runPromise(SessionAtom.command(sessionId, command, args, directory)),

	/**
	 * Fetch sessions with status in a single call (bootstrap optimization)
	 *
	 * Fetches /session/list and /session/status in parallel, then joins status into sessions.
	 * This eliminates N+1 queries during bootstrap.
	 *
	 * Sessions without status in the map are considered "idle" (backend removes idle from in-memory map).
	 *
	 * @param directory - Project directory (optional)
	 * @param options - Fetch options
	 * @param options.recentOnly - If true, filter to sessions updated in last 4 hours
	 * @param options.limit - Maximum number of sessions to return
	 * @returns Promise that resolves to SessionWithStatus array
	 *
	 * @example
	 * ```typescript
	 * // Get all sessions with status
	 * const all = await sessions.listWithStatus("/my/project")
	 *
	 * // Get recent sessions only (updated in last 4 hours)
	 * const recent = await sessions.listWithStatus("/my/project", { recentOnly: true })
	 *
	 * // Get top 5 most recent sessions
	 * const top5 = await sessions.listWithStatus("/my/project", { limit: 5 })
	 * ```
	 */
	listWithStatus: async (
		directory?: string,
		options?: { recentOnly?: boolean; limit?: number },
	): Promise<SessionWithStatus[]> => {
		const client = createClient(directory)

		// Fetch both endpoints in parallel
		const [sessionsResponse, statusResponse] = await Promise.all([
			client.session.list(),
			client.session.status(),
		])

		let sessionsList = sessionsResponse.data || []
		const statusMap = (statusResponse.data as Record<string, BackendSessionStatus> | null) || {}

		// Apply recentOnly filter (sessions updated in last 4 hours)
		if (options?.recentOnly) {
			const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000
			sessionsList = sessionsList.filter((session) => session.time.updated >= fourHoursAgo)
		}

		// Apply limit
		if (options?.limit && options.limit > 0) {
			sessionsList = sessionsList.slice(0, options.limit)
		}

		// Join status into sessions
		return sessionsList.map((session) => {
			const backendStatus = statusMap[session.id]
			const status = normalizeBackendStatus(backendStatus)

			return { session, status }
		})
	},
}

/**
 * Get session status using 3-source logic
 *
 * Computes status from:
 * 1. sessionStatusMap (SSE session.status events)
 * 2. Sub-agent activity (task parts with status="running")
 * 3. Last message check (bootstrap edge case, opt-in)
 *
 * React calls this - no Effect types exposed.
 *
 * @param sessionId - Session ID
 * @param session - Session object (not currently used by StatusService, but included for API consistency)
 * @param parts - All parts for the session
 * @param sessionStatusMap - Map of sessionId -> status from SSE
 * @param options - Computation options (includeSubAgents, includeLastMessage)
 * @returns Promise that resolves to SessionStatus
 *
 * @example
 * ```typescript
 * const status = await getStatus("ses_123", session, parts, sessionStatusMap)
 * console.log(status) // "running" | "completed" | "pending" | "error"
 * ```
 */
export async function getStatus(
	sessionId: string,
	session: Session,
	parts: Part[],
	sessionStatusMap: Record<string, SessionStatus>,
	options?: {
		includeSubAgents?: boolean
		includeLastMessage?: boolean
	},
): Promise<SessionStatus> {
	return runWithRuntime(
		Effect.gen(function* () {
			const statusService = yield* StatusService
			// Convert parts to StatusPart shape expected by service
			const statusParts = parts.map((p) => ({
				messageId: p.messageID,
				type: p.type,
				tool: p.type === "tool" ? p.tool : undefined,
				state: p.type === "tool" ? p.state : undefined,
			}))
			return statusService.computeStatus({
				sessionId,
				sessionStatusMap,
				messages: [], // Messages not needed for current use cases
				parts: statusParts,
				options,
			})
		}),
	)
}

/**
 * List sessions with computed status
 *
 * Maps over sessions array and computes status for each using StatusService.
 * React calls this - no Effect types exposed.
 *
 * NOTE: Caller is responsible for filtering parts by session if needed.
 * In most cases, sessionStatusMap is the primary source and parts are used
 * for sub-agent detection within a specific session context.
 *
 * @param sessions - Array of sessions
 * @param parts - Parts array (caller should filter by session if needed)
 * @param sessionStatusMap - Map of sessionId -> status from SSE
 * @returns Promise that resolves to SessionWithStatus array
 *
 * @example
 * ```typescript
 * const sessionsWithStatus = await listWithStatus(sessions, [], sessionStatusMap)
 * sessionsWithStatus.forEach(({ session, status }) => {
 *   console.log(session.title, status)
 * })
 * ```
 */
export async function listWithStatus(
	sessions: Session[],
	parts: Part[],
	sessionStatusMap: Record<string, SessionStatus>,
): Promise<SessionWithStatus[]> {
	return runWithRuntime(
		Effect.gen(function* () {
			const statusService = yield* StatusService

			// Compute status for each session
			const results: SessionWithStatus[] = []
			for (const session of sessions) {
				// Convert parts to StatusPart shape
				// Note: For listWithStatus, parts are typically empty or pre-filtered by caller
				// The sessionStatusMap is the primary source of truth
				const statusParts = parts.map((p) => ({
					messageId: p.messageID,
					type: p.type,
					tool: p.type === "tool" ? p.tool : undefined,
					state: p.type === "tool" ? p.state : undefined,
				}))

				const status = statusService.computeStatus({
					sessionId: session.id,
					sessionStatusMap,
					messages: [],
					parts: statusParts,
					options: { includeSubAgents: true, includeLastMessage: false },
				})

				results.push({ session, status })
			}

			return results
		}),
	)
}

/**
 * Compute session status synchronously (no Effect runtime needed)
 *
 * This is a direct wrapper around StatusService's computeStatus for use
 * in synchronous contexts like Zustand selectors.
 *
 * @param sessionId - Session ID
 * @param sessionStatusMap - Map of sessionId -> status from SSE
 * @param messages - Messages for the session
 * @param parts - Parts for all messages in the session
 * @param options - Computation options
 * @returns Session status
 *
 * @example
 * ```typescript
 * // In Zustand selector
 * const status = computeStatusSync(
 *   "ses-123",
 *   store.sessionStatus,
 *   store.messages[sessionId] || [],
 *   allParts,
 *   { includeSubAgents: true }
 * )
 * ```
 */
export function computeStatusSync(
	sessionId: string,
	sessionStatusMap: Record<string, SessionStatus>,
	messages: Array<{ id: string; role: string; time?: { created: number; completed?: number } }>,
	parts: Array<{ messageId: string; type: string; tool?: string; state?: { status?: string } }>,
	options?: { includeSubAgents?: boolean; includeLastMessage?: boolean },
): SessionStatus {
	const { includeSubAgents = true, includeLastMessage = false } = options || {}

	// SOURCE 1: Main session status from map (highest priority if "running")
	const mainStatus = sessionStatusMap[sessionId] ?? "completed"
	if (mainStatus === "running") {
		return "running"
	}

	// SOURCE 2: Sub-agent activity (task parts with status="running")
	if (includeSubAgents) {
		for (const part of parts) {
			if (part.type === "tool" && part.tool === "task" && part.state?.status === "running") {
				return "running"
			}
		}
	}

	// SOURCE 3: Last message check (bootstrap edge case)
	if (includeLastMessage && messages.length > 0) {
		const lastMessage = messages[messages.length - 1]
		if (lastMessage.role === "assistant" && !lastMessage.time?.completed) {
			return "running"
		}
	}

	// Fallback to main status or "completed"
	return mainStatus
}

// Export types for consumers
export type { Session, ModelSelection, SessionWithStatus }
