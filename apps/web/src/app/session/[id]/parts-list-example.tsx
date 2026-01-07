/**
 * PartsListExample - Example component showing PartRenderer with useSessionParts
 *
 * Demonstrates ADR-019 Phase 3 pattern:
 * - useSessionParts provides flattened Part[] array from session
 * - PartRenderer is a pure component taking single Part prop
 * - Component subscribes only to its session's parts (granular updates)
 *
 * This pattern eliminates unnecessary re-renders when other sessions update.
 *
 * @example
 * ```tsx
 * <PartsListExample sessionId="session-123" />
 * ```
 */

"use client"

import { useSessionParts } from "@opencode-vibe/react"
import { PartRenderer } from "@/components/ai-elements/part-renderer"

export interface PartsListExampleProps {
	sessionId: string
}

/**
 * Renders all parts for a given session using useSessionParts + PartRenderer.
 *
 * KEY PATTERN (ADR-019 Phase 3):
 * - useSessionParts(sessionId) returns Part[] (flattened from messages)
 * - PartRenderer is memoized with content-aware comparison
 * - Only re-renders when THIS session's parts change
 *
 * @param sessionId - Session ID to render parts for
 */
export function PartsListExample({ sessionId }: PartsListExampleProps) {
	// Subscribe to session-specific parts (granular subscription)
	const parts = useSessionParts(sessionId)

	return (
		<div className="space-y-2">
			{parts.length === 0 ? (
				<p className="text-muted-foreground text-sm">No parts yet</p>
			) : (
				parts.map((part) => <PartRenderer key={part.id} part={part} />)
			)}
		</div>
	)
}
