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

import { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from "react"
import { useOpencodeStore } from "../store"
import { createClient } from "@opencode-vibe/core/client"
import { fetchModelLimitsWithRetry } from "../lib/bootstrap"
import { useWorld } from "../hooks/use-world"

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
 * OpenCodeProvider - Handles bootstrap and sync
 *
 * ARCHITECTURE CHANGE: SSE is now handled by World Stream automatically.
 * This provider only handles initial bootstrap (sessions, statuses, model limits).
 */
export function OpencodeProvider({ url, directory, children }: OpencodeProviderProps) {
	// Initialize World Stream (auto-discovers servers, connects SSE)
	useWorld()

	// getClient returns a Promise since createClient is now async
	const getClient = useCallback(() => createClient(directory), [directory])

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
			const client = await getClient()
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
			const client = await getClient()
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
		// Uses retry with exponential backoff for resilience
		const modelLimits = await fetchModelLimitsWithRetry(async () => {
			const client = await getClient()
			const providerResponse = await client.provider.list()

			const limits: Record<string, { context: number; output: number }> = {}

			if (providerResponse.data?.all) {
				for (const provider of providerResponse.data.all) {
					if (provider.models) {
						for (const [modelID, model] of Object.entries(provider.models)) {
							// Backend sends 'limit' not 'limits'
							const limit = (model as any).limit
							if (limit?.context && limit?.output) {
								limits[modelID] = {
									context: limit.context,
									output: limit.output,
								}
							}
						}
					}
				}
			}

			return limits
		})

		// Cache model limits in store
		if (Object.keys(modelLimits).length > 0) {
			store.setModelLimits(directory, modelLimits)
		} else {
			// Warn if limits unavailable after all retries
			console.warn(
				"[OpenCode] Model limits unavailable after retries. Context usage will show 0% until limits are loaded.",
			)
		}
	}, [directory, getClient])

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

			// Create client first (async)
			const client = await getClient()

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
		[directory, getClient],
	)

	// NOTE: SSE event handling is now done by World Stream automatically
	// No need to manually subscribe to events - useWorld() handles it

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
