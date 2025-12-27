/**
 * useSSE - Real-time event subscription hook for OpenCode
 *
 * Provides a context-based SSE subscription system. Components call useSSE()
 * to get a subscribe function, then subscribe to specific event types.
 *
 * The SSE connection is managed at the app level via SSEProvider.
 * Per SYNC_IMPLEMENTATION.md requirements (lines 296-413, 735-900).
 *
 * @example Basic usage
 * ```tsx
 * // In a component
 * const { subscribe } = useSSE()
 *
 * useEffect(() => {
 *   const unsubscribe = subscribe("message.updated", (event) => {
 *     console.log("Message updated:", event)
 *   })
 *   return unsubscribe
 * }, [subscribe])
 * ```
 *
 * @example In app layout (provider setup)
 * ```tsx
 * <SSEProvider url="http://localhost:3000">
 *   {children}
 * </SSEProvider>
 * ```
 */

import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useCallback,
	type ReactNode,
} from "react"
import type { GlobalEvent } from "@opencode-ai/sdk/client"

/**
 * Event types that can be subscribed to
 */
export type SSEEventType =
	| "session.created"
	| "session.updated"
	| "session.deleted"
	| "session.diff"
	| "session.status"
	| "session.error"
	| "message.created"
	| "message.updated"
	| "message.removed"
	| "message.part.updated"
	| "message.part.removed"
	| "todo.updated"
	| "project.updated"
	| "global.disposed"
	| "server.connected"
	| "server.heartbeat"
	| "permission.updated"
	| "permission.replied"

/**
 * Callback function for SSE event subscriptions
 */
export type SSEEventCallback = (event: GlobalEvent) => void

/**
 * SSE context value - what useSSE() returns
 */
interface SSEContextValue {
	/** Subscribe to a specific event type. Returns unsubscribe function. */
	subscribe: (eventType: SSEEventType, callback: SSEEventCallback) => () => void
	/** Whether SSE is currently connected */
	connected: boolean
	/** Manually trigger reconnection */
	reconnect: () => void
}

const SSEContext = createContext<SSEContextValue | null>(null)

/**
 * SSE Provider props
 */
interface SSEProviderProps {
	/** Base URL for SSE endpoint (will append /global/event) */
	url: string
	/** Initial retry delay in ms (default: 3000 = 3s) */
	retryDelay?: number
	/** Maximum number of retry attempts (default: 10) */
	maxRetries?: number
	/** Children components */
	children: ReactNode
}

/**
 * SSEProvider - Manages SSE connection and event distribution
 *
 * Wrap your app with this provider to enable SSE subscriptions.
 * Uses fetch-based SSE with exponential backoff (3s → 6s → 12s → 24s → 30s cap).
 */
export function SSEProvider({
	url,
	retryDelay = 3000,
	maxRetries = 10,
	children,
}: SSEProviderProps) {
	const retryCount = useRef(0)
	const abortController = useRef<AbortController | null>(null)
	const connectedRef = useRef(false)
	const listenersRef = useRef<Map<SSEEventType, Set<SSEEventCallback>>>(new Map())

	/**
	 * Dispatch event to all subscribers of that event type
	 */
	const dispatchEvent = useCallback((event: GlobalEvent) => {
		const eventType = event.payload?.type as SSEEventType
		if (!eventType) return

		const callbacks = listenersRef.current.get(eventType)
		if (callbacks) {
			for (const callback of callbacks) {
				try {
					callback(event)
				} catch (error) {
					console.error(`SSE callback error for ${eventType}:`, error)
				}
			}
		}
	}, [])

	/**
	 * Connect to SSE endpoint
	 */
	const connect = useCallback(async () => {
		// Abort any existing connection
		abortController.current?.abort()
		abortController.current = new AbortController()

		try {
			const response = await fetch(`${url}/global/event`, {
				signal: abortController.current.signal,
				headers: {
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
				},
			})

			if (!response.ok) {
				throw new Error(`SSE failed: ${response.status} ${response.statusText}`)
			}

			if (!response.body) {
				throw new Error("No body in SSE response")
			}

			// Reset retry count on successful connection
			retryCount.current = 0
			connectedRef.current = true

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
			let buffer = ""

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += value
				const chunks = buffer.split("\n\n")
				buffer = chunks.pop() ?? ""

				for (const chunk of chunks) {
					const lines = chunk.split("\n")
					const dataLines: string[] = []

					for (const line of lines) {
						if (line.startsWith("data:")) {
							dataLines.push(line.replace(/^data:\s*/, ""))
						}
					}

					if (dataLines.length) {
						try {
							const data = JSON.parse(dataLines.join("\n")) as GlobalEvent
							dispatchEvent(data)
						} catch (e) {
							console.error("Failed to parse SSE event:", e)
						}
					}
				}
			}

			// Stream ended normally - reconnect
			connectedRef.current = false
			if (retryCount.current < maxRetries) {
				const backoff = Math.min(retryDelay * 2 ** retryCount.current, 30000)
				retryCount.current++
				setTimeout(connect, backoff)
			}
		} catch (error) {
			if ((error as Error).name === "AbortError") return

			connectedRef.current = false
			console.error("SSE connection error:", error)

			// Retry with exponential backoff
			if (retryCount.current < maxRetries) {
				const backoff = Math.min(retryDelay * 2 ** retryCount.current, 30000)
				retryCount.current++
				setTimeout(connect, backoff)
			}
		}
	}, [url, retryDelay, maxRetries, dispatchEvent])

	/**
	 * Subscribe to an event type
	 */
	const subscribe = useCallback(
		(eventType: SSEEventType, callback: SSEEventCallback): (() => void) => {
			if (!listenersRef.current.has(eventType)) {
				listenersRef.current.set(eventType, new Set())
			}
			listenersRef.current.get(eventType)!.add(callback)

			// Return unsubscribe function
			return () => {
				const callbacks = listenersRef.current.get(eventType)
				if (callbacks) {
					callbacks.delete(callback)
					if (callbacks.size === 0) {
						listenersRef.current.delete(eventType)
					}
				}
			}
		},
		[],
	)

	/**
	 * Manual reconnect
	 */
	const reconnect = useCallback(() => {
		retryCount.current = 0
		connect()
	}, [connect])

	// Connect on mount, cleanup on unmount
	useEffect(() => {
		connect()
		return () => {
			abortController.current?.abort()
		}
	}, [connect])

	const value: SSEContextValue = {
		subscribe,
		connected: connectedRef.current,
		reconnect,
	}

	return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>
}

/**
 * useSSE - Hook to access SSE subscription system
 *
 * Must be used within an SSEProvider. Returns subscribe function
 * for subscribing to specific event types.
 *
 * @returns Object with subscribe function, connected state, and reconnect function
 * @throws Error if used outside SSEProvider
 *
 * @example
 * ```tsx
 * const { subscribe } = useSSE()
 *
 * useEffect(() => {
 *   const unsubscribe = subscribe("message.updated", (event) => {
 *     console.log("Message:", event.payload)
 *   })
 *   return unsubscribe
 * }, [subscribe])
 * ```
 */
export function useSSE(): SSEContextValue {
	const context = useContext(SSEContext)
	if (!context) {
		throw new Error("useSSE must be used within an SSEProvider")
	}
	return context
}

/**
 * SSE hook options (for direct connection without provider)
 */
export interface SSEOptions {
	/** Base URL for SSE endpoint (will append /global/event) */
	url: string
	/** Called when an event is received */
	onEvent: (event: GlobalEvent) => void
	/** Called when an error occurs (before retry) */
	onError?: (error: Error) => void
	/** Called when successfully connected */
	onConnect?: () => void
	/** Initial retry delay in ms (default: 3000 = 3s) */
	retryDelay?: number
	/** Maximum number of retry attempts (default: 10) */
	maxRetries?: number
}

/**
 * useSSEDirect - Low-level SSE hook for direct connection
 *
 * Use this when you need direct control over the SSE connection
 * without the provider pattern. For most cases, use SSEProvider + useSSE instead.
 *
 * Features:
 * - Fetch-based SSE (not EventSource) for better control
 * - Exponential backoff: 3s → 6s → 12s → 24s → 30s (capped)
 * - Proper abort controller cleanup
 * - Buffer handling for chunked SSE data
 * - Callbacks: onEvent, onError, onConnect
 * - Returns { reconnect } function for manual reconnection
 */
export function useSSEDirect({
	url,
	onEvent,
	onError,
	onConnect,
	retryDelay = 3000,
	maxRetries = 10,
}: SSEOptions) {
	const retryCount = useRef(0)
	const abortController = useRef<AbortController | null>(null)

	const connect = useCallback(async () => {
		// Abort any existing connection
		abortController.current?.abort()
		abortController.current = new AbortController()

		try {
			const response = await fetch(`${url}/global/event`, {
				signal: abortController.current.signal,
				headers: {
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
				},
			})

			if (!response.ok) {
				throw new Error(`SSE failed: ${response.status} ${response.statusText}`)
			}

			if (!response.body) {
				throw new Error("No body in SSE response")
			}

			// Reset retry count on successful connection
			retryCount.current = 0
			onConnect?.()

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
			let buffer = ""

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += value
				const chunks = buffer.split("\n\n")
				buffer = chunks.pop() ?? ""

				for (const chunk of chunks) {
					const lines = chunk.split("\n")
					const dataLines: string[] = []

					for (const line of lines) {
						if (line.startsWith("data:")) {
							dataLines.push(line.replace(/^data:\s*/, ""))
						}
					}

					if (dataLines.length) {
						try {
							const data = JSON.parse(dataLines.join("\n")) as GlobalEvent
							onEvent(data)
						} catch (e) {
							console.error("Failed to parse SSE event:", e)
						}
					}
				}
			}
		} catch (error) {
			if ((error as Error).name === "AbortError") return

			onError?.(error as Error)

			// Retry with exponential backoff
			if (retryCount.current < maxRetries) {
				const backoff = Math.min(retryDelay * 2 ** retryCount.current, 30000)
				retryCount.current++
				setTimeout(connect, backoff)
			}
		}
	}, [url, onEvent, onError, onConnect, retryDelay, maxRetries])

	useEffect(() => {
		connect()
		return () => {
			abortController.current?.abort()
		}
	}, [connect])

	return {
		reconnect: connect,
	}
}
