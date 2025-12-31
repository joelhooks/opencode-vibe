"use client"

import { useEffect, useState } from "react"
import {
	useOpencode,
	useMessages,
	useMessagesWithParts,
	useParts,
	type OpencodeMessage,
} from "@opencode-vibe/react"
import { multiServerSSE } from "@opencode-vibe/core/sse"

interface DebugPanelProps {
	sessionId: string
	isOpen: boolean
}

/**
 * Debug panel to visualize SSE state and routing
 */
export function DebugPanel({ sessionId, isOpen }: DebugPanelProps) {
	const [servers, setServers] = useState<Array<{ port: number; pid: number; directory: string }>>(
		[],
	)
	const [lastSend, setLastSend] = useState<{
		url: string
		status: string
		time: number
	} | null>(null)
	const [copied, setCopied] = useState(false)
	const { directory } = useOpencode()
	const messagesWithParts = useMessagesWithParts(sessionId)
	const storeMessages = useMessages(sessionId)
	const storeParts = useParts(sessionId)

	const [fetchError, setFetchError] = useState<string | null>(null)

	// Fetch discovered servers
	useEffect(() => {
		// Skip fetching if panel is closed
		if (!isOpen) return

		const fetchServers = async () => {
			try {
				const res = await fetch("/api/opencode-servers")
				if (!res.ok) {
					setFetchError(`HTTP ${res.status}`)
					setServers([])
					return
				}
				const data = await res.json()
				setFetchError(null)
				setServers(data)
			} catch (err) {
				setFetchError(err instanceof Error ? err.message : "Unknown error")
				setServers([])
			}
		}
		fetchServers()
		const interval = setInterval(fetchServers, 5000)
		return () => clearInterval(interval)
	}, [isOpen])

	// Don't render if not open
	if (!isOpen) return null

	// Check routing - which server would we send to?
	const matchingServer = servers.find((s) => s.directory === directory)
	const routeUrl = matchingServer
		? `http://127.0.0.1:${matchingServer.port}`
		: "http://localhost:4056 (fallback)"

	// Check what multiServerSSE thinks the URL should be
	const multiServerUrl = multiServerSSE.getBaseUrlForDirectory(directory)
	const sessionUrl = multiServerSSE.getBaseUrlForSession(sessionId, directory)

	// Build debug info for copying
	const debugInfo = {
		directory,
		sessionId,
		routing: {
			debugPanelSees: matchingServer ? `http://127.0.0.1:${matchingServer.port}` : "fallback",
			multiServerSSE: multiServerUrl || "undefined",
			sessionBased: sessionUrl || "undefined",
		},
		discoveredServers: servers.map((s) => ({
			port: s.port,
			directory: s.directory,
		})),
		storeMessages: storeMessages.length,
		messagesWithParts: messagesWithParts.length,
		partsInStore: storeParts.length,
	}

	const copyDebugInfo = async () => {
		await navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2))
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	// Test send function
	const testRoute = async () => {
		const targetUrl = matchingServer
			? `http://127.0.0.1:${matchingServer.port}`
			: "http://localhost:4056"

		try {
			const res = await fetch(`${targetUrl}/session/${sessionId}`, {
				headers: { "x-opencode-directory": directory },
			})
			setLastSend({
				url: targetUrl,
				status: res.ok ? `OK (${res.status})` : `FAIL (${res.status})`,
				time: Date.now(),
			})
		} catch (err) {
			setLastSend({
				url: targetUrl,
				status: `ERROR: ${err instanceof Error ? err.message : "unknown"}`,
				time: Date.now(),
			})
		}
	}

	return (
		<div className="fixed bottom-20 right-4 z-50 bg-black/90 text-green-400 font-mono text-xs p-3 rounded-lg max-w-md max-h-[500px] overflow-auto border border-green-500/50">
			<div className="flex items-center justify-between mb-2">
				<div className="font-bold text-green-300">🔧 SSE Debug Panel</div>
				<button
					type="button"
					onClick={copyDebugInfo}
					className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-gray-300"
				>
					{copied ? "✓ Copied!" : "Copy"}
				</button>
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Directory:</span>
				<div className="ml-2 text-gray-300 break-all">{directory}</div>
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Session:</span> {sessionId.slice(0, 12)}...
			</div>

			<div className="mb-2 p-2 bg-blue-900/50 rounded border border-blue-500/50">
				<span className="text-blue-300 font-bold">ROUTING:</span>
				<div className="ml-2 space-y-1">
					<div>
						<span className="text-gray-400">Session-based (best):</span>
						<span className={`ml-2 ${sessionUrl ? "text-green-300" : "text-yellow-400"}`}>
							{sessionUrl || "not yet known"}
						</span>
					</div>
					<div>
						<span className="text-gray-400">Directory-based:</span>
						<span className={`ml-2 ${multiServerUrl ? "text-green-300" : "text-red-400"}`}>
							{multiServerUrl || "no mapping"}
						</span>
					</div>
					<div>
						<span className="text-gray-400">Will use:</span>
						<span
							className={`ml-2 ${sessionUrl || multiServerUrl ? "text-green-300 font-bold" : "text-red-400"}`}
						>
							{sessionUrl || multiServerUrl || "http://localhost:4056 (fallback)"}
						</span>
					</div>
					{!sessionUrl && !multiServerUrl && (
						<div className="text-red-400 text-[10px] mt-1">
							⚠️ No server found! Messages will go to fallback.
						</div>
					)}
				</div>
				<button
					type="button"
					onClick={testRoute}
					className="mt-2 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-[10px]"
				>
					Test Route
				</button>
				{lastSend && (
					<div className="mt-1 text-[10px]">
						<span className="text-gray-400">Last test:</span>{" "}
						<span className={lastSend.status.startsWith("OK") ? "text-green-400" : "text-red-400"}>
							{lastSend.status}
						</span>
					</div>
				)}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Discovered Servers:</span> {servers.length}
				{fetchError && <div className="ml-2 text-red-400">Error: {fetchError}</div>}
				{servers.map((s) => (
					<div key={s.port} className="ml-2 text-gray-400">
						<span className={s.directory === directory ? "text-green-400" : ""}>
							:{s.port} → {s.directory}
						</span>
						{s.directory === directory && " ✓"}
					</div>
				))}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Store Messages:</span> {storeMessages.length}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Messages w/ Parts:</span> {messagesWithParts.length}
				{messagesWithParts.slice(-3).map((m) => (
					<div key={m.info.id} className="ml-2 text-gray-400">
						{m.info.id.slice(0, 8)}... ({m.parts.length} parts)
					</div>
				))}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Parts in Store:</span> {storeParts.length}
			</div>
		</div>
	)
}
