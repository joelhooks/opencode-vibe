"use client"

/**
 * SSE Debug Panel
 *
 * Shows connection status, discovered servers, and recent SSE events.
 * Opens when clicking the SSE health indicator.
 */

import { useSSEState } from "@opencode-vibe/react"
import { useWorld } from "@opencode-vibe/react"
import { X, RefreshCw, Server, Circle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ServerInfo {
	port: number
	directory: string
	status: "connected" | "connecting" | "disconnected" | "error"
}

export function SSEDebugPanel({ onClose }: { onClose: () => void }) {
	// Use reactive hook instead of polling - eliminates 1s setInterval
	const sseState = useSSEState()
	const world = useWorld()

	// Map instances to ServerInfo
	const servers: ServerInfo[] = sseState.instances as ServerInfo[]

	const discovering = sseState.discovering

	const handleReconnect = () => {
		// World Stream manages connection automatically - just close and reopen
		// The stream will reconnect on next useWorld() call
		window.location.reload()
	}

	const getStateColor = (status: ServerInfo["status"]) => {
		switch (status) {
			case "connected":
				return "bg-green-500"
			case "connecting":
				return "bg-yellow-500"
			case "disconnected":
			case "error":
				return "bg-red-500"
		}
	}

	const getStateBadgeVariant = (status: ServerInfo["status"]) => {
		switch (status) {
			case "connected":
				return "default" as const
			case "connecting":
				return "secondary" as const
			case "disconnected":
			case "error":
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
											<Circle className={`w-3 h-3 rounded-full ${getStateColor(server.status)}`} />
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-mono text-sm">Port {server.port}</span>
													<Badge variant={getStateBadgeVariant(server.status)} className="text-xs">
														{server.status}
													</Badge>
												</div>
												<p
													className="text-xs text-muted-foreground truncate"
													title={server.directory}
												>
													{server.directory}
												</p>
											</div>
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
									Connected servers: {servers.filter((s) => s.status === "connected").length} /{" "}
									{servers.length}
								</p>
								<p>Last updated: {new Date(world.lastUpdated).toLocaleTimeString()}</p>
							</div>
						</div>
					</div>
				</ScrollArea>
			</Card>
		</div>
	)
}
