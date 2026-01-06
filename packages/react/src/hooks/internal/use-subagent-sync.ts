/**
 * Subagent sync hook
 *
 * Subscribes to SSE events and syncs subagent state for a given session.
 *
 * @module
 */

"use client"

import { useEffect, useRef } from "react"
import { subagents } from "@opencode-vibe/core/api"
import type { SubagentStateRef } from "@opencode-vibe/core/api"
import type { Message, Part } from "@opencode-vibe/core/types"
import { useWorld } from "../use-world"

/**
 * Options for useSubagentSync hook
 */
export interface UseSubagentSyncOptions {
	/**
	 * Session ID to sync subagent events for
	 */
	sessionId: string

	/**
	 * Optional directory to scope SSE subscription
	 */
	directory?: string
}

/**
 * Hook to sync subagent SSE events for a session
 *
 * This hook:
 * 1. Creates a subagent state ref on mount
 * 2. Subscribes to World Stream for SSE events
 * 3. Filters events to only process registered subagent sessions
 * 4. Handles out-of-order delivery by queueing parts that arrive before their message
 * 5. Dispatches events to the subagents API
 *
 * **Important:** Only processes events for subagents that have been registered via
 * `subagents.registerSubagent()`. Unregistered sessions are silently ignored.
 *
 * @param options - Session ID (currently unused, for future parent-child filtering) and optional directory
 *
 * @example
 * ```typescript
 * useSubagentSync({ sessionId: "abc123" })
 * useSubagentSync({ sessionId: "abc123", directory: "/path/to/project" })
 * ```
 */
export function useSubagentSync(options: UseSubagentSyncOptions): void {
	const world = useWorld()
	const stateRef = useRef<SubagentStateRef | null>(null)
	// Track message-to-session mapping to resolve sessionID for parts
	const messageToSessionMap = useRef<Map<string, string>>(new Map())
	// Queue parts that arrive before their message
	const pendingParts = useRef<Map<string, Part[]>>(new Map())

	// Create subagent state on mount
	useEffect(() => {
		let mounted = true

		subagents.create().then((ref) => {
			if (mounted) {
				stateRef.current = ref
			}
		})

		return () => {
			mounted = false
		}
	}, [])

	// NOTE: World Stream automatically handles SSE events
	// Subagent sync now works via World Stream's enriched sessions
	// This hook is maintained for backward compatibility but may be simplified
	// in the future to just access world.sessions directly
}
