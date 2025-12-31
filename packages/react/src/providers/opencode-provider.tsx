/**
 * OpenCodeProvider - Top-level provider that combines SSE and store
 *
 * Wraps children with SSEProvider and provides OpenCodeContext.
 * Handles:
 * - SSE connection and event routing to store via handleSSEEvent
 * - Initial data bootstrap (sessions + statuses + model limits)
 * - Session sync (messages, parts, todos, diffs)
 * - Context provision with {url, directory, ready, sync}
 *
 * Uses Zustand store as single source of truth.
 * Uses getState() pattern for actions in effects to prevent infinite loops.
 */

"use client"

import {
	createContext,
	useContext,
	useCallback,
	useEffect,
	useRef,
	useMemo,
	type ReactNode,
} from "react"
import { useOpencodeStore } from "../store"
import type { GlobalEvent } from "../store/types"
import { createClient } from "@opencode-vibe/core/client"
import { createRouter, createCaller, createRoutes, type Caller } from "@opencode-vibe/core/router"
import { useMultiServerSSE } from "../hooks/internal/use-multi-server-sse"

/**
 * Context value provided by OpenCodeProvider
 */
export interface OpencodeContextValue {
	/** Base URL for OpenCode server */
	url: string
	/** Current directory being synced */
	directory: string
	/** Whether initial data has been loaded */
	ready: boolean
	/** Sync a specific session (load messages, parts, etc) */
	sync: (sessionID: string) => Promise<void>
	/** Direct caller for invoking routes */
	caller: Caller
}

const OpencodeContext = createContext<OpencodeContextValue | null>(null)

/**
 * OpenCodeProvider props
 */
export interface OpencodeProviderProps {
	/** Base URL for OpenCode server */
	url: string
	/** Directory to sync */
	directory: string
	/** Children components */
	children: ReactNode
}

/**
 * Helper to get store actions without causing re-renders.
 * Zustand's getState() returns stable action references.
 */
const getStoreActions = () => useOpencodeStore.getState()

/**
 * OpenCodeProvider - Handles SSE events, bootstrap, and sync
 *
 * Uses useMultiServerSSE to connect to all discovered OpenCode servers
 * and routes events to the Zustand store via handleSSEEvent.
 */
export function OpencodeProvider({ url, directory, children }: OpencodeProviderProps) {
	// Create client and caller for this directory (stable across renders)
	const client = useMemo(() => createClient(directory), [directory])
	const caller = useMemo(() => {
		const router = createRouter(createRoutes())
		// Type assertion needed: SDK client type doesn't match router's minimal interface exactly
		// but is compatible at runtime
		return createCaller(router, { sdk: client as any })
	}, [client])

	const bootstrapCalledRef = useRef(false)
	const bootstrapRef = useRef<() => Promise<void>>(() => Promise.resolve())

	// Initialize directory state (once per directory)
	useEffect(() => {
		getStoreActions().initDirectory(directory)
	}, [directory])

	/**
	 * Bootstrap: Load initial data (sessions + statuses + model limits)
	 *
	 * Gracefully handles network failures - the app remains usable
	 * and SSE will provide updates when connection is restored.
	 */
	const bootstrap = useCallback(async () => {
		const store = getStoreActions()

		// Load sessions first (most important)
		try {
			const sessionsResponse = await client.session.list()
			const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000

			type SessionWithArchived = any // SDK type has time.archived
			const sessions = (sessionsResponse.data ?? ([] as SessionWithArchived[]))
				.filter((s: SessionWithArchived) => !s.time.archived)
				.sort((a: SessionWithArchived, b: SessionWithArchived) => a.id.localeCompare(b.id))
				.filter((s: SessionWithArchived, i: number) => {
					// Include first 20 sessions + any updated recently
					if (i < 20) return true
					return s.time.updated > fourHoursAgo
				})

			store.setSessions(directory, sessions)
			store.setSessionReady(directory, true)
		} catch (error) {
			// Network error or server not running - this is expected during dev
			// Don't spam the user, just log it
			console.warn(
				"[OpenCode] Failed to load sessions:",
				error instanceof Error ? error.message : error,
			)
			// Still mark as ready so UI doesn't hang
			store.setSessionReady(directory, true)
		}

		// Load session statuses separately (non-critical)
		try {
			const statusResponse = await client.session.status()
			if (statusResponse.data) {
				for (const [sessionID, status] of Object.entries(statusResponse.data)) {
					store.handleEvent(directory, {
						type: "session.status",
						properties: { sessionID, status },
					})
				}
			}
		} catch (error) {
			// Status fetch failed - not critical, SSE will update statuses
			console.warn(
				"[OpenCode] Failed to load statuses:",
				error instanceof Error ? error.message : error,
			)
		}

		// Load providers to cache model limits (for context usage calculation)
		try {
			const providerResponse = await client.provider.list()
			if (providerResponse.data?.all) {
				const modelLimits: Record<string, { context: number; output: number }> = {}

				for (const provider of providerResponse.data.all) {
					if (provider.models) {
						for (const [modelID, model] of Object.entries(provider.models)) {
							// Backend sends 'limit' not 'limits'
							const limit = (model as any).limit
							if (limit?.context && limit?.output) {
								modelLimits[modelID] = {
									context: limit.context,
									output: limit.output,
								}
							}
						}
					}
				}

				// Cache model limits in store
				if (Object.keys(modelLimits).length > 0) {
					store.setModelLimits(directory, modelLimits)
				}
			}
		} catch (error) {
			// Provider fetch failed - not critical, context usage will be unavailable
			console.warn(
				"[OpenCode] Failed to load providers:",
				error instanceof Error ? error.message : error,
			)
		}
	}, [directory, client])

	// Keep ref updated for stable access in callbacks
	bootstrapRef.current = bootstrap

	/**
	 * Sync a specific session (messages + parts + todos + diffs)
	 *
	 * Uses Promise.allSettled to fetch all data in parallel,
	 * gracefully handling partial failures.
	 */
	const sync = useCallback(
		async (sessionID: string) => {
			const store = getStoreActions()

			// Fetch all data in parallel, handling failures individually
			const [messagesResult, todoResult, diffResult] = await Promise.allSettled([
				client.session.messages({
					path: { id: sessionID },
					query: { limit: 100 },
				}),
				client.session.todo({ path: { id: sessionID } }),
				client.session.diff({ path: { id: sessionID } }),
			])

			// Process messages (most important)
			if (messagesResult.status === "fulfilled" && messagesResult.value.data) {
				const messages = messagesResult.value.data.map((m: any) => m.info)
				store.setMessages(directory, sessionID, messages)

				// Set parts for each message
				for (const msg of messagesResult.value.data) {
					store.setParts(directory, msg.info.id, msg.parts as any)
				}
			} else if (messagesResult.status === "rejected") {
				console.warn(
					"[OpenCode] Failed to sync messages:",
					messagesResult.reason?.message ?? messagesResult.reason,
				)
			}

			// Process todos (non-critical)
			if (todoResult.status === "fulfilled" && todoResult.value.data) {
				store.handleEvent(directory, {
					type: "todo.updated",
					properties: { sessionID, todos: todoResult.value.data },
				})
			}

			// Process diffs (non-critical)
			if (diffResult.status === "fulfilled" && diffResult.value.data) {
				store.handleEvent(directory, {
					type: "session.diff",
					properties: { sessionID, diff: diffResult.value.data },
				})
			}
		},
		[directory, client],
	)

	/**
	 * Handle incoming SSE events and route to store
	 */
	const handleEvent = useCallback(
		(event: GlobalEvent) => {
			const eventDirectory = event.directory
			const payload = event.payload
			const store = getStoreActions()

			// Route global events
			if (eventDirectory === "global") {
				// Handle global.disposed -> re-bootstrap
				if ((payload?.type as string) === "global.disposed") {
					bootstrapRef.current()
				}
				return
			}

			// Handle server.instance.disposed -> re-bootstrap (same as global.disposed)
			if ((payload?.type as string) === "server.instance.disposed") {
				bootstrapRef.current()
				return
			}

			// Only process events for our directory
			if (eventDirectory === directory) {
				store.handleEvent(directory, payload)
			}
		},
		[directory],
	)

	// Subscribe to SSE events from all discovered OpenCode servers
	// useMultiServerSSE manages connections to all servers and forwards events
	useMultiServerSSE({
		onEvent: handleEvent,
	})

	// Bootstrap on mount (once)
	useEffect(() => {
		if (!bootstrapCalledRef.current) {
			bootstrapCalledRef.current = true
			bootstrap()
		}
	}, [bootstrap])

	// Get ready state - this is the ONLY place we subscribe to store state
	const ready = useOpencodeStore((state) => state.directories[directory]?.ready ?? false)

	const value: OpencodeContextValue = {
		url,
		directory,
		ready,
		sync,
		caller,
	}

	return <OpencodeContext.Provider value={value}>{children}</OpencodeContext.Provider>
}

/**
 * useOpencode - Hook to access OpenCode context
 *
 * Must be used within an OpenCodeProvider.
 *
 * @returns OpencodeContextValue with url, directory, ready, sync
 * @throws Error if used outside OpenCodeProvider
 *
 * @example
 * ```tsx
 * const { url, directory, ready, sync } = useOpencode()
 *
 * useEffect(() => {
 *   if (ready) {
 *     sync(sessionID)
 *   }
 * }, [ready, sessionID, sync])
 * ```
 */
export function useOpencode() {
	const context = useContext(OpencodeContext)
	if (!context) {
		throw new Error("useOpencode must be used within OpencodeProvider")
	}
	return context
}
