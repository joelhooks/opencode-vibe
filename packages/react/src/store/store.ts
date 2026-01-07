/**
 * Zustand store for OpenCode UI-local state management
 *
 * Uses Immer middleware for immutable updates.
 * Each directory has isolated state with UI-local data only (ready flag, todos, modelLimits).
 *
 * Sessions, messages, and parts are now managed by World Stream (ADR-018).
 */

import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import type { DirectoryState, GlobalEvent } from "./types"

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
 * Store state shape (UI-local only)
 *
 * Contains isolated state for multiple project directories.
 * Each directory has UI-local state only (ready, todos, modelLimits).
 * Sessions, messages, and parts are managed by World Stream (ADR-018).
 *
 * @property directories - Map of directory path to DirectoryState
 */
type OpencodeState = {
	directories: Record<string, DirectoryState>
}

/**
 * Store actions for managing OpenCode state (UI-local only)
 *
 * All actions use Immer middleware for immutable updates.
 *
 * @remarks
 * Sessions, messages, and parts are now managed by World Stream (ADR-018).
 * This store only contains UI-local state: ready flag, todos, modelLimits.
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

	// Setter actions (UI-local state only)
	setSessionReady: (directory: string, ready: boolean) => void

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
 * Creates initial state for a new directory.
 * Used by `initDirectory` and `handleSSEEvent` when auto-creating directories.
 *
 * @returns DirectoryState with all fields initialized to empty/default values
 *
 * @remarks
 * UI-local state only (sessions/messages/parts moved to World Stream per ADR-018):
 * - `ready` → Bootstrap/initialization flag (UI state)
 * - `todos` → Session todos (not yet in World Stream)
 * - `modelLimits` → Model context/output limits cache (offline capability)
 */
const createEmptyDirectoryState = (): DirectoryState => ({
	ready: false,
	todos: {},
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
						break
					}

					case "project.updated": {
						// TODO: Update project in state when DirectoryState has projects array
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
