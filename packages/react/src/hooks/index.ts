/**
 * React hooks for OpenCode
 */

// === Public API (Stable) ===

// World Stream (ADR-018 - Reactive World Stream)
export { useWorld, getWorldRegistry } from "./use-world"
export { useWorldSession } from "./use-world-session"
export { useWorldConnection, type ConnectionStatus } from "./use-world-connection"
export { useWorldMessages } from "./use-world-messages"
export { useWorldContextUsage } from "./use-world-context-usage"
export { useWorldCompactionState } from "./use-world-compaction-state"
export { useWorldSessionStatus } from "./use-world-session-status"
export { useWorldDebug } from "./use-world-debug"

// Unified Facade
export {
	useSession,
	type UseSessionOptions,
	type UseSessionReturn,
} from "./use-session-facade"

// Data Fetching
export { useSessionList } from "./use-session-list"
export { useSessionData } from "./use-session-data"
export {
	useProjects,
	useCurrentProject,
	type UseProjectsReturn,
	type UseCurrentProjectReturn,
	type Project,
} from "./use-projects"
export { useProviders } from "./use-providers"

// Actions
export { useSendMessage } from "./use-send-message"
export { useCreateSession } from "./use-create-session"
export { useCommands, type UseCommandsOptions } from "./use-commands"

// Utilities
export { useFileSearch } from "./use-file-search"
export {
	useMultiDirectorySessions,
	type SessionDisplay,
} from "./use-multi-directory-sessions"
export {
	useMultiDirectoryStatus,
	type UseMultiDirectoryStatusReturn,
} from "./use-multi-directory-status"
export { useSSEState } from "./use-sse-state"

// === Internal Hooks (Re-exported for backward compatibility) ===
// @internal - These are not part of the public API and may change without notice.
// Prefer using higher-level hooks like useSession instead.

export { useSessionStatus } from "./internal/use-session-status"
export { useMessages } from "./internal/use-messages"
export { useParts } from "./internal/use-parts"
export {
	useMessagesWithParts,
	type OpencodeMessage,
} from "./internal/use-messages-with-parts"
export {
	useSSE,
	type UseSSEOptions,
	type UseSSEReturn,
} from "./internal/use-sse"
export {
	useSubagents,
	type UseSubagentsReturn,
	type SubagentSession,
	type SubagentState,
} from "./internal/use-subagents"
export {
	useSubagent,
	type UseSubagentOptions,
	type UseSubagentReturn,
} from "./internal/use-subagent"
export {
	useSubagentSync,
	type UseSubagentSyncOptions,
} from "./internal/use-subagent-sync"
export { useContextUsage, formatTokens } from "./internal/use-context-usage"
export { useCompactionState } from "./internal/use-compaction-state"
export { useLiveTime } from "./internal/use-live-time"
