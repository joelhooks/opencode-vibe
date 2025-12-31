/**
 * React hooks for OpenCode
 */

// === Public API (Stable) ===

// Data Fetching
export { useSessionList } from "./use-session-list"
export { useSession } from "./use-session"
export {
	useProjects,
	useCurrentProject,
	type UseProjectsReturn,
	type UseCurrentProjectReturn,
	type Project,
} from "./use-projects"
export {
	useServers,
	useCurrentServer,
	type UseServersReturn,
	type UseCurrentServerReturn,
	type ServerInfo,
} from "./use-servers"
export { useProviders } from "./use-providers"

// Actions
export { useSendMessage } from "./use-send-message"
export { useCreateSession } from "./use-create-session"
export { useCommands, type UseCommandsOptions } from "./use-commands"

// Utilities
export { useFileSearch } from "./use-file-search"

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
	useMultiServerSSE,
	type UseMultiServerSSEOptions,
} from "./internal/use-multi-server-sse"
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
