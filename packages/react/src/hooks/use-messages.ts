/**
 * useMessages - Bridge Promise API to React state with SSE updates
 *
 * Wraps messages.list from @opencode-vibe/core/api and manages React state.
 * Subscribes to SSE events for real-time updates when messages are created/updated.
 *
 * @example
 * ```tsx
 * function MessageList({ sessionId }: { sessionId: string }) {
 *   const { messages, loading, error, refetch } = useMessages({ sessionId })
 *
 *   if (loading) return <div>Loading messages...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <ul>
 *       {messages.map(m => <li key={m.id}>{m.role}: {m.id}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 */

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { messages } from "@opencode-vibe/core/api"
import { multiServerSSE } from "@opencode-vibe/core/sse"
import { Binary } from "@opencode-vibe/core/utils"
import type { Message } from "@opencode-vibe/core/types"

export interface UseMessagesOptions {
	/** Session ID to fetch messages for */
	sessionId: string
	/** Project directory (optional) */
	directory?: string
	/** Initial data from server (hydration) - skips initial fetch if provided */
	initialData?: Message[]
}

export interface UseMessagesReturn {
	/** Array of messages, sorted by ID */
	messages: Message[]
	/** Loading state */
	loading: boolean
	/** Error if fetch failed */
	error: Error | null
	/** Refetch messages */
	refetch: () => void
}

/**
 * Hook to fetch message list with real-time SSE updates
 *
 * @param options - Options with sessionId and optional directory
 * @returns Object with messages, loading, error, and refetch
 */
export function useMessages(options: UseMessagesOptions): UseMessagesReturn {
	// Hydrate from server data if provided, otherwise start empty
	const [messageList, setMessageList] = useState<Message[]>(options.initialData ?? [])
	// Skip loading state if we have initial data (already hydrated)
	const [loading, setLoading] = useState(!options.initialData)
	const [error, setError] = useState<Error | null>(null)

	// Track sessionId in ref to avoid stale closures in SSE callback
	const sessionIdRef = useRef(options.sessionId)
	sessionIdRef.current = options.sessionId

	// Track if we've hydrated to avoid re-fetching on mount
	const hydratedRef = useRef(!!options.initialData)

	// Track if fetch is in progress to coordinate with SSE
	const fetchInProgressRef = useRef(false)

	const fetch = useCallback(() => {
		fetchInProgressRef.current = true
		setLoading(true)
		setError(null)

		messages
			.list(options.sessionId, options.directory)
			.then((data: Message[]) => {
				setMessageList(data)
				setError(null)
			})
			.catch((err: unknown) => {
				const error = err instanceof Error ? err : new Error(String(err))
				setError(error)
				setMessageList([])
			})
			.finally(() => {
				fetchInProgressRef.current = false
				setLoading(false)
			})
	}, [options.sessionId, options.directory])

	// Initial fetch - skip if hydrated from server
	useEffect(() => {
		if (hydratedRef.current) {
			// Already hydrated, don't fetch again
			hydratedRef.current = false // Allow future refetches
			return
		}
		fetch()
	}, [fetch])

	// Subscribe to SSE events for real-time updates
	useEffect(() => {
		const unsubscribe = multiServerSSE.onEvent((event) => {
			// Skip SSE updates while fetch is in progress to avoid race conditions
			if (fetchInProgressRef.current) return

			const { type, properties } = event.payload

			// Handle message.updated events (server uses this for both create and update)
			if (type !== "message.updated") return

			const messageData = properties.info as Message | undefined
			if (!messageData) return
			if (messageData.sessionID !== sessionIdRef.current) return

			setMessageList((prev) => {
				// Use binary insert/update for O(log n) performance
				const { found, index } = Binary.search(prev, messageData.id, (m) => m.id)
				if (found) {
					// Update existing message
					const updated = [...prev]
					updated[index] = messageData
					return updated
				}
				// Insert new message in sorted position
				return Binary.insert(prev, messageData, (m) => m.id)
			})
		})

		return unsubscribe
	}, []) // Empty deps - callback uses refs

	return {
		messages: messageList,
		loading,
		error,
		refetch: fetch,
	}
}
