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
	 * Bootstrap: Load initial data (model limits only - sessions come from World Stream)
	 *
	 * MIGRATION NOTE (ADR-018 - Zustand Elimination):
	 * Sessions, messages, and parts are now loaded by World Stream automatically.
	 * This bootstrap only loads model limits for context usage calculation.
	 *
	 * Gracefully handles network failures - the app remains usable
	 * and SSE will provide updates when connection is restored.
	 */
	const bootstrap = useCallback(async () => {
		const store = getStoreActions()

		// Sessions are now loaded by World Stream - mark as ready immediately
		store.setSessionReady(directory, true)

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
	 * Sync a specific session (todos + diffs only - messages come from World Stream)
	 *
	 * MIGRATION NOTE (ADR-018 - Zustand Elimination):
	 * Messages and parts are now loaded by World Stream automatically.
	 * This sync only loads todos and diffs which are still in Zustand store.
	 *
	 * Uses Promise.allSettled to fetch all data in parallel,
	 * gracefully handling partial failures.
	 */
	const sync = useCallback(
		async (sessionID: string) => {
			const store = getStoreActions()

			// Create client first (async)
			const client = await getClient()

			// Fetch todos and diffs in parallel (messages handled by World Stream)
			const [todoResult, diffResult] = await Promise.allSettled([
				client.session.todo({ path: { id: sessionID } }),
				client.session.diff({ path: { id: sessionID } }),
			])

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
