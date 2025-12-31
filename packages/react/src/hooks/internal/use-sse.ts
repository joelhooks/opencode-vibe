/**
 * useSSE - Native EventSource SSE hook
 *
 * Manages SSE connection using native browser EventSource API.
 * Includes heartbeat monitoring and automatic error handling.
 *
 * @example
 * ```tsx
 * function EventMonitor({ url }: { url: string }) {
 *   const { events, connected, error } = useSSE({ url })
 *
 *   if (error) return <div>Error: {error.message}</div>
 *   if (!connected) return <div>Connecting...</div>
 *
 *   return (
 *     <div>
 *       <div>Connected! Received {events.length} events</div>
 *       <ul>
 *         {events.slice(-10).map((e, i) => (
 *           <li key={i}>{e.type} - {e.directory}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useState, useEffect, useRef } from "react"
import type { GlobalEvent } from "@opencode-ai/sdk/client"

export interface UseSSEOptions {
	/** Base URL for SSE endpoint */
	url: string
	/** Heartbeat timeout in milliseconds (default: 60000ms = 60s) */
	heartbeatTimeout?: number
}

export interface UseSSEReturn {
	/** Array of received events */
	events: GlobalEvent[]
	/** Connection state */
	connected: boolean
	/** Error if connection failed */
	error: Error | null
}

/**
 * Hook to connect to SSE stream using native EventSource
 *
 * Features:
 * - Automatic heartbeat monitoring (60s timeout)
 * - Error handling and connection state tracking
 * - Proper cleanup on unmount
 *
 * @param options - Options with url and optional heartbeatTimeout
 * @returns Object with events, connected state, and error
 */
/**
 * Maximum number of events to retain in memory.
 * Ring buffer caps at 100 events to prevent unbounded memory growth.
 * After 8-hour session with frequent events, this prevents 17+ MB leak.
 */
const MAX_EVENTS = 100

export function useSSE(options: UseSSEOptions): UseSSEReturn {
	const [events, setEvents] = useState<GlobalEvent[]>([])
	const [connected, setConnected] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const heartbeatTimeoutMs = options.heartbeatTimeout ?? 60000
	const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		const endpoint = `${options.url}/global/event`
		const eventSource = new EventSource(endpoint)

		// Reset heartbeat timer on each event
		const resetHeartbeat = () => {
			if (heartbeatTimerRef.current) {
				clearTimeout(heartbeatTimerRef.current)
			}
			heartbeatTimerRef.current = setTimeout(() => {
				setError(new Error("SSE heartbeat timeout"))
				setConnected(false)
				eventSource.close()
			}, heartbeatTimeoutMs)
		}

		// Connection opened
		eventSource.onopen = () => {
			setConnected(true)
			setError(null)
			resetHeartbeat()
		}

		// Message received
		eventSource.onmessage = (event: MessageEvent) => {
			resetHeartbeat()
			try {
				const data = JSON.parse(event.data) as GlobalEvent
				setEvents((prev) => {
					const next = [...prev, data]
					// Ring buffer: cap at MAX_EVENTS, drop oldest (FIFO)
					return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
				})
			} catch (parseError) {
				// Ignore malformed JSON - don't crash the connection
				console.warn("SSE: Failed to parse event data", parseError)
			}
		}

		// Connection error
		eventSource.onerror = () => {
			if (heartbeatTimerRef.current) {
				clearTimeout(heartbeatTimerRef.current)
			}
			setError(new Error("SSE connection error"))
			setConnected(false)
			eventSource.close()
		}

		// Cleanup on unmount
		return () => {
			if (heartbeatTimerRef.current) {
				clearTimeout(heartbeatTimerRef.current)
			}
			eventSource.close()
			setConnected(false)
		}
	}, [options.url, heartbeatTimeoutMs])

	return {
		events,
		connected,
		error,
	}
}
