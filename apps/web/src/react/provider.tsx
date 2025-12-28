/**
 * OpenCodeProvider - Top-level provider that combines SSE and store
 *
 * Wraps children with SSEProvider and provides OpenCodeContext.
 * Handles:
 * - SSE connection and event routing to store via handleEvent
 * - Initial data bootstrap (sessions + statuses)
 * - Session sync (messages, parts, todos, diffs)
 * - Context provision with {url, directory, ready, sync}
 *
 * Per SYNC_IMPLEMENTATION.md lines 735-900.
 *
 * @example
 * ```tsx
 * <OpenCodeProvider url="http://localhost:3000" directory="/path/to/project">
 *   <App />
 * </OpenCodeProvider>
 * ```
 */

"use client"

import { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from "react"
import { toast } from "sonner"
import { useSSE } from "./use-sse"
import { useOpencodeStore } from "./store"
import { createClient } from "@/core/client"
import type { GlobalEvent, Session as SDKSession } from "@opencode-ai/sdk/client"

/**
 * Context value provided by OpenCodeProvider
 */
export interface OpenCodeContextValue {
	/** Base URL for OpenCode server */
	url: string
	/** Current directory being synced */
	directory: string
	/** Whether initial data has been loaded */
	ready: boolean
	/** Sync a specific session (load messages, parts, etc) */
	sync: (sessionID: string) => Promise<void>
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null)

/**
 * OpenCodeProvider props
 */
export interface OpenCodeProviderProps {
	/** Base URL for OpenCode server */
	url: string
	/** Directory to sync */
	directory: string
	/** Children components */
	children: ReactNode
}

/**
 * OpenCodeProvider - Handles SSE events, bootstrap, and sync
 */
export function OpenCodeProvider({ url, directory, children }: OpenCodeProviderProps) {
	const store = useOpencodeStore()
	const clientRef = useRef(createClient(directory))

	// Initialize directory state
	useEffect(() => {
		store.initDirectory(directory)
	}, [directory, store])

	/**
	 * Bootstrap: Load initial data (sessions + statuses)
	 *
	 * Gracefully handles network failures - the app remains usable
	 * and SSE will provide updates when connection is restored.
	 */
	const bootstrap = useCallback(async () => {
		const client = clientRef.current

		// Load sessions first (most important)
		try {
			const sessionsResponse = await client.session.list()
			const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000

			type SessionWithArchived = SDKSession & { time: { archived?: number } }
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
	}, [directory, store])

	/**
	 * Sync a specific session (messages + parts + todos + diffs)
	 *
	 * Uses Promise.allSettled to fetch all data in parallel,
	 * gracefully handling partial failures.
	 */
	const sync = useCallback(
		async (sessionID: string) => {
			const client = clientRef.current

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
		[directory, store],
	)

	/**
	 * Handle incoming SSE events and route to store
	 */
	const handleEvent = useCallback(
		(event: GlobalEvent) => {
			const eventDirectory = event.directory
			const payload = event.payload

			// Route global events
			if (eventDirectory === "global") {
				// Handle global.disposed -> re-bootstrap
				if ((payload?.type as string) === "global.disposed") {
					bootstrap()
				}
				return
			}

			// Handle server.instance.disposed -> re-bootstrap (same as global.disposed)
			if ((payload?.type as string) === "server.instance.disposed") {
				bootstrap()
				return
			}

			// Only process events for our directory
			if (eventDirectory === directory) {
				// Handle session.error with toast notification
				if ((payload?.type as string) === "session.error") {
					const error = (payload as any)?.properties?.error
					toast.error("Session Error", {
						description: error?.message ?? "An unknown error occurred",
						duration: 5000,
					})
				}

				store.handleEvent(directory, payload)
			}
		},
		[directory, store, bootstrap],
	)

	// Subscribe to SSE events
	const { subscribe } = useSSE()

	// Subscribe to all relevant event types
	useEffect(() => {
		const eventTypes = [
			"session.created",
			"session.updated",
			"session.deleted",
			"session.diff",
			"session.status",
			"session.error",
			"message.created",
			"message.updated",
			"message.removed",
			"message.part.updated",
			"message.part.removed",
			"todo.updated",
			"project.updated",
			"provider.updated",
			"global.disposed",
			"server.heartbeat",
		] as const

		const unsubscribers = eventTypes.map((eventType) => subscribe(eventType, handleEvent))

		return () => {
			for (const unsub of unsubscribers) {
				unsub()
			}
		}
	}, [subscribe, handleEvent])

	// Bootstrap on mount
	useEffect(() => {
		bootstrap()
	}, [bootstrap])

	// Get ready state
	const dirState = store.directories[directory]
	const ready = dirState?.ready ?? false

	const value: OpenCodeContextValue = {
		url,
		directory,
		ready,
		sync,
	}

	return <OpenCodeContext.Provider value={value}>{children}</OpenCodeContext.Provider>
}

/**
 * useOpenCode - Hook to access OpenCode context
 *
 * Must be used within an OpenCodeProvider.
 *
 * @returns OpenCodeContextValue with url, directory, ready, sync
 * @throws Error if used outside OpenCodeProvider
 *
 * @example
 * ```tsx
 * const { url, directory, ready, sync } = useOpenCode()
 *
 * useEffect(() => {
 *   if (ready) {
 *     sync(sessionID)
 *   }
 * }, [ready, sessionID, sync])
 * ```
 */
export function useOpenCode(): OpenCodeContextValue {
	const context = useContext(OpenCodeContext)
	if (!context) {
		throw new Error("useOpenCode must be used within OpenCodeProvider")
	}
	return context
}
