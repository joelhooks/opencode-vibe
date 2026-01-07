/**
 * @opencode-vibe/react/store
 *
 * Zustand store for OpenCode state management with DirectoryState pattern.
 * Uses Immer for immutable updates and Binary search from core for O(log n) operations.
 */

export { useOpencodeStore } from "./store.js"
export type { Part, Message } from "@opencode-vibe/core/types"
export type {
	Session,
	SessionStatus,
	Todo,
	FileDiff,
	ContextUsage,
	CompactionState,
	DirectoryState,
	GlobalEvent,
} from "./types.js"
