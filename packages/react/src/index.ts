/**
 * React hooks for OpenCode
 */

export {
	useSSE,
	type UseSSEOptions,
	type UseSSEReturn,
} from "./hooks/internal/use-sse"
export {
	useMultiServerSSE,
	type UseMultiServerSSEOptions,
} from "./hooks/internal/use-multi-server-sse"
export { useMessages } from "./hooks/internal/use-messages"
export { useParts } from "./hooks/internal/use-parts"
export {
	useMessagesWithParts,
	type OpencodeMessage,
} from "./hooks/internal/use-messages-with-parts"
export {
	useProjects,
	useCurrentProject,
	type UseProjectsReturn,
	type UseCurrentProjectReturn,
	type Project,
} from "./hooks/use-projects"
export {
	OpencodeProvider,
	useOpencode,
	type OpencodeContextValue,
	type OpencodeProviderProps,
	SSEProvider,
	type SSEContextValue,
	type SSEProviderProps,
} from "./providers"
// Hooks still using caller pattern (to be migrated)
export { useCreateSession } from "./hooks/use-create-session"
export { useProvider } from "./hooks/internal/use-provider"
export {
	useSendMessage,
	type UseSendMessageOptions,
	type UseSendMessageReturn,
	type ModelSelection,
} from "./hooks/use-send-message"
export {
	useProviders,
	type UseProvidersReturn,
	type Provider,
	type Model,
} from "./hooks/use-providers"
export type { ProviderData, UseProviderResult } from "./hooks/internal/use-provider"
export {
	useFileSearch,
	type UseFileSearchOptions,
	type UseFileSearchResult,
} from "./hooks/use-file-search"
export { useLiveTime } from "./hooks/internal/use-live-time"
export { useCommands } from "./hooks/use-commands"

// Re-export core types for backwards compatibility
export type { Session, Message, Part } from "@opencode-vibe/core/types"

// Effect-based hooks (Phase 3b: Effect atom migration)
export {
	useServers,
	useServersEffect,
	useCurrentServer,
	type UseServersReturn,
	type UseCurrentServerReturn,
	type ServerInfo,
} from "./hooks/use-servers"
export { useSession } from "./hooks/use-session"
export { useSessionList } from "./hooks/use-session-list"
export { useSessionStatus } from "./hooks/internal/use-session-status"
export type { SessionStatus } from "./store/types"
export {
	useSubagents,
	type UseSubagentsReturn,
	type SubagentSession,
	type SubagentState,
} from "./hooks/internal/use-subagents"
export {
	useSubagent,
	type UseSubagentOptions,
	type UseSubagentReturn,
} from "./hooks/internal/use-subagent"
export { useContextUsage, formatTokens } from "./hooks/internal/use-context-usage"
export { useCompactionState } from "./hooks/internal/use-compaction-state"
export {
	useSubagentSync,
	type UseSubagentSyncOptions,
} from "./hooks/internal/use-subagent-sync"

// Store (Phase 1: Core Store + Binary Utils)
export {
	useOpencodeStore,
	usePartSummary,
	type DirectoryState,
	type ContextUsage,
	type CompactionState as StoreCompactionState,
	type FileDiff,
	type Todo,
	type GlobalEvent,
} from "./store"
