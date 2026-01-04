/**
 * Zustand store for OpenCode state management with DirectoryState pattern
 *
 * Uses Immer middleware for immutable updates and Binary utilities from core
 * for O(log n) session/message operations on sorted arrays.
 *
 * Arrays are sorted by ID (lexicographic, ULID-compatible).
 * Each directory has isolated state with sessions, messages, parts, todos, etc.
 */

import { Binary } from "@opencode-vibe/core"
import type { Message, Part } from "@opencode-vibe/core/types"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import type { DirectoryState, GlobalEvent, Session, SessionStatus } from "./types"

/**
 * Default model limits when API unavailable or model not found.
 * Imported from bootstrap.ts would cause circular import, so duplicated here.
 * Used when modelID not found in store.modelLimits cache.
 *
 * Values match bootstrap.ts DEFAULT_MODEL_LIMITS (128k context, 4k output).
 */
const DEFAULT_MODEL_LIMITS = {
	context: 128000,
	output: 4096,
} as const

/**
 * Store state shape
 *
 * Contains isolated state for multiple project directories.
 * Each directory has its own sessions, messages, parts, and metadata.
 *
 * @property directories - Map of directory path to DirectoryState
 */
type OpencodeState = {
	directories: Record<string, DirectoryState>
}

/**
 * Store actions for managing OpenCode state
 *
 * All actions use Immer middleware for immutable updates.
 * Arrays are maintained in sorted order (by ID) for O(log n) binary search.
 *
 * @remarks
 * Use `getState()` when calling actions inside useEffect/useCallback to avoid
 * dependency issues (the hook return value creates new references on every render).
 */
type OpencodeActions = {
	// Directory management
	/**
	 * Initialize a directory with empty state
	 *
	 * Idempotent - safe to call multiple times. If directory already exists, no-op.
	 *
	 * @param directory - Project directory path
	 */
	initDirectory: (directory: string) => void

	/**
	 * Central event dispatcher for SSE events
	 *
	 * Routes events to appropriate handlers based on event type.
	 * Auto-creates directory if it doesn't exist (ensures events for any
	 * directory are processed, not dropped).
	 *
	 * @param directory - Project directory path
	 * @param event - Event object with type and properties
	 *
	 * @remarks
	 * This is called by `handleSSEEvent` after extracting directory from GlobalEvent.
	 */
	handleEvent: (directory: string, event: { type: string; properties: any }) => void

	// SSE integration
	/**
	 * Handle SSE GlobalEvent - wrapper for handleEvent
	 *
	 * This is the primary integration point for SSE events.
	 * SSEProvider/useSSEEvents calls this method when events arrive from the event stream.
	 * It extracts directory and payload from GlobalEvent and routes to handleEvent.
	 *
	 * **Auto-initialization**: If the directory doesn't exist in the store,
	 * it's automatically created with empty state. This enables cross-directory
	 * updates (e.g., project list showing status updates for multiple OpenCode
	 * instances on different ports).
	 *
	 * @param event - GlobalEvent from SSE stream (contains directory and payload)
	 *
	 * @example Basic usage
	 * ```tsx
	 * const { subscribe } = useSSE()
	 *
	 * useEffect(() => {
	 *   const unsubscribe = subscribe("session.created", (globalEvent) => {
	 *     store.handleSSEEvent(globalEvent)
	 *   })
	 *   return unsubscribe
	 * }, [subscribe])
	 * ```
	 *
	 * @example Multi-directory updates
	 * ```tsx
	 * // Events for ALL directories are processed, not filtered
	 * // This enables the project list to show status for all active projects
	 * multiServerSSE.onEvent((event) => {
	 *   useOpencodeStore.getState().handleSSEEvent(event)
	 * })
	 * ```
	 */
	handleSSEEvent: (event: GlobalEvent) => void

	// Setter actions
	setSessionReady: (directory: string, ready: boolean) => void
	setSessions: (directory: string, sessions: Session[]) => void
	setMessages: (directory: string, sessionID: string, messages: Message[]) => void
	setParts: (directory: string, messageID: string, parts: Part[]) => void

	// Hydration (server-side initial data)
	hydrateMessages: (
		directory: string,
		sessionID: string,
		messages: Message[],
		parts: Record<string, Part[]>,
	) => void

	// Session convenience methods
	getSession: (directory: string, id: string) => Session | undefined
	getSessions: (directory: string) => Session[]
	addSession: (directory: string, session: Session) => void
	updateSession: (directory: string, id: string, updater: (draft: Session) => void) => void
	removeSession: (directory: string, id: string) => void

	// Message convenience methods
	getMessages: (directory: string, sessionID: string) => Message[]
	addMessage: (directory: string, message: Message) => void
	updateMessage: (
		directory: string,
		sessionID: string,
		messageID: string,
		updater: (draft: Message) => void,
	) => void
	removeMessage: (directory: string, sessionID: string, messageID: string) => void

	// Model limits caching (for context usage calculation)
	setModelLimits: (
		directory: string,
		limits: Record<string, { context: number; output: number }>,
	) => void
	getModelLimits: (
		directory: string,
		modelID: string,
	) => { context: number; output: number } | undefined
}

/**
 * Factory for empty DirectoryState
 *
 * Creates initial state for a new directory with empty arrays and objects.
 * Used by `initDirectory` and `handleSSEEvent` when auto-creating directories.
 *
 * @returns DirectoryState with all fields initialized to empty/default values
 *
 * @remarks
 * MIGRATION NOTE (ADR-018 - Zustand Elimination Phase 5):
 * The following fields are DEPRECATED and should be removed from DirectoryState:
 * - `sessions` → use world.sessions (World Stream)
 * - `messages` → use world.sessions[].messages (World Stream)
 * - `parts` → use world.sessions[].messages[].parts (World Stream)
 *
 * Keep only UI-local state:
 * - `ready` → Bootstrap/initialization flag (UI state)
 * - `todos` → Session todos (not yet in World Stream)
 * - `modelLimits` → Model context/output limits cache (offline capability)
 */
const createEmptyDirectoryState = (): DirectoryState => ({
	ready: false,
	sessions: [], // DEPRECATED - use world.sessions
	todos: {},
	messages: {}, // DEPRECATED - use world.sessions[].messages
	parts: {}, // DEPRECATED - use world.sessions[].messages[].parts
	modelLimits: {},
})

/**
 * Zustand store with Immer middleware for immutable updates
 *
 * @example
 * const store = useOpencodeStore()
 * store.initDirectory("/my/project")
 * store.handleEvent("/my/project", { type: "session.updated", properties: { info: session } })
 */
export const useOpencodeStore = create<OpencodeState & OpencodeActions>()(
	immer((set, get) => ({
		// Initial state
		directories: {},

		/**
		 * Initialize directory with empty state
		 *
		 * Idempotent - if directory already exists, does nothing.
		 * Creates a new DirectoryState with empty sessions, messages, etc.
		 *
		 * @param directory - Project directory path
		 */
		initDirectory: (directory) => {
			set((state) => {
				if (!state.directories[directory]) {
					state.directories[directory] = createEmptyDirectoryState()
				}
			})
		},

		/**
		 * Central event dispatcher for SSE events
		 *
		 * Routes events to appropriate handlers based on event type.
		 * Auto-creates directory if it doesn't exist (ensures events for any
		 * directory are processed, not dropped).
		 *
		 * Supported events:
		 * - session.created, session.updated, session.status, session.deleted
		 * - message.updated, message.removed
		 * - message.part.updated, message.part.removed
		 * - todo.updated
		 *
		 * @param directory - Project directory path
		 * @param event - Event object with type and properties
		 */
		handleEvent: (directory, event) => {
			set((state) => {
				// Auto-create directory if not exists
				if (!state.directories[directory]) {
					state.directories[directory] = createEmptyDirectoryState()
				}
				const dir = state.directories[directory]
				if (!dir) return

				switch (event.type) {
					// ═══════════════════════════════════════════════════════════════
					// SESSION/MESSAGE/PART EVENTS - Handled by World Stream (ADR-018)
					// ═══════════════════════════════════════════════════════════════
					// Core data (sessions, messages, parts) flows through World Stream atoms.
					// Events are routed via multiServerSSE → routeEvent() → World Stream.
					// These cases are no-ops to prevent "unhandled event" warnings.
					case "session.created":
					case "session.updated":
					case "session.status":
					case "session.diff":
					case "session.deleted":
					case "session.compacted":
					case "message.updated":
					case "message.removed":
					case "message.part.updated":
					case "message.part.removed":
						// Handled by World Stream - no action needed
						break

					// ═══════════════════════════════════════════════════════════════
					// TODO EVENTS (UI-local state - not yet in World Stream)
					// ═══════════════════════════════════════════════════════════════
					case "todo.updated": {
						dir.todos[event.properties.sessionID] = event.properties.todos
						break
					}

					// ═══════════════════════════════════════════════════════════════
					// PROVIDER/PROJECT EVENTS (logged, not stored until state added)
					// ═══════════════════════════════════════════════════════════════
					case "provider.updated": {
						// TODO: Update provider in state when DirectoryState has providers array
						console.log("[SSE] provider.updated:", event.properties)
						break
					}

					case "project.updated": {
						// TODO: Update project in state when DirectoryState has projects array
						console.log("[SSE] project.updated:", event.properties)
						break
					}
				}
			})
		},

		// Set directory ready flag
		setSessionReady: (directory, ready) => {
			set((state) => {
				if (state.directories[directory]) {
					state.directories[directory]!.ready = ready
				}
			})
		},

		// Set sessions array (sorted)
		setSessions: (directory, sessions) => {
			set((state) => {
				if (state.directories[directory]) {
					// Sort by ID for binary search
					state.directories[directory]!.sessions = sessions.sort((a, b) => a.id.localeCompare(b.id))
				}
			})
		},

		// Set messages array (sorted)
		setMessages: (directory, sessionID, messages) => {
			set((state) => {
				if (state.directories[directory]) {
					// Sort by ID for binary search
					state.directories[directory]!.messages[sessionID] = messages.sort((a, b) =>
						a.id.localeCompare(b.id),
					)
				}
			})
		},

		// Set parts array (sorted)
		setParts: (directory, messageID, parts) => {
			set((state) => {
				if (state.directories[directory]) {
					// Sort by ID for binary search
					state.directories[directory]!.parts[messageID] = parts.sort((a, b) =>
						a.id.localeCompare(b.id),
					)
				}
			})
		},

		/**
		 * Hydrate store with initial messages and parts from RSC
		 *
		 * This populates the store with server-rendered data before SSE connects,
		 * preventing the "blink" where tools appear first then text pops in later.
		 *
		 * Uses the same binary search insertion as SSE events, so duplicate events
		 * from SSE will be deduplicated (existing IDs are updated, not inserted).
		 *
		 * @param directory - Project directory path
		 * @param sessionID - Session ID to hydrate messages for
		 * @param messages - Array of messages to hydrate
		 * @param parts - Record of messageID -> Part[] to hydrate
		 *
		 * @example
		 * ```tsx
		 * // In RSC (page.tsx)
		 * const messages = await client.session.message.list({ sessionID })
		 * const parts = {} // Build parts from messages
		 *
		 * // In client component
		 * useEffect(() => {
		 *   store.hydrateMessages(directory, sessionID, messages, parts)
		 * }, [])
		 * ```
		 */
		hydrateMessages: (directory, sessionID, messages, parts) => {
			set((state) => {
				// Auto-create directory if not exists
				if (!state.directories[directory]) {
					state.directories[directory] = createEmptyDirectoryState()
				}
				const dir = state.directories[directory]
				if (!dir) return

				// Filter out invalid messages (must have id) and sort
				const validMessages = messages.filter((m) => m && typeof m.id === "string")
				dir.messages[sessionID] = validMessages.sort((a, b) => a.id.localeCompare(b.id))

				// Hydrate parts for each message (sorted)
				for (const [messageID, messageParts] of Object.entries(parts)) {
					if (!messageID || !Array.isArray(messageParts)) continue
					const validParts = messageParts.filter((p) => p && typeof p.id === "string")
					dir.parts[messageID] = validParts.sort((a, b) => a.id.localeCompare(b.id))
				}
			})
		},

		// ═══════════════════════════════════════════════════════════════
		// SESSION CONVENIENCE METHODS
		// ═══════════════════════════════════════════════════════════════

		/**
		 * Get a single session by ID
		 */
		getSession: (directory, id) => {
			const dir = get().directories[directory]
			if (!dir) return undefined

			const result = Binary.search(dir.sessions, id, (s) => s.id)
			return result.found ? dir.sessions[result.index] : undefined
		},

		/**
		 * Get all sessions for a directory
		 */
		getSessions: (directory) => {
			return get().directories[directory]?.sessions || []
		},

		/**
		 * Add a session in sorted order
		 */
		addSession: (directory, session) => {
			set((state) => {
				// Auto-create directory if not exists
				if (!state.directories[directory]) {
					state.directories[directory] = createEmptyDirectoryState()
				}
				const dir = state.directories[directory]
				if (!dir) return

				const result = Binary.search(dir.sessions, session.id, (s) => s.id)
				if (result.found) {
					// Session exists - replace it
					dir.sessions[result.index] = session
				} else {
					// Session doesn't exist - insert it
					dir.sessions.splice(result.index, 0, session)
				}
			})
		},

		/**
		 * Update a session using an updater function
		 */
		updateSession: (directory, id, updater) => {
			set((state) => {
				const dir = state.directories[directory]
				if (!dir) return

				const result = Binary.search(dir.sessions, id, (s) => s.id)
				if (result.found) {
					const session = dir.sessions[result.index]
					if (!session) return
					updater(session)
				}
			})
		},

		/**
		 * Remove a session by ID
		 */
		removeSession: (directory, id) => {
			set((state) => {
				const dir = state.directories[directory]
				if (!dir) return

				const result = Binary.search(dir.sessions, id, (s) => s.id)
				if (result.found) {
					dir.sessions.splice(result.index, 1)
				}
			})
		},

		// ═══════════════════════════════════════════════════════════════
		// MESSAGE CONVENIENCE METHODS
		// ═══════════════════════════════════════════════════════════════

		/**
		 * Get all messages for a session
		 */
		getMessages: (directory, sessionID) => {
			return get().directories[directory]?.messages[sessionID] || []
		},

		/**
		 * Add a message in sorted order
		 */
		addMessage: (directory, message) => {
			set((state) => {
				// Auto-create directory if not exists
				if (!state.directories[directory]) {
					state.directories[directory] = createEmptyDirectoryState()
				}
				const dir = state.directories[directory]
				if (!dir) return

				// Initialize messages array if needed
				if (!dir.messages[message.sessionID]) {
					dir.messages[message.sessionID] = []
				}

				const messages = dir.messages[message.sessionID]
				if (!messages) return
				const result = Binary.search(messages, message.id, (m) => m.id)
				if (!result.found) {
					messages.splice(result.index, 0, message)
				}
			})
		},

		/**
		 * Update a message using an updater function
		 */
		updateMessage: (directory, sessionID, messageID, updater) => {
			set((state) => {
				const dir = state.directories[directory]
				if (!dir) return

				const messages = dir.messages[sessionID]
				if (!messages) return

				const result = Binary.search(messages, messageID, (m) => m.id)
				if (result.found) {
					const message = messages[result.index]
					if (!message) return
					updater(message)
				}
			})
		},

		/**
		 * Remove a message by ID
		 */
		removeMessage: (directory, sessionID, messageID) => {
			set((state) => {
				const dir = state.directories[directory]
				if (!dir) return

				const messages = dir.messages[sessionID]
				if (!messages) return

				const result = Binary.search(messages, messageID, (m) => m.id)
				if (result.found) {
					messages.splice(result.index, 1)
				}
			})
		},

		// ═══════════════════════════════════════════════════════════════
		// MODEL LIMITS METHODS (for context usage calculation)
		// ═══════════════════════════════════════════════════════════════

		/**
		 * Set model limits from provider data
		 *
		 * Called when providers are fetched to cache model context/output limits.
		 * These limits are used to calculate context usage when message.model is null.
		 *
		 * @param directory - Project directory path
		 * @param limits - Record of modelID -> { context, output }
		 */
		setModelLimits: (directory, limits) => {
			set((state) => {
				if (!state.directories[directory]) {
					state.directories[directory] = createEmptyDirectoryState()
				}
				const dir = state.directories[directory]
				if (!dir) return
				// Merge with existing limits (don't replace)
				dir.modelLimits = {
					...dir.modelLimits,
					...limits,
				}
			})
		},

		/**
		 * Get model limits by model ID
		 *
		 * Falls back to DEFAULT_MODEL_LIMITS if model not found.
		 * This ensures context usage always shows a value, even if:
		 * - Bootstrap failed to fetch limits
		 * - Model is new and not yet cached
		 * - Network issues prevented limit loading
		 *
		 * @param directory - Project directory path
		 * @param modelID - Model ID (e.g., "claude-opus-4-5")
		 * @returns Model limits (from cache or default fallback)
		 */
		getModelLimits: (directory, modelID) => {
			return get().directories[directory]?.modelLimits[modelID] ?? DEFAULT_MODEL_LIMITS
		},

		// ═══════════════════════════════════════════════════════════════
		// SSE EVENT HANDLER (GlobalEvent wrapper)
		// ═══════════════════════════════════════════════════════════════

		/**
		 * Handle SSE GlobalEvent - wrapper for handleEvent
		 *
		 * This is the primary integration point for SSE events.
		 * SSEProvider/useSSEEvents calls this method when events arrive from the event stream.
		 * It extracts directory and payload from GlobalEvent and routes to handleEvent.
		 *
		 * **CRITICAL**: Auto-initializes directory if it doesn't exist.
		 * This ensures SSE events for ANY directory are processed, not dropped.
		 * Enables cross-directory updates (e.g., project list showing status
		 * updates for multiple OpenCode instances on different ports).
		 *
		 * **Data Flow**:
		 * 1. SSE event arrives from multiServerSSE
		 * 2. useSSEEvents calls this method with GlobalEvent
		 * 3. Directory is auto-created if needed (via ensureDirectory logic)
		 * 4. Event is routed to handleEvent for processing
		 * 5. Store updates trigger component re-renders via selectors
		 *
		 * @param event - GlobalEvent from SSE stream (contains directory and payload)
		 *
		 * @example Basic usage (from useSSEEvents)
		 * ```tsx
		 * multiServerSSE.onEvent((event) => {
		 *   // Process events for ALL directories - store auto-initializes
		 *   useOpencodeStore.getState().handleSSEEvent(event)
		 * })
		 * ```
		 */
		handleSSEEvent: (event) => {
			/**
			 * Auto-initialize directory if it doesn't exist
			 *
			 * This is the "ensureDirectory" pattern - guarantees directory state exists
			 * before processing events. Without this, events for new directories would
			 * be silently dropped.
			 */
			if (!get().directories[event.directory]) {
				set((state) => {
					state.directories[event.directory] = createEmptyDirectoryState()
				})
			}
			get().handleEvent(event.directory, event.payload)
		},
	})),
)

/**
 * Memoized selector for part summary to avoid deep object traversal.
 * Returns undefined for non-tool parts or pending status.
 *
 * This function prevents unnecessary re-renders caused by Immer's new object references.
 * The selector extracts only the summary string, which allows Zustand's default equality
 * check (Object.is) to correctly identify when the value hasn't changed.
 *
 * For primitive values like strings, Object.is compares by value, so identical strings
 * are considered equal even if extracted from different part objects.
 *
 * @param directory - Project directory path
 * @param messageId - Message ID containing the part
 * @param partId - Part ID to get summary for
 * @returns Summary string or undefined
 *
 * @example
 * ```tsx
 * function TaskComponent({ messageId, partId }) {
 *   const summary = usePartSummary("/my/project", messageId, partId)
 *   return summary ? <div>{summary}</div> : null
 * }
 * ```
 */
export function usePartSummary(
	directory: string,
	messageId: string,
	partId: string,
): string | undefined {
	return useOpencodeStore((state) => {
		const parts = state.directories[directory]?.parts[messageId]
		if (!parts) return undefined

		// Use binary search instead of find() - parts are sorted by ID
		const result = Binary.search(parts, partId, (p: Part) => p.id)
		if (!result.found) return undefined

		const part = parts[result.index]
		if (!part) return undefined
		if (part.type !== "tool") {
			return undefined
		}

		// Type assertion needed because Part has unknown fields
		const partState = part.state as { status: string; metadata?: { summary?: string } } | undefined
		if (!partState || partState.status === "pending") {
			return undefined
		}

		return partState.metadata?.summary
	})
}
