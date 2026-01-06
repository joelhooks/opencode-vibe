/**
 * Sessions Atom - Pure Effect Programs
 *
 * Framework-agnostic Effect programs for session management.
 * Consumers (React hooks) should use Effect.runPromise to execute these programs.
 *
 * Provides:
 * - Session list fetching via SDK
 * - Session get by ID
 * - Sorted by updated time descending (newest first)
 *
 * @module atoms/sessions
 */

import { Effect } from "effect"
import { createClient } from "../client/index.js"
import type { Session } from "../types/index.js"

/**
 * Model selection for prompt requests
 */
export interface ModelSelection {
	providerID: string
	modelID: string
}

/**
 * Session atom namespace with Effect programs
 */
export const SessionAtom = {
	/**
	 * Fetch all sessions for a directory, sorted by updated time descending
	 *
	 * @param directory - Project directory (optional)
	 * @returns Effect program that yields Session[] or Error
	 *
	 * @example
	 * ```typescript
	 * import { Effect } from "effect"
	 * import { SessionAtom } from "@opencode/core/atoms"
	 *
	 * // Execute the Effect program
	 * const sessions = await Effect.runPromise(SessionAtom.list("/my/project"))
	 *
	 * // Or compose with other Effects
	 * const program = Effect.gen(function* () {
	 *   const sessions = yield* SessionAtom.list("/my/project")
	 *   return sessions.filter(s => s.title.includes("auth"))
	 * })
	 * ```
	 */
	list: (directory?: string): Effect.Effect<Session[], Error> =>
		Effect.gen(function* () {
			const client = yield* Effect.sync(() => createClient(directory))

			const response = yield* Effect.tryPromise({
				try: (_signal) => client.session.list(),
				catch: (error) =>
					new Error(
						`Failed to fetch sessions: ${error instanceof Error ? error.message : String(error)}`,
					),
			})

			// Sort by updated time descending (newest first)
			const sessions = response.data || []
			return sessions.sort((a, b) => b.time.updated - a.time.updated)
		}),

	/**
	 * Fetch a single session by ID
	 *
	 * @param id - Session ID
	 * @param directory - Project directory (optional)
	 * @returns Effect program that yields Session | null or Error
	 *
	 * @example
	 * ```typescript
	 * const session = await Effect.runPromise(SessionAtom.get("ses_123"))
	 * if (session) {
	 *   console.log(session.title)
	 * }
	 * ```
	 */
	get: (id: string, directory?: string): Effect.Effect<Session | null, Error> =>
		Effect.gen(function* () {
			// Pass sessionId for session-based routing (routes to correct server in multi-TUI setup)
			const client = yield* Effect.sync(() => createClient(directory, id))

			const response = yield* Effect.tryPromise({
				try: (_signal) => client.session.get({ path: { id } }),
				catch: (error) =>
					new Error(
						`Failed to fetch session: ${error instanceof Error ? error.message : String(error)}`,
					),
			})

			return response.data ?? null
		}),

	/**
	 * Create a new session
	 *
	 * @param title - Optional session title
	 * @param directory - Project directory (optional)
	 * @returns Effect program that yields Session or Error
	 *
	 * @example
	 * ```typescript
	 * const session = await Effect.runPromise(SessionAtom.create("My Session"))
	 * console.log(session.id)
	 * ```
	 */
	create: (title?: string, directory?: string): Effect.Effect<Session, Error> =>
		Effect.gen(function* () {
			const client = yield* Effect.sync(() => createClient(directory))

			const response = yield* Effect.tryPromise({
				try: (_signal) => client.session.create({ body: title ? { title } : {} }),
				catch: (error) =>
					new Error(
						`Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
					),
			})

			if (!response.data) {
				return yield* Effect.fail(new Error("Session creation returned no data"))
			}

			return response.data
		}),

	/**
	 * Send a prompt to a session asynchronously (fire-and-forget)
	 *
	 * @param sessionId - Session ID
	 * @param parts - Array of prompt parts (TextPart, FileAttachmentPart, ImageAttachmentPart)
	 * @param model - Optional model selection (e.g., { providerID: "anthropic", modelID: "claude-3-sonnet" })
	 * @param directory - Project directory (optional)
	 * @returns Effect program that yields void or Error
	 *
	 * @example
	 * ```typescript
	 * await Effect.runPromise(SessionAtom.promptAsync("ses_123", [
	 *   { type: "text", content: "Hello", start: 0, end: 5 }
	 * ]))
	 * ```
	 */
	promptAsync: (
		sessionId: string,
		parts: unknown[],
		model?: ModelSelection,
		directory?: string,
	): Effect.Effect<void, Error> =>
		Effect.gen(function* () {
			// Pass sessionId for session-based routing (routes to correct server in multi-TUI setup)
			const client = yield* Effect.sync(() => createClient(directory, sessionId))

			const body: { parts: any; model?: ModelSelection } = model
				? { parts: parts as any, model }
				: { parts: parts as any }

			yield* Effect.tryPromise({
				try: async (_signal) => {
					const result = await client.session.promptAsync({
						path: { id: sessionId },
						body,
					})
					return result
				},
				catch: (error) => {
					return new Error(
						`Failed to send prompt: ${error instanceof Error ? error.message : String(error)}`,
					)
				},
			})
		}),

	/**
	 * Execute a slash command in a session
	 *
	 * @param sessionId - Session ID
	 * @param command - Slash command name (without the /)
	 * @param args - Command arguments as string
	 * @param directory - Project directory (optional)
	 * @returns Effect program that yields void or Error
	 *
	 * @example
	 * ```typescript
	 * await Effect.runPromise(SessionAtom.command("ses_123", "swarm", "Add auth"))
	 * ```
	 */
	command: (
		sessionId: string,
		command: string,
		args: string,
		directory?: string,
	): Effect.Effect<void, Error> =>
		Effect.gen(function* () {
			// Pass sessionId for session-based routing (routes to correct server in multi-TUI setup)
			const client = yield* Effect.sync(() => createClient(directory, sessionId))

			yield* Effect.tryPromise({
				try: (_signal) =>
					client.session.command({
						path: { id: sessionId },
						body: { command, arguments: args },
					}),
				catch: (error) =>
					new Error(
						`Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
					),
			})
		}),
}

// Export types for consumers
export type { Session }
