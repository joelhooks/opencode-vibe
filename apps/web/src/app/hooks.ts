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
	useSendMessage,
	useSessionList,
	useProviders,
	useProjects,
	useCommands,
	useCreateSession,
	useFileSearch,
} = generateOpencodeHelpers()
