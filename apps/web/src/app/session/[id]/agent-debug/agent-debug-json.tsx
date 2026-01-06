"use client"

import { useMemo } from "react"
import { useWorld, useSSEState, useWorldDebug } from "@opencode-vibe/react"
import { useMessagesWithParts } from "@/app/hooks"

interface AgentDebugJsonProps {
	sessionId: string
	directory: string
}

/**
 * Agent Debug JSON Component
 *
 * Client component that uses React hooks to gather debug info,
 * then renders it as formatted JSON in a <pre> tag.
 *
 * ARCHITECTURE:
 * - Uses client hooks: useWorld(), useSSEState(), useMessagesWithParts()
 * - Computes debug info in useMemo for performance
 * - Renders JSON for machine consumption (AI agents)
 */
export function AgentDebugJson({ sessionId, directory }: AgentDebugJsonProps) {
	// Get reactive state from hooks
	const world = useWorld()
	const { connected, connectedCount } = useSSEState()
	const messagesWithParts = useMessagesWithParts(sessionId)
	const debugStats = useWorldDebug()

	// Compute debug info
	const debugInfo = useMemo(() => {
		// Find the session
		const session = world.sessions.find((s) => s.id === sessionId)

		// Find the instance that owns this session
		const instance = world.sessionToInstance.get(sessionId)

		// Get last message info (messages are wrapped in {info, parts} envelope)
		const lastMessage =
			messagesWithParts.length > 0 ? messagesWithParts[messagesWithParts.length - 1] : null

		// Get per-session message count from debug stats
		const sessionMessageCount = debugStats?.messagesBySession.get(sessionId) ?? 0

		return {
			// Session info
			sessionId,
			directory: session?.directory || directory,
			sessionFound: !!session,

			// SSE/Streaming status
			streaming: {
				connected,
				connectedCount,
				status: world.connectionStatus,
				lastEvent: world.lastUpdated > 0 ? new Date(world.lastUpdated).toISOString() : undefined,
			},

			// World Stream state - ENHANCED with global message count
			world: {
				sessionCount: world.sessions.length,
				activeSessionId: world.activeSession?.id,
				totalMessages: debugStats?.totalMessages ?? 0, // NEW: Global message count
				totalParts: debugStats?.totalParts ?? 0, // NEW: Global parts count
				instances: world.instances.map((i) => ({
					port: i.port,
					directory: i.directory,
					status: i.status,
					baseUrl: i.baseUrl,
				})),
			},

			// Messages for this session - ENHANCED with atom-based count
			messages: {
				count: sessionMessageCount, // NEW: Count from messagesAtom (ground truth)
				countFromHook: messagesWithParts.length, // OLD: Count from React hook (for comparison)
				lastMessageId: lastMessage?.info.id,
				lastMessageRole: lastMessage?.info.role,
			},

			// Instance ownership
			instance: instance
				? {
						port: instance.port,
						directory: instance.directory,
						baseUrl: instance.baseUrl,
						status: instance.status,
					}
				: undefined,

			// Errors (empty for now - can add validation)
			errors: [],
		}
	}, [sessionId, directory, world, connected, connectedCount, messagesWithParts, debugStats])

	return (
		<pre
			style={{
				fontFamily: "monospace",
				fontSize: "12px",
				lineHeight: "1.5",
				margin: 0,
				padding: "1rem",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
			}}
		>
			{JSON.stringify(debugInfo, null, 2)}
		</pre>
	)
}
