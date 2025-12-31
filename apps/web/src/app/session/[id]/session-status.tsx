/**
 * SessionStatus - Visual indicator showing when AI is generating a response
 *
 * Shows "Running" when session.status.running === true, "Idle" otherwise.
 * Shows error message when session.error event fires.
 * Uses useSessionStatus hook to subscribe to SSE session.status events.
 *
 * @example
 * ```tsx
 * <SessionStatus sessionId="abc-123" />
 * ```
 */

"use client"

import { useState, useEffect } from "react"
import { useSessionStatus, useSSE } from "@opencode-vibe/react"
import { Badge } from "@/components/ui/badge"
import type { GlobalEvent } from "@opencode-ai/sdk/client"

export interface SessionStatusProps {
	sessionId: string
	directory?: string
}

/**
 * SessionStatus component - displays running/idle/error indicator
 */
export function SessionStatus({ sessionId, directory }: SessionStatusProps) {
	const status = useSessionStatus(sessionId)
	const running = status === "running"
	const isLoading = false // No longer tracked - store is always in sync via SSE
	const [error, setError] = useState<string | null>(null)
	const { events } = useSSE({ url: "http://localhost:4056" })

	// Process SSE events for errors and status changes
	useEffect(() => {
		// Reset error when sessionId changes
		setError(null)
	}, [sessionId])

	// Process new events
	useEffect(() => {
		for (const event of events) {
			const payload = event.payload as { type?: string; properties?: Record<string, unknown> }
			const properties = payload?.properties

			// Ignore malformed events
			if (!properties) continue

			// Filter by sessionID
			if (properties.sessionID !== sessionId) continue

			if (payload.type === "session.error") {
				// Extract error message
				const errorMessage = (properties.error as { message?: string })?.message
				if (errorMessage) {
					setError(errorMessage)
				}
			} else if (payload.type === "session.status") {
				// Clear error when session starts running
				const status = properties.status as { running?: boolean } | undefined
				if (status && typeof status.running === "boolean" && status.running) {
					setError(null)
				}
			}
		}
	}, [events, sessionId])

	// Error state takes precedence
	if (error) {
		return <Badge variant="destructive">{error}</Badge>
	}

	if (isLoading) {
		return (
			<Badge variant="outline" className="animate-pulse">
				Loading...
			</Badge>
		)
	}

	return <Badge variant={running ? "default" : "secondary"}>{running ? "Running" : "Idle"}</Badge>
}
