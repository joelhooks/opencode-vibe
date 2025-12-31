/**
 * useMultiServerSSE - Connect to multiple OpenCode servers via SSE
 *
 * Wires up to the core MultiServerSSE singleton to manage SSE connections
 * to all discovered OpenCode servers.
 *
 * This is a side-effect hook - it manages connections but returns nothing.
 *
 * @example
 * ```tsx
 * function App() {
 *   const [events, setEvents] = useState<GlobalEvent[]>([])
 *
 *   useMultiServerSSE({
 *     onEvent: (event) => {
 *       console.log('Event from:', event.directory, event.payload.type)
 *       setEvents(prev => [...prev, event])
 *     }
 *   })
 *
 *   return <div>Connected to servers, received {events.length} events</div>
 * }
 * ```
 */

"use client"

import { useEffect } from "react"
import { multiServerSSE } from "@opencode-vibe/core/sse"
import type { GlobalEvent } from "../../types/events"

export interface UseMultiServerSSEOptions {
	/** Callback invoked when any server emits an event */
	onEvent?: (event: GlobalEvent) => void
}

/**
 * Hook to connect to all discovered OpenCode servers via SSE
 *
 * Features:
 * - Starts MultiServerSSE singleton for automatic server discovery
 * - Subscribes to all events from all servers
 * - Forwards events to onEvent callback if provided
 * - Automatically cleans up subscription on unmount
 *
 * @param options - Options with optional onEvent callback
 */
export function useMultiServerSSE(options?: UseMultiServerSSEOptions): void {
	// Extract callback to avoid object reference issues
	const onEvent = options?.onEvent

	// Start MultiServerSSE singleton - idempotent, safe to call multiple times
	useEffect(() => {
		multiServerSSE.start()
	}, [])

	// Subscribe to events if callback provided
	// Use the extracted callback reference for stable dependency
	useEffect(() => {
		if (!onEvent) return

		const unsubscribe = multiServerSSE.onEvent(onEvent)
		return unsubscribe
	}, [onEvent])
}
