"use client"

/**
 * SSE Debug Panel
 *
 * Shows connection status, discovered servers, and recent SSE events.
 * Opens when clicking the SSE health indicator.
 */

import { useState, useEffect } from "react"
import { multiServerSSE } from "@opencode-vibe/core/sse"
import { useSSEState } from "@opencode-vibe/react"
import { X, RefreshCw, Server, Circle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface SSEEvent {
	timestamp: number
	directory: string
	type: string
	port?: number
}

interface ServerInfo {
	port: number
	directory: string
	state: "connected" | "connecting" | "disconnected"
	lastEventTime?: number
}

export function SSEDebugPanel({ onClose }: { onClose: () => void }) {
	// Use reactive hook instead of polling - eliminates 1s setInterval
	const sseState = useSSEState()
	const [recentEvents, setRecentEvents] = useState<SSEEvent[]>([])

	// Derive ServerInfo from SSEState (join servers + connections)
	const servers: ServerInfo[] = sseState.servers.map((server) => {
		const connection = sseState.connections.find(([port]) => port === server.port)
		return {
			port: server.port,
			directory: server.directory,
			state: connection?.[1].state ?? "disconnected",
			lastEventTime: connection?.[1].lastEventTime,
		}
	})
	const discovering = sseState.discovering

	// Subscribe to SSE events
	useEffect(() => {
		const unsubscribe = multiServerSSE.onEvent((event) => {
			const newEvent: SSEEvent = {
				timestamp: Date.now(),
				directory: event.directory,
				type: event.payload.type,
			}

			setRecentEvents((prev) => [newEvent, ...prev].slice(0, 10))
		})

		return unsubscribe
	}, [])

	const handleReconnect = () => {
		multiServerSSE.stop()
		multiServerSSE.start()
	}

	const getStateColor = (state: ServerInfo["state"]) => {
		switch (state) {
			case "connected":
				return "bg-green-500"
			case "connecting":
				return "bg-yellow-500"
			case "disconnected":
				return "bg-red-500"
		}
	}

	const getStateBadgeVariant = (state: ServerInfo["state"]) => {
		switch (state) {
			case "connected":
				return "default" as const
			case "connecting":
				return "secondary" as const
			case "disconnected":
				return "destructive" as const
		}
	}

	return (
		<div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
			<Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-border">
					<div className="flex items-center gap-2">
						<Server className="w-5 h-5" />
						<h2 className="text-lg font-semibold">SSE Debug Panel</h2>
						{discovering && (
							<Badge variant="secondary" className="text-xs">
								Discovering...
							</Badge>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button size="sm" variant="outline" onClick={handleReconnect}>
							<RefreshCw className="w-4 h-4 mr-1" />
							Reconnect
						</Button>
						<Button size="sm" variant="ghost" onClick={onClose}>
							<X className="w-4 h-4" />
						</Button>
					</div>
				</div>

				{/* Content */}
				<ScrollArea className="flex-1 p-4">
					<div className="space-y-6">
						{/* Servers Section */}
						<div>
							<h3 className="text-sm font-medium mb-3">Discovered Servers</h3>
							{servers.length === 0 ? (
								<p className="text-sm text-muted-foreground">No servers discovered yet</p>
							) : (
								<div className="space-y-2">
									{servers.map((server) => (
										<div
											key={server.port}
											className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
										>
											<Circle className={`w-3 h-3 rounded-full ${getStateColor(server.state)}`} />
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-mono text-sm">Port {server.port}</span>
													<Badge variant={getStateBadgeVariant(server.state)} className="text-xs">
														{server.state}
													</Badge>
												</div>
												<p
													className="text-xs text-muted-foreground truncate"
													title={server.directory}
												>
													{server.directory}
												</p>
												{server.lastEventTime && (
													<p className="text-xs text-muted-foreground">
														Last event: {Math.round((Date.now() - server.lastEventTime) / 1000)}s
														ago
													</p>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>

						{/* Recent Events Section */}
						<div>
							<h3 className="text-sm font-medium mb-3">Recent Events (Last 10)</h3>
							{recentEvents.length === 0 ? (
								<p className="text-sm text-muted-foreground">No events received yet</p>
							) : (
								<div className="space-y-1">
									{recentEvents.map((event, idx) => (
										<div
											key={idx}
											className="flex items-center gap-3 p-2 rounded bg-muted/50 text-xs font-mono"
										>
											<span className="text-muted-foreground">
												{new Date(event.timestamp).toLocaleTimeString()}
											</span>
											<span className="font-medium">{event.type}</span>
											<span className="text-muted-foreground truncate flex-1">
												{event.directory}
											</span>
										</div>
									))}
								</div>
							)}
						</div>

						{/* Connection Info */}
						<div>
							<h3 className="text-sm font-medium mb-3">Connection Info</h3>
							<div className="space-y-1 text-xs text-muted-foreground">
								<p>Discovery: {discovering ? "In progress..." : "Complete"}</p>
								<p>
									Connected servers: {servers.filter((s) => s.state === "connected").length} /{" "}
									{servers.length}
								</p>
							</div>
						</div>
					</div>
				</ScrollArea>
			</Card>
		</div>
	)
}
