"use client"

/**
 * Server Status Display Component
 *
 * Client component that shows connection status to OpenCode server.
 * Browser-side discovery removed - server URL provided via SSR.
 */

import { OpencodeSSRPlugin } from "@opencode-vibe/react"
import { useConnectionStatus } from "@/app/hooks"

export function ServerStatus() {
	const { connected, discovering, serverCount } = useConnectionStatus()

	return (
		<>
			{/* Inject OpenCode config for factory hooks */}
			<OpencodeSSRPlugin
				config={{
					baseUrl: "/api/opencode",
					directory: "", // No specific directory for global operations
				}}
			/>
			{discovering ? (
				<div className="text-xs text-muted-foreground">Connecting to server...</div>
			) : !connected ? (
				<div className="text-xs text-destructive">Server disconnected</div>
			) : (
				<div className="text-xs text-muted-foreground">
					Connected to {serverCount} server{serverCount !== 1 ? "s" : ""}
				</div>
			)}
		</>
	)
}
