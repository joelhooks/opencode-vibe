"use client"

/**
 * ProjectsList - Live client component for displaying projects with sessions
 *
 * Shows a green indicator for active/running sessions.
 * Subscribes to World Stream for real-time updates (SSE → World Stream via LayoutClient).
 * Sessions auto-sort by last activity with smooth animations.
 *
 * MIGRATION NOTE (opencode-next--xts0a-mk0420294om):
 * - Removed useSSEEvents() call (no longer needed)
 * - useMultiDirectorySessions now uses World Stream directly
 * - useMultiDirectoryStatus already used World Stream
 */

import { useMemo, memo, useState, useEffect, useRef } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { useLiveTime, useConnectionStatus } from "@/app/hooks"
import {
	useMultiDirectorySessions,
	useMultiDirectoryStatus,
	type SessionDisplay,
} from "@opencode-vibe/react"
import { SSEDebugPanel } from "@/components/sse-debug-panel"

// Session status type (extracted from SSE event payload)
type SessionStatusValue = "running" | "pending" | "completed" | "error" | "idle"

interface Project {
	id: string
	worktree: string
}

interface ProjectWithSessions {
	project: Project
	sessions: SessionDisplay[]
	name: string
}

interface ProjectsListProps {
	initialProjects: ProjectWithSessions[]
}

/**
 * Format relative time (e.g., "2 hours ago", "yesterday")
 * Same logic as server-side formatting in page.tsx
 */
function formatRelativeTime(timestamp: number): string {
	const now = Date.now()
	const diff = now - timestamp
	const minutes = Math.floor(diff / 60000)
	const hours = Math.floor(diff / 3600000)
	const days = Math.floor(diff / 86400000)

	if (minutes < 1) return "just now"
	if (minutes < 60) return `${minutes}m ago`
	if (hours < 24) return `${hours}h ago`
	if (days === 1) return "yesterday"
	if (days < 7) return `${days}d ago`
	return new Date(timestamp).toLocaleDateString()
}

/**
 * Status indicator dot
 * Green = running, pulsing
 * Gray = idle/completed
 */
function StatusIndicator({ status }: { status?: SessionStatusValue }) {
	const isActive = status === "running" || status === "pending"

	if (isActive) {
		return (
			<span className="relative flex h-2 w-2">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
				<span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
			</span>
		)
	}

	// Gray dot for idle sessions
	return <span className="inline-flex rounded-full h-2 w-2 bg-muted-foreground/30" />
}

/**
 * Single session row with live status and live-updating relative time
 */
const SessionRow = memo(
	function SessionRow({
		session,
		directory,
		status,
		lastActivityTime,
	}: {
		session: SessionDisplay
		directory: string
		status?: SessionStatusValue
		/** Last activity timestamp - used for relative time display and memo comparison */
		lastActivityTime?: number
	}) {
		// Trigger re-render every 60 seconds for live time updates
		useLiveTime()

		// Use lastActivityTime if available (from SSE), otherwise fall back to session.timestamp
		const displayTimestamp = lastActivityTime ?? session.timestamp

		// Format time client-side for live updates
		const relativeTime = formatRelativeTime(displayTimestamp)

		return (
			<Link
				href={`/session/${session.id}?dir=${encodeURIComponent(directory)}`}
				className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-secondary hover:border-accent transition-colors"
			>
				{/* Status indicator */}
				<StatusIndicator status={status} />

				{/* Content */}
				<div className="flex-1 min-w-0">
					{/* Title */}
					<div className="font-medium text-foreground text-sm line-clamp-1">
						{session.title || "Untitled Session"}
					</div>

					{/* Time - updates live every 60 seconds */}
					<div className="text-xs text-muted-foreground mt-1">{relativeTime}</div>
				</div>
			</Link>
		)
	},
	(prev, next) => {
		// Re-render if session ID, directory, status, or lastActivityTime changes
		// Note: tick from useLiveTime triggers re-render via React's normal mechanism
		// since it's internal state, not a prop - memo doesn't block it
		return (
			prev.session.id === next.session.id &&
			prev.directory === next.directory &&
			prev.status === next.status &&
			prev.lastActivityTime === next.lastActivityTime
		)
	},
)

/**
 * Hook to get sorted sessions for a project
 * Sorts by: running sessions first, then by last activity timestamp
 */
function useSortedSessions(
	sessions: SessionDisplay[],
	directory: string,
	sessionStatuses: Record<string, SessionStatusValue>,
	lastActivity: Record<string, number>,
) {
	return useMemo(() => {
		return [...sessions].sort((a, b) => {
			const aStatus = sessionStatuses[a.id]
			const bStatus = sessionStatuses[b.id]
			const aRunning = aStatus === "running" || aStatus === "pending"
			const bRunning = bStatus === "running" || bStatus === "pending"

			// Running sessions always come first
			if (aRunning && !bRunning) return -1
			if (!aRunning && bRunning) return 1

			// Then sort by last activity (from SSE) or timestamp (from server)
			const aTime = lastActivity[a.id] ?? a.timestamp
			const bTime = lastActivity[b.id] ?? b.timestamp
			return bTime - aTime // Most recent first
		})
	}, [sessions, sessionStatuses, lastActivity])
}

/**
 * Animated list of sessions that reorders smoothly when activity changes
 */
function SortedSessionsList({
	sessions,
	directory,
	sessionStatuses,
	lastActivity,
}: {
	sessions: SessionDisplay[]
	directory: string
	sessionStatuses: Record<string, SessionStatusValue>
	lastActivity: Record<string, number>
}) {
	const sortedSessions = useSortedSessions(sessions, directory, sessionStatuses, lastActivity)

	return (
		<>
			{sortedSessions.map((session) => (
				<motion.li
					key={session.id}
					layoutId={`session-${session.id}`}
					initial={false}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 0.95 }}
					transition={{
						layout: { type: "spring", stiffness: 300, damping: 25 },
						opacity: { duration: 0.15 },
						scale: { duration: 0.15 },
					}}
				>
					<SessionRow
						session={session}
						directory={directory}
						status={sessionStatuses[session.id]}
						lastActivityTime={lastActivity[session.id]}
					/>
				</motion.li>
			))}
		</>
	)
}

/**
 * New session button (client component for navigation)
 */
function NewSessionButton({ directory }: { directory: string }) {
	return (
		<Link
			href={`/session/new?dir=${encodeURIComponent(directory)}`}
			className="text-xs text-muted-foreground hover:text-foreground transition-colors"
		>
			+ New
		</Link>
	)
}

/**
 * SSE Connection indicator with debug panel
 * Shows green when connected, red when discovering, opens debug panel on click
 *
 * Uses mounted state to avoid hydration mismatch between server and client.
 */
function SSEStatus() {
	const [debugPanelOpen, setDebugPanelOpen] = useState(false)
	const [mounted, setMounted] = useState(false)

	// Use the new useConnectionStatus hook from factory
	// This polls multiServerSSE for actual connection state
	const { connected, serverCount, discovering } = useConnectionStatus()

	useEffect(() => {
		setMounted(true)
	}, [])

	const getStatusColor = () => {
		if (connected) return "bg-green-500"
		if (discovering) return "bg-yellow-500"
		return "bg-red-500"
	}

	const getStatusText = () => {
		if (connected) return `connected (${serverCount})`
		if (discovering) return "discovering..."
		return "disconnected"
	}

	// Return consistent placeholder during SSR and initial hydration
	if (!mounted) {
		return (
			<button
				type="button"
				className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-full px-3 py-1 hover:bg-secondary transition-colors cursor-pointer"
			>
				<span className="w-2 h-2 rounded-full bg-gray-500" />
				SSE initializing...
			</button>
		)
	}

	// Real status after mount
	return (
		<>
			<button
				type="button"
				onClick={() => setDebugPanelOpen(true)}
				className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-full px-3 py-1 hover:bg-secondary transition-colors cursor-pointer"
			>
				<span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
				SSE {getStatusText()}
			</button>

			{debugPanelOpen && <SSEDebugPanel onClose={() => setDebugPanelOpen(false)} />}
		</>
	)
}

/**
 * ProjectsList - Renders projects with live session status
 *
 * 1. SSE events flow: LayoutClient → parseSSEEvent → routeEvent → World Stream atoms
 * 2. Hooks subscribe to World Stream via useWorld()
 * 3. Merges live sessions from World Stream with initial server data
 */
export function ProjectsList({ initialProjects }: ProjectsListProps) {
	// Debug: Track renders
	const renderCount = useRef(0)
	renderCount.current++
	console.log(`[ProjectsList] Render #${renderCount.current}`)

	// Get directories for multi-directory hooks
	const directories = useMemo(
		() => initialProjects.map((p) => p.project.worktree),
		[initialProjects],
	)

	// Prepare initial sessions for bootstrap (format for useMultiDirectoryStatus)
	const initialSessionsForBootstrap = useMemo(() => {
		const result: Record<string, Array<{ id: string; formattedTime: string }>> = {}
		for (const { project, sessions } of initialProjects) {
			result[project.worktree] = sessions.map((s) => ({
				id: s.id,
				formattedTime: s.formattedTime,
			}))
		}
		return result
	}, [initialProjects])

	// Multi-directory hooks - now use World Stream directly
	// No longer require useSSEEvents() - LayoutClient routes SSE to World Stream
	const liveSessions = useMultiDirectorySessions(directories)
	const { sessionStatuses, lastActivity } = useMultiDirectoryStatus(
		directories,
		initialSessionsForBootstrap,
	)

	// Debug: Log when session statuses change
	useEffect(() => {
		if (Object.keys(sessionStatuses).length > 0) {
			console.log("[ProjectsList] sessionStatuses updated:", sessionStatuses)
		}
	}, [sessionStatuses])

	if (initialProjects.length === 0) {
		return (
			<div className="text-muted-foreground text-center py-12">No projects with sessions yet</div>
		)
	}

	return (
		<div className="space-y-8">
			<SSEStatus />
			{initialProjects.map(({ project, sessions, name }) => {
				// Get live sessions from store (may include new sessions from SSE)
				const liveSessionsForDir = liveSessions[project.worktree]

				// Debug: Log when live sessions change
				if (liveSessionsForDir && liveSessionsForDir.length > 0) {
					console.log("[ProjectsList] Live sessions for", name, ":", liveSessionsForDir.length)
				}

				// Deduplicate by session ID - merge initial + live sessions
				// This ensures new sessions from SSE appear alongside server-rendered sessions
				const sessionMap = new Map<string, SessionDisplay>()

				// Add initial sessions first (from server render)
				for (const session of sessions) {
					sessionMap.set(session.id, session)
				}

				// Add/override with live sessions (from SSE/store)
				// New sessions will be added, existing sessions will be updated
				if (liveSessionsForDir) {
					for (const session of liveSessionsForDir) {
						sessionMap.set(session.id, session)
					}
				}

				const mergedSessions = Array.from(sessionMap.values())

				return (
					<div key={project.id} className="space-y-2">
						{/* Project Header */}
						<div className="flex items-center gap-3 mb-3">
							<h2 className="text-lg font-semibold text-foreground">{name}</h2>
							<span className="text-xs text-muted-foreground">
								{mergedSessions.length} session
								{mergedSessions.length !== 1 ? "s" : ""}
							</span>
							<div className="ml-auto">
								<NewSessionButton directory={project.worktree} />
							</div>
						</div>

						{/* Sessions List (show top 5) - animated reordering */}
						<ul className="space-y-1">
							<AnimatePresence mode="popLayout">
								<SortedSessionsList
									sessions={mergedSessions.slice(0, 5)}
									directory={project.worktree}
									sessionStatuses={sessionStatuses}
									lastActivity={lastActivity}
								/>
							</AnimatePresence>
						</ul>

						{/* Show more link if there are more sessions */}
						{mergedSessions.length > 5 && (
							<div className="text-sm text-muted-foreground pl-3">
								+{mergedSessions.length - 5} more sessions
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}
