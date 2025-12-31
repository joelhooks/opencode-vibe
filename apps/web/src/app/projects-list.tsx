"use client"

/**
 * ProjectsList - Live client component for displaying projects with sessions
 *
 * Shows a green indicator for active/running sessions.
 * Bootstraps session status for all projects on mount, then subscribes to SSE for real-time updates.
 * Sessions auto-sort by last activity with smooth animations.
 */

import { useEffect, useRef, useMemo, memo, useState, useCallback } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { useSSE, useLiveTime, useOpencode } from "@opencode-vibe/react"
import { createClient } from "@/lib/client"
import type { GlobalEvent } from "@opencode-ai/sdk/client"

// Session status type (extracted from SSE event payload)
type SessionStatusValue = "running" | "pending" | "completed" | "error"

interface SessionDisplay {
	id: string
	title: string
	directory: string
	formattedTime: string // Server-rendered initial value
	timestamp: number // For live client-side updates
}

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
	}: {
		session: SessionDisplay
		directory: string
		status?: SessionStatusValue
	}) {
		// Trigger re-render every 60 seconds for live time updates
		useLiveTime()

		// Format time client-side for live updates
		const relativeTime = formatRelativeTime(session.timestamp)

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
		// Only re-render if session ID, directory, or status changes
		return (
			prev.session.id === next.session.id &&
			prev.directory === next.directory &&
			prev.status === next.status
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
 * SSE Connection indicator for debugging
 */
function SSEStatus() {
	const { connected } = useSSE({ url: "http://localhost:4056" })
	return (
		<div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-full px-3 py-1">
			<span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
			SSE {connected ? "connected" : "disconnected"}
		</div>
	)
}

/**
 * Derive session status from the last message
 * A session is "busy" if the last message is an assistant message without a completed time
 */
function deriveSessionStatus(
	messages: Array<{
		info: { role: string; time?: { created: number; completed?: number } }
	}>,
): "running" | "completed" {
	const lastMessage = messages[messages.length - 1]
	if (!lastMessage) return "completed"

	// Session is busy if last message is assistant without completed time
	if (lastMessage.info.role === "assistant" && !lastMessage.info.time?.completed) {
		return "running"
	}

	return "completed"
}

/** How long to keep "running" indicator lit after streaming ends */
const IDLE_COOLDOWN_MS = 60_000 // 1 minute

/**
 * Hook to manage session statuses across all projects
 * Handles bootstrap and SSE updates with cooldown on idle
 */
function useSessionStatuses(projects: ProjectWithSessions[]) {
	// Map of sessionId -> status
	const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatusValue>>({})
	// Map of sessionId -> last activity timestamp
	const [lastActivity, setLastActivity] = useState<Record<string, number>>({})

	const bootstrappedRef = useRef(false)
	// Track cooldown timers per session
	const cooldownTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

	// Cleanup all timers on unmount
	useEffect(() => {
		return () => {
			for (const timer of cooldownTimersRef.current.values()) {
				clearTimeout(timer)
			}
		}
	}, [])

	// Bootstrap session statuses for recent sessions on mount
	useEffect(() => {
		// Only bootstrap once
		if (bootstrappedRef.current) return
		bootstrappedRef.current = true

		async function bootstrap() {
			// Fetch status for each project in parallel
			await Promise.all(
				projects.map(async ({ project, sessions }) => {
					try {
						const client = createClient(project.worktree)

						// Only check recent sessions (updated in last 5 minutes) - likely active
						const recentSessions = sessions.filter((s) => {
							return s.formattedTime.includes("just now") || s.formattedTime.includes("m ago")
						})

						// Check each recent session's messages to derive status
						await Promise.all(
							recentSessions.slice(0, 10).map(async (session) => {
								try {
									const messagesResponse = await client.session.messages({
										path: { id: session.id },
										query: { limit: 1 }, // Only need last message
									})

									const messages = messagesResponse.data ?? []
									const status = deriveSessionStatus(messages)

									if (status === "running") {
										setSessionStatuses((prev) => ({
											...prev,
											[session.id]: "running",
										}))
									}
								} catch {
									// Ignore individual session errors
								}
							}),
						)
					} catch (error) {
						console.error(`Failed to fetch status for ${project.worktree}:`, error)
					}
				}),
			)
		}

		bootstrap()
	}, [projects])

	// Subscribe to SSE events for real-time updates
	const { events } = useSSE({ url: "http://localhost:4056" })

	useEffect(() => {
		// Get unique directories for filtering
		const directories = new Set(projects.map((p) => p.project.worktree))

		// Process only the latest events (avoid reprocessing all on every event)
		const latestEvents = events.slice(-10) // Last 10 events should be enough

		for (const event of latestEvents) {
			// Only process events for our directories
			if (!directories.has(event.directory)) continue

			// Handle session.status events
			if (event.payload.type === "session.status") {
				const sessionID = event.payload.properties.sessionID
				const statusType = event.payload.properties.status?.type

				if (statusType === "busy") {
					// Cancel any pending cooldown for this session
					const existingTimer = cooldownTimersRef.current.get(sessionID)
					if (existingTimer) {
						clearTimeout(existingTimer)
						cooldownTimersRef.current.delete(sessionID)
					}

					setSessionStatuses((prev) => ({
						...prev,
						[sessionID]: "running",
					}))
					setLastActivity((prev) => ({
						...prev,
						[sessionID]: Date.now(),
					}))
				} else if (statusType === "idle") {
					// Update last activity immediately
					setLastActivity((prev) => ({
						...prev,
						[sessionID]: Date.now(),
					}))

					// Clear any existing timer and start fresh cooldown
					const existingTimer = cooldownTimersRef.current.get(sessionID)
					if (existingTimer) {
						clearTimeout(existingTimer)
					}

					// Start cooldown timer - status changes to completed after delay
					const timer = setTimeout(() => {
						setSessionStatuses((prev) => ({
							...prev,
							[sessionID]: "completed",
						}))
						cooldownTimersRef.current.delete(sessionID)
					}, IDLE_COOLDOWN_MS)

					cooldownTimersRef.current.set(sessionID, timer)
				}
			}
		}
	}, [events, projects])

	return { sessionStatuses, lastActivity }
}

/**
 * ProjectsList - Renders projects with live session status
 *
 * 1. Bootstraps session statuses for all projects on mount
 * 2. Subscribes to SSE for real-time status updates
 */
export function ProjectsList({ initialProjects }: ProjectsListProps) {
	// Manage session statuses across all projects
	const { sessionStatuses, lastActivity } = useSessionStatuses(initialProjects)

	// SSE events are handled by OpencodeProvider via useMultiServerSSE

	if (initialProjects.length === 0) {
		return (
			<div className="text-muted-foreground text-center py-12">No projects with sessions yet</div>
		)
	}

	return (
		<div className="space-y-8">
			<SSEStatus />
			{initialProjects.map(({ project, sessions, name }) => (
				<div key={project.id} className="space-y-2">
					{/* Project Header */}
					<div className="flex items-center gap-3 mb-3">
						<h2 className="text-lg font-semibold text-foreground">{name}</h2>
						<span className="text-xs text-muted-foreground">
							{sessions.length} session
							{sessions.length !== 1 ? "s" : ""}
						</span>
						<div className="ml-auto">
							<NewSessionButton directory={project.worktree} />
						</div>
					</div>

					{/* Sessions List (show top 5) - animated reordering */}
					<ul className="space-y-1">
						<AnimatePresence mode="popLayout">
							<SortedSessionsList
								sessions={sessions.slice(0, 5)}
								directory={project.worktree}
								sessionStatuses={sessionStatuses}
								lastActivity={lastActivity}
							/>
						</AnimatePresence>
					</ul>

					{/* Show more link if there are more sessions */}
					{sessions.length > 5 && (
						<div className="text-sm text-muted-foreground pl-3">
							+{sessions.length - 5} more sessions
						</div>
					)}
				</div>
			))}
		</div>
	)
}
