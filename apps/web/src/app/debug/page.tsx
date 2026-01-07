"use client"

/**
 * Debug page for testing World Stream hooks
 *
 * Navigate to /debug to see the World Stream in action.
 * This page demonstrates the new useWorld* hooks from @opencode-vibe/react.
 *
 * IMPORTANT: The World Stream hooks use lsof-based discovery which only works
 * in CLI/server contexts. In the browser, they will show "connecting" status
 * because discovery returns empty (no lsof in browser).
 *
 * For browser use, the existing multiServerSSE singleton (used by useSSE hooks)
 * uses the /api/opencode/servers and /api/sse/[port] proxy routes.
 *
 * TODO: Add browser support to createWorldStream() via useProxy option.
 *
 * @example
 * 1. Start the dev server: bun dev
 * 2. Navigate to http://localhost:3000/debug
 * 3. Note: Connection will stay "connecting" in browser (expected)
 * 4. For full testing, use the CLI visualizer or add proxy support
 */

import {
	useWorld,
	useWorldConnection,
	useWorldMessages,
	useSessionAtom,
	type ConnectionStatus,
} from "@opencode-vibe/react"
import { useState } from "react"

/**
 * Connection status indicator
 */
function ConnectionIndicator() {
	const status = useWorldConnection()

	const statusColors: Record<ConnectionStatus, string> = {
		discovering: "bg-blue-500",
		connecting: "bg-yellow-500",
		connected: "bg-green-500",
		disconnected: "bg-gray-500",
		error: "bg-red-500",
	}

	return (
		<div className="flex items-center gap-2">
			<div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
			<span className="text-sm font-mono">{status}</span>
		</div>
	)
}

/**
 * World state overview
 */
function WorldOverview() {
	const world = useWorld()

	return (
		<div className="space-y-4">
			<h2 className="text-lg font-semibold">World State</h2>

			<div className="grid grid-cols-2 gap-4 text-sm">
				<div className="p-3 bg-muted rounded-lg">
					<div className="text-muted-foreground">Total Sessions</div>
					<div className="text-2xl font-mono">{world.stats.total}</div>
				</div>
				<div className="p-3 bg-muted rounded-lg">
					<div className="text-muted-foreground">Active Sessions</div>
					<div className="text-2xl font-mono">{world.stats.active}</div>
				</div>
				<div className="p-3 bg-muted rounded-lg">
					<div className="text-muted-foreground">Streaming</div>
					<div className="text-2xl font-mono">{world.stats.streaming}</div>
				</div>
				<div className="p-3 bg-muted rounded-lg">
					<div className="text-muted-foreground">Last Updated</div>
					<div className="text-sm font-mono">
						{world.lastUpdated ? new Date(world.lastUpdated).toLocaleTimeString() : "Never"}
					</div>
				</div>
			</div>

			<div className="text-xs text-muted-foreground">Directories: {world.byDirectory.size}</div>
		</div>
	)
}

/**
 * Session list from World state
 */
function SessionList({ onSelectSession }: { onSelectSession: (id: string) => void }) {
	const world = useWorld()

	if (world.sessions.length === 0) {
		return (
			<div className="text-muted-foreground text-sm">
				No sessions yet. Start a session in OpenCode CLI to see it here.
			</div>
		)
	}

	return (
		<div className="space-y-2">
			<h2 className="text-lg font-semibold">Sessions ({world.sessions.length})</h2>
			<div className="space-y-1 max-h-64 overflow-y-auto">
				{world.sessions.map((session) => (
					<button
						key={session.id}
						type="button"
						onClick={() => onSelectSession(session.id)}
						className="w-full text-left p-2 rounded hover:bg-muted transition-colors"
					>
						<div className="flex items-center justify-between">
							<span className="font-mono text-xs truncate max-w-[200px]">{session.id}</span>
							<span
								className={`text-xs px-2 py-0.5 rounded ${
									session.isActive ? "bg-green-500/20 text-green-500" : "bg-muted"
								}`}
							>
								{session.status}
							</span>
						</div>
						<div className="text-xs text-muted-foreground truncate">{session.directory}</div>
					</button>
				))}
			</div>
		</div>
	)
}

/**
 * Session detail view using useSessionAtom (ADR-019 Phase 3)
 *
 * Uses granular per-session subscription (SessionAtom) instead of global world state.
 * Only re-renders when THIS session changes, not when other sessions update.
 *
 * BEFORE: useWorldSession(sessionId) - subscribed to world.sessions array
 * AFTER: useSessionAtom(sessionId) - subscribes directly to SessionAtom for this ID
 */
function SessionDetail({ sessionId }: { sessionId: string }) {
	const session = useSessionAtom(sessionId)
	const messages = useWorldMessages(sessionId)

	if (!session || !session.id) {
		return <div className="text-muted-foreground text-sm">Session not found: {sessionId}</div>
	}

	return (
		<div className="space-y-4">
			<h2 className="text-lg font-semibold">Session Detail</h2>

			<div className="p-3 bg-muted rounded-lg space-y-2 text-sm">
				<div>
					<span className="text-muted-foreground">ID:</span>{" "}
					<span className="font-mono">{session.id}</span>
				</div>
				<div>
					<span className="text-muted-foreground">Status:</span>{" "}
					<span className={session.isActive ? "text-green-500" : ""}>{session.status}</span>
				</div>
				<div>
					<span className="text-muted-foreground">Directory:</span>{" "}
					<span className="font-mono text-xs">{session.directory}</span>
				</div>
				<div>
					<span className="text-muted-foreground">Context Usage:</span>{" "}
					{session.contextUsagePercent.toFixed(1)}%
				</div>
				<div>
					<span className="text-muted-foreground">Messages:</span> {messages.length}
				</div>
			</div>

			{messages.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-sm font-semibold">Recent Messages</h3>
					<div className="space-y-1 max-h-48 overflow-y-auto">
						{messages.slice(-5).map((msg) => (
							<div key={msg.id} className="p-2 bg-muted/50 rounded text-xs font-mono">
								<span className="text-muted-foreground">{msg.role}:</span> {msg.parts.length} parts
								{msg.isStreaming && <span className="ml-2 text-yellow-500">streaming...</span>}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

/**
 * Debug page main component
 */
export default function DebugPage() {
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

	return (
		<div className="min-h-screen p-8 bg-background text-foreground">
			<div className="max-w-4xl mx-auto space-y-8">
				<div className="flex items-center justify-between">
					<h1 className="text-2xl font-bold">World Stream Debug</h1>
					<ConnectionIndicator />
				</div>

				<div className="grid md:grid-cols-2 gap-8">
					<div className="space-y-8">
						<WorldOverview />
						<SessionList onSelectSession={setSelectedSessionId} />
					</div>

					<div>
						{selectedSessionId ? (
							<SessionDetail sessionId={selectedSessionId} />
						) : (
							<div className="text-muted-foreground text-sm">Select a session to view details</div>
						)}
					</div>
				</div>

				<div className="text-xs text-muted-foreground border-t pt-4 space-y-4">
					<div>
						<p className="font-semibold text-yellow-500">⚠️ Browser Limitation</p>
						<p className="mt-1">
							The World Stream hooks use <code className="bg-muted px-1 rounded">lsof</code>-based
							discovery which only works in CLI/server contexts. In the browser, connection will
							stay "connecting" because discovery returns empty.
						</p>
						<p className="mt-1">
							For browser use, the existing <code className="bg-muted px-1 rounded">useSSE</code>{" "}
							hooks use the <code className="bg-muted px-1 rounded">/api/sse/[port]</code> proxy
							routes.
						</p>
					</div>

					<div>
						<p className="font-semibold">World Stream Hooks (ADR-018):</p>
						<ul className="list-disc list-inside mt-2 space-y-1">
							<li>
								<code className="bg-muted px-1 rounded">useWorld()</code> - Full world state
							</li>
							<li>
								<code className="bg-muted px-1 rounded">useWorldConnection()</code> - Connection
								status
							</li>
							<li>
								<code className="bg-muted px-1 rounded">useWorldSession(id)</code> - Single session
							</li>
							<li>
								<code className="bg-muted px-1 rounded">useWorldMessages(id)</code> - Session
								messages
							</li>
						</ul>
					</div>

					<div>
						<p className="font-semibold">To test in CLI:</p>
						<pre className="bg-muted p-2 rounded mt-1 overflow-x-auto">
							{`cd apps/swarm-cli
bun run src/main.ts watch`}
						</pre>
					</div>
				</div>
			</div>
		</div>
	)
}
