/**
 * generateOpencodeHelpers - Factory for provider-free hooks
 *
 * Pattern: uploadthing's generateReactHelpers approach
 *
 * Usage:
 * ```tsx
 * // app/hooks.ts (create once)
 * export const { useSession, useSendMessage } = generateOpencodeHelpers()
 *
 * // components/session.tsx
 * import { useSession } from "@/app/hooks"
 * const session = useSession(id) // Just works, no provider
 * ```
 */
"use client"

import { useCallback, useEffect, useState, useRef, useMemo } from "react"
import type { OpencodeConfig } from "./next-ssr-plugin"
import { useOpencodeStore } from "./store"
import type { Session } from "./store/types"
import { useSendMessage as useBaseSendMessage } from "./hooks/use-send-message"
import { useCommands as useCommandsBase } from "./hooks/use-commands"
import { useSessionStatus } from "./hooks/internal/use-session-status"
import type { Prompt } from "./types/prompt"
import { providers, projects, sessions } from "@opencode-vibe/core/api"
import type { Provider, Model, Project } from "@opencode-vibe/core/atoms"
import type { SlashCommand } from "./types/prompt"
import { createClient } from "./lib/client-stub"
import fuzzysort from "fuzzysort"

/**
 * Global config type augmentation
 */
declare global {
	interface Window {
		__OPENCODE?: OpencodeConfig
	}
}

/**
 * Get OpenCode configuration from globalThis (injected by SSR plugin)
 *
 * @param fallback - Optional fallback config for tests
 * @returns OpencodeConfig
 * @throws Error if no config found and no fallback provided
 *
 * @example
 * ```tsx
 * const config = getOpencodeConfig()
 * // { baseUrl: "/api/opencode/4056", directory: "/path" }
 * ```
 */
export function getOpencodeConfig(fallback?: OpencodeConfig): OpencodeConfig {
	// 1. Check globalThis (from SSR plugin)
	if (typeof window !== "undefined" && window.__OPENCODE) {
		return window.__OPENCODE
	}

	// 2. Fallback to provided config (for tests)
	if (fallback?.baseUrl) {
		return fallback
	}

	// 3. No config available - throw helpful error
	throw new Error(
		"OpenCode: No configuration found. " +
			"Did you forget to add <OpencodeSSRPlugin> to your layout?",
	)
}

/**
 * Factory function that creates type-safe OpenCode hooks
 *
 * @param config - Optional config for tests (production uses globalThis)
 * @returns Object with all OpenCode hooks
 *
 * @example
 * ```tsx
 * // app/hooks.ts
 * export const { useSession, useMessages, useSendMessage } = generateOpencodeHelpers()
 *
 * // component.tsx
 * import { useSession } from "@/app/hooks"
 * const session = useSession("session-123")
 * ```
 */
export function generateOpencodeHelpers<TRouter = any>(config?: OpencodeConfig) {
	/**
	 * Hook for accessing session data with real-time SSE updates
	 *
	 * @param sessionId - Session ID to fetch
	 * @returns Session object or undefined if not found
	 *
	 * @example
	 * ```tsx
	 * const session = useSession("session-123")
	 * if (session) {
	 *   console.log(session.title)
	 * }
	 * ```
	 */
	function useSession(sessionId: string) {
		const cfg = getOpencodeConfig(config)

		// Use Zustand store selector with useCallback to prevent unnecessary re-renders
		const session = useOpencodeStore(
			useCallback(
				(state) => {
					const dir = state.directories[cfg.directory]
					if (!dir) return undefined
					return dir.sessions.find((s) => s.id === sessionId)
				},
				[sessionId, cfg.directory],
			),
		)

		// Initialize directory on mount
		useEffect(() => {
			if (!cfg.directory) return
			useOpencodeStore.getState().initDirectory(cfg.directory)
		}, [cfg.directory])

		return session
	}

	/**
	 * Hook for accessing messages in a session with real-time updates
	 *
	 * @param sessionId - Session ID to get messages for
	 * @returns Array of messages for the session
	 *
	 * @example
	 * ```tsx
	 * const messages = useMessages("session-123")
	 * console.log(`${messages.length} messages`)
	 * ```
	 */
	function useMessages(sessionId: string) {
		const cfg = getOpencodeConfig(config)

		const messages = useOpencodeStore(
			useCallback(
				(state) => {
					const dir = state.directories[cfg.directory]
					if (!dir) return []
					return dir.messages[sessionId] || []
				},
				[sessionId, cfg.directory],
			),
		)

		useEffect(() => {
			if (!cfg.directory) return
			useOpencodeStore.getState().initDirectory(cfg.directory)
		}, [cfg.directory])

		return messages
	}

	/**
	 * Hook for sending messages to a session
	 *
	 * @param options - Session ID and optional directory
	 * @returns sendMessage function and isPending state
	 *
	 * @example
	 * ```tsx
	 * const { sendMessage, isPending } = useSendMessage({ sessionId: "session-123" })
	 * await sendMessage({ text: "Hello" })
	 * ```
	 */
	function useSendMessage(options: { sessionId: string }) {
		const cfg = getOpencodeConfig(config)

		// Use the existing useSendMessage hook from hooks/
		const { sendMessage: baseSendMessage, isLoading } = useBaseSendMessage({
			sessionId: options.sessionId,
			directory: cfg.directory,
		})

		// Wrap sendMessage to accept simplified { text: string } input
		const sendMessage = useCallback(
			async (input: { text: string }) => {
				// Convert simple text input to Prompt format
				const parts: Prompt = [
					{
						type: "text",
						content: input.text,
						start: 0,
						end: input.text.length,
					},
				]

				await baseSendMessage(parts)
			},
			[baseSendMessage],
		)

		return { sendMessage, isPending: isLoading }
	}

	/**
	 * Hook to get all sessions from Zustand store
	 *
	 * Returns sessions array from the store (updated via SSE).
	 * Filters out archived sessions automatically.
	 *
	 * @returns Array of sessions
	 */
	function useSessionList(): Session[] {
		const cfg = getOpencodeConfig(config)

		const sessions = useOpencodeStore((state) => state.directories[cfg.directory]?.sessions)

		// Filter in useMemo to avoid creating new array on every render
		return useMemo(() => {
			if (!sessions) return []
			return sessions.filter((s) => !s.time?.archived)
		}, [sessions])
	}

	/**
	 * Hook to list available providers
	 *
	 * @returns Object with providers array, loading state, error
	 */
	function useProviders() {
		const [providerList, setProviderList] = useState<Provider[]>([])
		const [loading, setLoading] = useState(true)
		const [error, setError] = useState<Error | null>(null)
		const [refreshKey, setRefreshKey] = useState(0)

		useEffect(() => {
			let cancelled = false

			async function fetchProviders() {
				try {
					setLoading(true)
					const result = await providers.list()
					if (!cancelled) {
						setProviderList(result)
						setError(null)
					}
				} catch (err) {
					if (!cancelled) {
						setError(err instanceof Error ? err : new Error(String(err)))
					}
				} finally {
					if (!cancelled) {
						setLoading(false)
					}
				}
			}

			fetchProviders()

			return () => {
				cancelled = true
			}
			// refreshKey intentionally used for refetch pattern
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [refreshKey])

		const refetch = () => setRefreshKey((k) => k + 1)

		return {
			providers: providerList,
			loading,
			error,
			refetch,
		}
	}

	/**
	 * Hook to list available projects
	 *
	 * @returns Object with projects array, loading state, error
	 */
	function useProjects() {
		const [projectList, setProjectList] = useState<Project[]>([])
		const [loading, setLoading] = useState(true)
		const [error, setError] = useState<Error | null>(null)
		const [refreshKey, setRefreshKey] = useState(0)

		useEffect(() => {
			let cancelled = false

			async function fetchProjects() {
				try {
					setLoading(true)
					const result = await projects.list()
					if (!cancelled) {
						setProjectList(result)
						setError(null)
					}
				} catch (err) {
					if (!cancelled) {
						setError(err instanceof Error ? err : new Error(String(err)))
					}
				} finally {
					if (!cancelled) {
						setLoading(false)
					}
				}
			}

			fetchProjects()

			return () => {
				cancelled = true
			}
			// refreshKey intentionally used for refetch pattern
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [refreshKey])

		const refetch = () => setRefreshKey((k) => k + 1)

		return {
			projects: projectList,
			loading,
			error,
			refetch,
		}
	}

	/**
	 * Hook to get available slash commands
	 *
	 * @returns Object with findCommand function and commands array
	 */
	function useCommands() {
		const cfg = getOpencodeConfig(config)
		return useCommandsBase({ directory: cfg.directory })
	}

	/**
	 * Hook to create a new session
	 *
	 * @returns createSession function, loading state, error
	 */
	function useCreateSession() {
		const [isCreating, setIsCreating] = useState(false)
		const [error, setError] = useState<Error | null>(null)

		const createSession = useCallback(async (title?: string) => {
			try {
				setIsCreating(true)
				setError(null)

				// Call sessions.create() from @opencode-vibe/core/api
				const result = await sessions.create(title)

				return result
			} catch (err) {
				const errorObj = err instanceof Error ? err : new Error(String(err))
				setError(errorObj)
				return null
			} finally {
				setIsCreating(false)
			}
		}, [])

		return { createSession, isCreating, error }
	}

	/**
	 * Hook to search files in project
	 *
	 * @param query - Search query
	 * @returns Object with files array, loading state, error
	 */
	function useFileSearch(query: string, options: { debounceMs?: number } = {}) {
		const { debounceMs = 150 } = options
		const cfg = getOpencodeConfig(config)

		const [files, setFiles] = useState<string[]>([])
		const [isLoading, setIsLoading] = useState(false)
		const [error, setError] = useState<Error | null>(null)

		// Track debounce timeout
		const timeoutRef = useRef<Timer | null>(null)

		useEffect(() => {
			// Clear results for empty query
			if (!query) {
				setFiles([])
				setIsLoading(false)
				setError(null)
				return
			}

			// Cancel previous timeout
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}

			// Set loading state immediately for UX feedback
			setIsLoading(true)
			setError(null)

			// Debounce the API call
			timeoutRef.current = setTimeout(async () => {
				try {
					// Create client with directory scoping
					const client = createClient(cfg.directory)

					// Call SDK to get all matching files
					const response = await client.find.files({
						query: { query, dirs: "true" },
					})

					// Extract file paths from response
					const allFiles = response.data ?? []

					// Apply fuzzy filtering with fuzzysort
					const fuzzyResults = fuzzysort.go(query, allFiles, {
						limit: 10,
						threshold: -10000, // Allow fuzzy matches
					})

					// Extract file paths from results
					const filteredFiles = fuzzyResults.map((r) => r.target)

					setFiles(filteredFiles)
					setIsLoading(false)
				} catch (err) {
					console.error("[useFileSearch] Error fetching files:", err)
					setError(err instanceof Error ? err : new Error(String(err)))
					setFiles([])
					setIsLoading(false)
				}
			}, debounceMs)

			// Cleanup on unmount or query change
			return () => {
				if (timeoutRef.current) {
					clearTimeout(timeoutRef.current)
				}
			}
		}, [query, cfg.directory, debounceMs])

		return { files, isLoading, error }
	}

	return {
		useSession,
		useMessages,
		useSendMessage,
		useSessionList,
		useProviders,
		useProjects,
		useCommands,
		useCreateSession,
		useFileSearch,
	}
}
