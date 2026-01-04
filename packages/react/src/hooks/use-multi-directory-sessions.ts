/**
 * useMultiDirectorySessions - Get sessions from multiple directories
 *
 * Returns sessions from World Stream for multiple project directories.
 * Subscribes to real-time updates via World Stream (SSE → atoms).
 *
 * MIGRATION NOTE (opencode-next--xts0a-mk0420294om):
 * - Migrated from Zustand to World Stream
 * - Now uses useWorld() for reactive state
 * - No longer requires useSSEEvents() call
 * - Pattern matches useMultiDirectoryStatus
 *
 * @example
 * ```tsx
 * const sessions = useMultiDirectorySessions(["/project1", "/project2"])
 * // Returns: { "/project1": [Session...], "/project2": [Session...] }
 * ```
 */

"use client"

import { useMemo } from "react"
import { formatRelativeTime } from "@opencode-vibe/core/utils"
import { useWorld } from "./use-world"

/**
 * Session in display format (for UI)
 */
export interface SessionDisplay {
	id: string
	title: string
	directory: string
	formattedTime: string
	timestamp: number
}

/**
 * Hook to get sessions from multiple directories
 *
 * **Migrated to World Stream** (opencode-next--xts0a-mk0420294om):
 * - Uses useWorld() for reactive state (replaces Zustand subscription)
 * - World Stream provides sessions via EnrichedSession
 * - No longer requires useSSEEvents() - LayoutClient routes to World Stream
 *
 * Returns sessions mapped by directory path.
 *
 * @param directories - Array of directory paths to get sessions for
 * @returns Record of directory -> SessionDisplay[]
 */
export function useMultiDirectorySessions(directories: string[]): Record<string, SessionDisplay[]> {
	// Get world state
	const world = useWorld()

	// Filter sessions by requested directories and transform to display format
	const liveSessions = useMemo(() => {
		const directorySet = new Set(directories)
		const result: Record<string, SessionDisplay[]> = {}

		// Initialize empty arrays for all directories
		for (const directory of directorySet) {
			result[directory] = []
		}

		// Group sessions by directory
		for (const session of world.sessions) {
			if (!directorySet.has(session.directory)) continue

			// Use lastActivityAt (computed by World Stream) for most accurate time
			// Fall back to time.updated → time.created for sessions without activity tracking
			const timestamp = session.lastActivityAt || session.time.updated || session.time.created

			result[session.directory]!.push({
				id: session.id,
				title: session.title || "Untitled Session",
				directory: session.directory,
				formattedTime: formatRelativeTime(timestamp),
				timestamp,
			})
		}

		return result
	}, [world.sessions, directories])

	return liveSessions
}
