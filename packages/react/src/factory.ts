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
import type { Session, ContextUsage, CompactionState, SessionStatus } from "./store/types"
import { deriveSessionStatus, type DeriveSessionStatusOptions } from "./store/status-utils"
import { useCommands as useCommandsBase } from "./hooks/use-commands"
import { useSSE as useSSEBase } from "./hooks/internal/use-sse"
import type { UseSSEOptions, UseSSEReturn } from "./hooks/internal/use-sse"
import { useLiveTime as useLiveTimeBase } from "./hooks/internal/use-live-time"
import { useSubagent as useSubagentBase } from "./hooks/internal/use-subagent"
import type { UseSubagentOptions, UseSubagentReturn } from "./hooks/internal/use-subagent"
import { useProvider as useProviderBase } from "./hooks/internal/use-provider"
import type { UseProviderResult } from "./hooks/internal/use-provider"
import { useServers as useServersBase } from "./hooks/use-servers"
import type { UseServersReturn } from "./hooks/use-servers"
import { multiServerSSE } from "@opencode-vibe/core/sse"
import type { Prompt } from "./types/prompt"
import { providers, projects, sessions, prompt } from "@opencode-vibe/core/api"
import type { Provider, Project } from "@opencode-vibe/core/atoms"
import type { SlashCommand } from "./types/prompt"
import { createClient } from "./lib/client-stub"
import fuzzysort from "fuzzysort"
import {
	useMultiDirectorySessions as useMultiDirectorySessionsBase,
	type SessionDisplay,
} from "./hooks/use-multi-directory-sessions"
import {
	useMultiDirectoryStatus as useMultiDirectoryStatusBase,
	type UseMultiDirectoryStatusReturn,
} from "./hooks/use-multi-directory-status"
import { getContextUsage, getCompactionState } from "./lib/delegation-helpers"

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
 * @throws Error if no config found and no fallback provided (client-side only)
 *
 * @example
 * ```tsx
 * const config = getOpencodeConfig()
 * // { baseUrl: "/api/opencode/4056", directory: "/path" }
 * ```
 *
 * @remarks
 * SSR Safety: During server-side rendering, returns fallback or empty config.
 * Client components calling this during render will get empty config on server,
 * then real config after hydration. Use useEffect if you need client-only execution.
 */
export function getOpencodeConfig(fallback?: OpencodeConfig): OpencodeConfig {
	// 1. SSR guard - return fallback or placeholder during server render
	// CRITICAL: Client components still render on server in Next.js
	// This prevents errors when hooks call getOpencodeConfig during render
	if (typeof window === "undefined") {
		return fallback ?? { baseUrl: "", directory: "" }
	}

	// 2. Check globalThis (from SSR plugin)
	if (window.__OPENCODE) {
		return window.__OPENCODE
	}

	// 3. Fallback to provided config (for tests)
	if (fallback?.baseUrl) {
		return fallback
	}

	// 4. No config available - throw helpful error (client-side only)
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
					if (!dir) return undefined
					return dir.messages[sessionId]
				},
				[sessionId, cfg.directory],
			),
		)

		useEffect(() => {
			if (!cfg.directory) return
			useOpencodeStore.getState().initDirectory(cfg.directory)
		}, [cfg.directory])

		// CRITICAL: Use stable empty array to prevent infinite loop
		// Don't use || [] or ?? [] in render - creates new reference every time
		return useMemo(() => messages ?? [], [messages])
	}

	/**
	 * Hook for sending messages to a session with FIFO queue
	 *
	 * Self-contained implementation that doesn't depend on OpencodeProvider.
	 * Accepts full Prompt parts (text, file, image attachments).
	 *
	 * @param options - Object with sessionId
	 * @returns sendMessage function, isPending state, error, and queueLength
	 *
	 * @example
	 * ```tsx
	 * const { sendMessage, isPending, error, queueLength } = useSendMessage({ sessionId: "session-123" })
	 * const parts: Prompt = [
	 *   { type: "text", content: "Fix bug in ", start: 0, end: 11 },
	 *   { type: "file", path: "src/auth.ts", content: "@src/auth.ts", start: 11, end: 23 }
	 * ]
	 * await sendMessage(parts)
	 * ```
	 */
	function useSendMessage(options: { sessionId: string }) {
		const cfg = getOpencodeConfig(config)
		console.log("[useSendMessage] config:", cfg)
		const [isLoading, setIsLoading] = useState(false)
		const [error, setError] = useState<Error | undefined>(undefined)
		const [queueLength, setQueueLength] = useState(0)

		// Get command registry for slash command detection
		const { findCommand } = useCommandsBase()

		// Types for message queue
		type ParsedCommand =
			| { isCommand: false }
			| {
					isCommand: true
					commandName: string
					arguments: string
					type: SlashCommand["type"]
			  }

		interface QueuedMessage {
			parts: Prompt
			resolve: () => void
			reject: (error: Error) => void
		}

		/**
		 * Parse prompt parts to detect slash commands.
		 * Only text parts are checked - file/image parts are ignored.
		 */
		const parseSlashCommand = useCallback(
			(parts: Prompt): ParsedCommand => {
				// Extract text content only (ignore file/image parts)
				const text = parts
					.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
					.map((p) => p.content)
					.join("")
					.trim()

				// Not a command if doesn't start with /
				if (!text.startsWith("/")) {
					return { isCommand: false }
				}

				// Parse command name and arguments
				const [cmdPart = "", ...argParts] = text.split(" ")
				const commandName = cmdPart.slice(1) // Remove leading /
				const args = argParts.join(" ")

				// Look up command in registry
				const command = findCommand(commandName)
				if (!command) {
					// Unknown command - treat as regular prompt
					return { isCommand: false }
				}

				return {
					isCommand: true,
					commandName,
					arguments: args,
					type: command.type,
				}
			},
			[findCommand],
		)

		// Queue for pending messages
		const queueRef = useRef<QueuedMessage[]>([])
		const isProcessingRef = useRef(false)
		const processNextRef = useRef<(() => Promise<void>) | undefined>(undefined)

		// Track session status to know when to process next message
		const status = useSessionStatus(options.sessionId)
		const running = status === "running"

		/**
		 * Process a single message via API.
		 *
		 * Routes messages based on content:
		 * - Custom slash commands → session.command route
		 * - Builtin slash commands → skip (handled client-side)
		 * - Regular prompts → session.promptAsync route
		 */
		const processMessage = useCallback(
			async (parts: Prompt): Promise<boolean> => {
				console.log("[processMessage] parts:", parts)
				// Check if this is a slash command
				const parsed = parseSlashCommand(parts)
				console.log("[processMessage] parsed:", parsed)

				if (parsed.isCommand) {
					if (parsed.type === "custom") {
						// Custom command - route to session.command
						console.log("[processMessage] sending custom command:", parsed.commandName)
						await sessions.command(
							options.sessionId,
							parsed.commandName,
							parsed.arguments,
							cfg.directory,
						)
						return true
					}
					// Builtin command - skip, handled client-side
					console.log("[processMessage] builtin command, skipping")
					return false
				}

				// Regular prompt - convert and send via session.promptAsync
				const apiParts = prompt.convertToApiParts(parts, cfg.directory || "")
				console.log("[processMessage] sending prompt:", {
					sessionId: options.sessionId,
					apiParts,
					directory: cfg.directory,
				})
				await sessions.promptAsync(options.sessionId, apiParts, undefined, cfg.directory)
				console.log("[processMessage] prompt sent successfully")
				return true
			},
			[options.sessionId, cfg.directory, parseSlashCommand],
		)

		// Process next message from queue if session is idle
		const processNext = useCallback(async () => {
			// Don't process if:
			// - Already processing a message
			// - Queue is empty
			// - Session is running (server-side AI is busy)
			if (isProcessingRef.current || queueRef.current.length === 0 || running) {
				return
			}

			isProcessingRef.current = true
			setIsLoading(true)

			const message = queueRef.current[0]! // Peek first

			try {
				setError(undefined)
				// Fire the message (promptAsync returns immediately - 204 response)
				await processMessage(message.parts)
				// Remove from queue after send completes
				queueRef.current.shift()
				setQueueLength(queueRef.current.length)
				message.resolve()
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err))
				setError(error)
				// Remove failed message from queue
				queueRef.current.shift()
				setQueueLength(queueRef.current.length)
				message.reject(error)
			} finally {
				isProcessingRef.current = false
				setIsLoading(false)

				// After finishing, try to process next message in queue
				if (queueRef.current.length > 0 && processNextRef.current) {
					// Use setTimeout to avoid recursive call stack
					setTimeout(() => processNextRef.current?.(), 0)
				}
			}
		}, [processMessage, running])

		// Store processNext in ref so it can call itself without circular dep
		processNextRef.current = processNext

		const sendMessage = useCallback(
			async (parts: Prompt) => {
				// Don't send empty messages
				if (parts.length === 0) {
					return
				}

				return new Promise<void>((resolve, reject) => {
					// Add to queue
					queueRef.current.push({ parts, resolve, reject })
					setQueueLength(queueRef.current.length)

					// Try to process immediately if session is idle
					processNext()
				})
			},
			[processNext],
		)

		// Watch session status - when session becomes idle, process next queued message
		useEffect(() => {
			// Session became idle - process next message in queue
			if (!running && queueRef.current.length > 0 && !isProcessingRef.current) {
				processNext()
			}
		}, [running, processNext])

		return {
			sendMessage,
			isPending: isLoading,
			error,
			queueLength,
		}
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

		// Get sessions array from store (stable reference via Immer)
		const sessions = useOpencodeStore((state) => state.directories[cfg.directory]?.sessions)

		// CRITICAL: Filter in useMemo to avoid creating new array on every render
		// The sessions reference from Zustand only changes when sessions actually update
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

		// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is intentionally used to trigger refetch
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

		// eslint-disable-next-line react-hooks/exhaustive-deps
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
					// Create client with directory scoping (now async)
					const client = await createClient(cfg.directory)

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

	/**
	 * Hook for SSE connection with config-aware URL
	 *
	 * DEPRECATED: This hook is broken. Use useSSEEvents() instead.
	 * Components should use store selectors, not raw SSE events.
	 *
	 * @param options - Optional override for url (uses config baseUrl by default)
	 * @returns SSE connection state with events, connected, error
	 *
	 * @example
	 * ```tsx
	 * // ❌ DON'T USE - broken
	 * const { events, connected, error } = useSSE()
	 *
	 * // ✅ USE - works correctly
	 * useSSEEvents() // At top level
	 * const status = useSessionStatus(sessionId) // Subscribe to store
	 * ```
	 */
	function useSSE(options?: Partial<UseSSEOptions>): UseSSEReturn {
		console.warn(
			"[useSSE] DEPRECATED: This hook is broken. Use useSSEEvents() + store selectors instead.",
		)
		// Only call getOpencodeConfig if we need the baseUrl
		// This allows useSSE({ url: "..." }) to work without config
		const url = options?.url ?? getOpencodeConfig(config).baseUrl
		return useSSEBase({
			url,
			heartbeatTimeout: options?.heartbeatTimeout,
		})
	}

	/**
	 * Hook for session status (running/idle)
	 *
	 * Unified status derivation using deriveSessionStatus utility.
	 * Combines three sources of truth:
	 * 1. Main session status from store (SSE session.status events)
	 * 2. Sub-agent activity (task parts with status="running")
	 * 3. Last message check (bootstrap edge case, opt-in)
	 *
	 * @param sessionId - Session ID
	 * @param options - Status derivation options
	 * @returns Session status ("running" | "completed")
	 *
	 * @example Basic usage (default: includes sub-agents, excludes last message check)
	 * ```tsx
	 * const status = useSessionStatus(sessionId)
	 * if (status === "running") { ... }
	 * ```
	 *
	 * @example With bootstrap last message check
	 * ```tsx
	 * const status = useSessionStatus(sessionId, { includeLastMessage: true })
	 * ```
	 *
	 * @example Without sub-agent check
	 * ```tsx
	 * const status = useSessionStatus(sessionId, { includeSubAgents: false })
	 * ```
	 */
	function useSessionStatus(
		sessionId: string,
		options?: DeriveSessionStatusOptions,
	): SessionStatus {
		const cfg = getOpencodeConfig(config)
		return useOpencodeStore(
			useCallback(
				(state) => {
					return deriveSessionStatus(state, sessionId, cfg.directory, options)
				},
				[sessionId, cfg.directory, options],
			),
		)
	}

	/**
	 * Hook for compaction state
	 *
	 * Delegates to World Stream first (via delegation helper), falls back to Zustand.
	 * Factory doesn't have World Stream yet, so worldValue is undefined.
	 *
	 * @param sessionId - Session ID
	 * @returns Compaction state
	 *
	 * @example
	 * ```tsx
	 * const { isCompacting, progress } = useCompactionState(sessionId)
	 * ```
	 */
	function useCompactionState(sessionId: string): CompactionState {
		return useOpencodeStore(
			useCallback(
				(state) => {
					// Factory doesn't have World Stream yet - returns default
					return getCompactionState(undefined)
				},
				[sessionId],
			),
		)
	}

	/**
	 * Hook for context usage (token counts)
	 *
	 * Delegates to World Stream first (via delegation helper), falls back to Zustand.
	 * Factory doesn't have World Stream yet, so worldValue is undefined.
	 *
	 * @param sessionId - Session ID
	 * @returns Context usage state
	 *
	 * @example
	 * ```tsx
	 * const { used, limit, percentage } = useContextUsage(sessionId)
	 * ```
	 */
	function useContextUsage(sessionId: string): ContextUsage {
		return useOpencodeStore(
			useCallback(
				(state) => {
					// Factory doesn't have World Stream yet - returns default
					return getContextUsage(undefined)
				},
				[sessionId],
			),
		)
	}

	/**
	 * Hook for live time updates (re-renders at interval)
	 *
	 * @param interval - Milliseconds between ticks (default: 60000)
	 * @returns Tick counter
	 *
	 * @example
	 * ```tsx
	 * const tick = useLiveTime() // Re-render every minute
	 * ```
	 */
	function useLiveTime(interval?: number): number {
		return useLiveTimeBase(interval)
	}

	/**
	 * Hook for accessing a specific part's subagent
	 *
	 * @param options - Object with partId
	 * @returns Subagent state and actions
	 *
	 * @example
	 * ```tsx
	 * const { subagent, isExpanded, toggleExpanded } = useSubagent({ partId: part.id })
	 * ```
	 */
	function useSubagent(options: UseSubagentOptions): UseSubagentReturn {
		return useSubagentBase(options)
	}

	/**
	 * Hook for server discovery (Effect-based)
	 *
	 * @returns Servers, loading state, error, refetch
	 *
	 * @example
	 * ```tsx
	 * const { servers, loading } = useServersEffect()
	 * ```
	 */
	function useServersEffect(): UseServersReturn {
		return useServersBase()
	}

	/**
	 * Hook to get SSE connection status from multiServerSSE
	 *
	 * SSR-safe: Returns default state during server render, hydrates with actual state on client.
	 *
	 * @returns Connection status with connected state, server count, and discovery state
	 *
	 * @example
	 * ```tsx
	 * const { connected, serverCount, discovering } = useConnectionStatus()
	 * if (connected) {
	 *   console.log(`Connected to ${serverCount} servers`)
	 * }
	 * ```
	 */
	function useConnectionStatus(): {
		connected: boolean
		serverCount: number
		discovering: boolean
	} {
		// SSR-safe initial state
		const [state, setState] = useState(() => {
			// During SSR, return safe defaults
			if (typeof window === "undefined") {
				return {
					connected: false,
					serverCount: 0,
					discovering: true,
				}
			}
			// On client, get initial state immediately
			const sseState = multiServerSSE.getCurrentState()
			return {
				connected: sseState.connected,
				serverCount: sseState.servers.length,
				discovering: sseState.discovering,
			}
		})

		useEffect(() => {
			// Subscribe to state changes via observable pattern (no polling needed)
			const unsubscribe = multiServerSSE.onStateChange((sseState) => {
				setState({
					connected: sseState.connected,
					serverCount: sseState.servers.length,
					discovering: sseState.discovering,
				})
			})

			return unsubscribe
		}, [])

		return state
	}

	/**
	 * Hook to start SSE and route events to the Zustand store
	 *
	 * **This is the critical hook that wires up real-time updates.**
	 * Call this once at the top level (e.g., in OpencodeProvider or root layout).
	 *
	 * **What it does**:
	 * 1. Starts multiServerSSE singleton (idempotent - safe to call multiple times)
	 * 2. Subscribes to ALL SSE events (not filtered by directory)
	 * 3. Routes events to `store.handleSSEEvent()` which auto-initializes directories
	 *
	 * **CRITICAL**: This hook processes events for **ALL directories**, not just the current one.
	 * This enables cross-directory features like the project list showing status updates
	 * for multiple OpenCode instances running on different ports.
	 *
	 * **Data flow**:
	 * ```
	 * multiServerSSE.start() → discovers backend servers on ports 4056-4066
	 *   → connects to /sse endpoints
	 *   → onEvent callback fires for each SSE event
	 *   → store.handleSSEEvent(event) auto-creates directory if needed
	 *   → store.handleEvent(directory, payload) routes to specific handler
	 *   → store updates → components re-render via selectors
	 * ```
	 *
	 * **Why not filter by directory?**
	 * The store's `handleSSEEvent` auto-creates directory state, so events for
	 * any directory are safe to process. This allows the UI to react to changes
	 * in other projects (e.g., showing when a background session starts running).
	 *
	 * @example Top-level usage
	 * ```tsx
	 * function OpencodeProvider({ children }) {
	 *   useSSEEvents() // Start SSE once at top level
	 *   return <>{children}</>
	 * }
	 *
	 * function SessionPage({ sessionId }) {
	 *   // No need to call useSSEEvents here - already running
	 *   const messages = useMessages(sessionId) // Updates in real-time
	 *   return <MessageList messages={messages} />
	 * }
	 * ```
	 *
	 * @example Cross-directory updates
	 * ```tsx
	 * function ProjectList() {
	 *   useSSEEvents() // Processes events for all projects
	 *   const projects = useProjects()
	 *   return projects.map(p => {
	 *     // Status updates work even if project is on different port
	 *     const status = useSessionStatus(p.latestSession.id)
	 *     return <ProjectCard status={status} />
	 *   })
	 * }
	 * ```
	 */
	function useSSEEvents(): void {
		const cfg = getOpencodeConfig(config)

		// Start MultiServerSSE singleton (idempotent)
		useEffect(() => {
			console.log("[useSSEEvents] Starting multiServerSSE")
			multiServerSSE.start()
		}, [])

		/**
		 * Subscribe to events and route to store
		 *
		 * **Key behavior**: Subscribes to ALL events from multiServerSSE, not filtered by directory.
		 * The store's handleSSEEvent will auto-create directory state if needed, so this is safe.
		 *
		 * **Why getState()?** Using `useOpencodeStore.getState()` instead of the hook return value
		 * prevents the dependency array from causing re-subscriptions on every store update.
		 * The hook return value creates a new reference on every render (Zustand gotcha).
		 */
		useEffect(() => {
			console.log("[useSSEEvents] Subscribing to SSE events (all directories)")

			const unsubscribe = multiServerSSE.onEvent((event) => {
				/**
				 * Process events for ALL directories
				 *
				 * The store auto-initializes directory state via handleSSEEvent's
				 * ensureDirectory logic. This enables cross-directory updates
				 * (e.g., project list showing status updates for multiple OpenCode
				 * instances on different ports).
				 */
				console.log("[useSSEEvents] Received event for", event.directory, ":", event.payload.type)

				// Route to store (getState() for stable reference)
				// Type cast: SSE event payload is SDK Event at runtime, but typed as generic object
				useOpencodeStore.getState().handleSSEEvent({
					directory: event.directory,
					// @ts-expect-error - SSE event payload has correct shape but generic type
					payload: event.payload,
				})
			})

			return () => {
				console.log("[useSSEEvents] Unsubscribing from SSE events")
				unsubscribe()
			}
		}, [])
	}

	/**
	 * @deprecated Use `useSSEEvents` instead. This hook subscribes to events, it doesn't "sync" anything.
	 */
	const useSSESync = useSSEEvents

	/**
	 * Hook for fetching provider data with connection status and defaults
	 *
	 * @returns Provider data with { all, connected, defaults }, loading, error, refetch
	 *
	 * @example
	 * ```tsx
	 * const { data, loading, error } = useProvider()
	 * if (data) {
	 *   console.log(data.all, data.connected, data.defaults)
	 * }
	 * ```
	 */
	function useProvider(): UseProviderResult {
		return useProviderBase()
	}

	/**
	 * Hook for accessing messages with their associated parts
	 *
	 * @param sessionId - Session ID to get messages for
	 * @returns Array of messages with parts
	 *
	 * @example
	 * ```tsx
	 * const messages = useMessagesWithParts("session-123")
	 * messages.forEach(msg => {
	 *   console.log(msg.info.role, msg.parts.length)
	 * })
	 * ```
	 */
	function useMessagesWithParts(sessionId: string) {
		const cfg = getOpencodeConfig(config)

		// Select raw data from store - these are stable references from Immer
		const messages = useOpencodeStore(
			useCallback(
				(state) => {
					const dir = state.directories[cfg.directory]
					if (!dir) return undefined
					return dir.messages[sessionId]
				},
				[sessionId, cfg.directory],
			),
		)
		const partsMap = useOpencodeStore(
			useCallback(
				(state) => {
					const dir = state.directories[cfg.directory]
					if (!dir) return undefined
					return dir.parts
				},
				[cfg.directory],
			),
		)

		useEffect(() => {
			if (!cfg.directory) return
			useOpencodeStore.getState().initDirectory(cfg.directory)
		}, [cfg.directory])

		// Derive the combined structure with useMemo to avoid infinite loops
		// Only recomputes when messages or partsMap references change
		return useMemo(() => {
			if (!messages) return []

			return messages.map((message) => ({
				info: message,
				parts: partsMap?.[message.id] ?? [],
			}))
		}, [messages, partsMap])
	}

	/**
	 * Hook to get sessions from multiple directories
	 *
	 * Direct re-export of the base hook (no config wrapper needed - already config-free)
	 *
	 * @param directories - Array of directory paths
	 * @returns Record of directory -> SessionDisplay[]
	 */
	function useMultiDirectorySessions(directories: string[]): Record<string, SessionDisplay[]> {
		return useMultiDirectorySessionsBase(directories)
	}

	/**
	 * Hook to track session statuses across multiple directories
	 *
	 * Direct re-export of the base hook (no config wrapper needed - already config-free)
	 *
	 * @param directories - Array of directory paths
	 * @param initialSessions - Optional initial session data for bootstrap
	 * @returns Object with sessionStatuses and lastActivity
	 */
	function useMultiDirectoryStatus(
		directories: string[],
		initialSessions?: Record<string, Array<{ id: string; formattedTime: string }>>,
	): UseMultiDirectoryStatusReturn {
		return useMultiDirectoryStatusBase(directories, initialSessions)
	}

	return {
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
		useSSESync, // deprecated alias
		useConnectionStatus,
		useSessionStatus,
		useCompactionState,
		useContextUsage,
		useLiveTime,
		useSubagent,
		useServersEffect,
		useMultiDirectorySessions,
		useMultiDirectoryStatus,
	}
}

/**
 * Re-export multi-directory hooks for direct import
 */
export {
	useMultiDirectorySessions,
	type SessionDisplay,
} from "./hooks/use-multi-directory-sessions"
export {
	useMultiDirectoryStatus,
	type UseMultiDirectoryStatusReturn,
} from "./hooks/use-multi-directory-status"

/**
 * Format token count with K/M suffix
 *
 * @param n - Token count
 * @returns Formatted string (e.g., "1.5K", "2.3M")
 */
export function formatTokens(n: number): string {
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
	return n.toString()
}
