"use client"

/**
 * OpenCode hooks - single source of truth
 *
 * This file creates the factory instance once and exports all hooks.
 * Components import from here, not from @opencode-vibe/react directly.
 */
import { generateOpencodeHelpers } from "@opencode-vibe/react"

export const {
	useSession,
	useMessages,
	useMessagesWithParts,
	useSendMessage,
	useSessionList,
	useProviders,
	useProvider,
	useProjects,
	useCommands,
	useCreateSession,
	useFileSearch,
	useSSE,
	useSSEEvents,
	useSSESync, // deprecated - use useSSEEvents
	useConnectionStatus,
	useSessionStatus,
	useCompactionState,
	useContextUsage,
	useLiveTime,
	useSubagent,
	useServersEffect,
} = generateOpencodeHelpers()

// Re-export types for components
export type { Provider, Model } from "@opencode-vibe/core/atoms"
export type { Part, Message } from "@opencode-vibe/core/types"

// Re-export utility functions
export { formatTokens, getOpencodeConfig } from "@opencode-vibe/react"
