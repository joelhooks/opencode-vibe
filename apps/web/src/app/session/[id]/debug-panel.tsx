"use client"

import { useState, useMemo, useCallback } from "react"
import { useMessages, useMessagesWithParts, getOpencodeConfig, useSendMessage } from "@/app/hooks"
import { useSSEState, useWorld } from "@opencode-vibe/react"
import { sessions } from "@opencode-vibe/core/api"

interface DebugPanelProps {
	sessionId: string
	isOpen: boolean
}

interface SendTestResult {
	success: boolean
	method: string
	error?: string
	timestamp: number
}

/**
 * Debug panel to visualize SSE state and routing
 */
export function DebugPanel({ sessionId, isOpen }: DebugPanelProps) {
	// All useState hooks first
	const [lastSend, setLastSend] = useState<{
		url: string
		status: string
		time: number
	} | null>(null)
	const [copied, setCopied] = useState(false)
	const [sendTestResults, setSendTestResults] = useState<SendTestResult[]>([])
	const [isSending, setIsSending] = useState(false)

	// Config and store hooks
	const { directory } = getOpencodeConfig()
	const messagesWithParts = useMessagesWithParts(sessionId)
	const storeMessages = useMessages(sessionId)

	// World Stream hooks - replaces multiServerSSE
	const world = useWorld()
	const { connected, connectedCount } = useSSEState()

	// useSendMessage hook - MUST be called unconditionally
	const { sendMessage, isPending: hookIsPending, error: hookError } = useSendMessage({ sessionId })

	// useMemo hooks
	const totalParts = useMemo(() => {
		return messagesWithParts.reduce((sum: number, msg: any) => sum + msg.parts.length, 0)
	}, [messagesWithParts])

	// Get routing URLs from World Stream
	// Session-based: lookup instance that owns this session
	const sessionInstance = world.sessionToInstance.get(sessionId)
	const sessionUrl = sessionInstance?.baseUrl

	// Directory-based: lookup first instance for directory
	const directoryInstances = world.instancesByDirectory.get(directory)
	const multiServerUrl = directoryInstances?.[0]?.baseUrl

	// All useCallback hooks - must be before any conditional returns
	const testSendViaHook = useCallback(async () => {
		console.log("[DebugPanel] Testing send via useSendMessage hook...")
		setIsSending(true)
		const startTime = Date.now()

		try {
			await sendMessage([
				{ type: "text", content: "[DEBUG TEST] Hello from debug panel", start: 0, end: 36 },
			])
			setSendTestResults((prev) => [
				...prev,
				{
					success: true,
					method: "useSendMessage hook",
					timestamp: Date.now() - startTime,
				},
			])
		} catch (err) {
			console.error("[DebugPanel] Hook send failed:", err)
			setSendTestResults((prev) => [
				...prev,
				{
					success: false,
					method: "useSendMessage hook",
					error: err instanceof Error ? err.message : String(err),
					timestamp: Date.now() - startTime,
				},
			])
		} finally {
			setIsSending(false)
		}
	}, [sendMessage])

	const testSendViaSessions = useCallback(async () => {
		console.log("[DebugPanel] Testing send via sessions.promptAsync...")
		setIsSending(true)
		const startTime = Date.now()

		try {
			await sessions.promptAsync(
				sessionId,
				[{ type: "text", text: "[DEBUG TEST] Direct API call" }],
				undefined,
				directory,
			)
			setSendTestResults((prev) => [
				...prev,
				{
					success: true,
					method: "sessions.promptAsync",
					timestamp: Date.now() - startTime,
				},
			])
		} catch (err) {
			console.error("[DebugPanel] Direct send failed:", err)
			setSendTestResults((prev) => [
				...prev,
				{
					success: false,
					method: "sessions.promptAsync",
					error: err instanceof Error ? err.message : String(err),
					timestamp: Date.now() - startTime,
				},
			])
		} finally {
			setIsSending(false)
		}
	}, [sessionId, directory])

	const testSendViaFetch = useCallback(async () => {
		console.log("[DebugPanel] Testing send via raw fetch...")
		setIsSending(true)
		const startTime = Date.now()

		// Get fresh URL from World Stream
		const dirInstances = world.instancesByDirectory.get(directory)
		const targetUrl = dirInstances?.[0]?.baseUrl
		if (!targetUrl) {
			console.error("[DebugPanel] No server URL available for directory:", directory)
			setSendTestResults((prev) => [
				...prev,
				{
					success: false,
					method: "raw fetch",
					error: "No server discovered for directory",
					timestamp: Date.now() - startTime,
				},
			])
			setIsSending(false)
			return
		}
		console.log("[DebugPanel] Target URL:", targetUrl)

		try {
			const res = await fetch(`${targetUrl}/session/${sessionId}/prompt`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-opencode-directory": directory,
				},
				body: JSON.stringify({
					parts: [{ type: "text", text: "[DEBUG TEST] Raw fetch" }],
				}),
			})

			console.log("[DebugPanel] Fetch response:", res.status, res.statusText)

			if (res.ok || res.status === 204) {
				setSendTestResults((prev) => [
					...prev,
					{
						success: true,
						method: `raw fetch (${res.status})`,
						timestamp: Date.now() - startTime,
					},
				])
			} else {
				const text = await res.text()
				setSendTestResults((prev) => [
					...prev,
					{
						success: false,
						method: "raw fetch",
						error: `${res.status}: ${text}`,
						timestamp: Date.now() - startTime,
					},
				])
			}
		} catch (err) {
			console.error("[DebugPanel] Fetch send failed:", err)
			setSendTestResults((prev) => [
				...prev,
				{
					success: false,
					method: "raw fetch",
					error: err instanceof Error ? err.message : String(err),
					timestamp: Date.now() - startTime,
				},
			])
		} finally {
			setIsSending(false)
		}
	}, [sessionId, directory, world])

	const copyDebugInfo = useCallback(async () => {
		const dirInstances = world.instancesByDirectory.get(directory)
		const debugInfo = {
			directory,
			sessionId,
			routing: {
				multiServerSSE: dirInstances?.[0]?.baseUrl || "undefined",
				sessionBased: sessionUrl || "undefined",
			},
			sseConnected: connected,
			sseConnectionCount: connectedCount,
			storeMessages: storeMessages.length,
			messagesWithParts: messagesWithParts.length,
			partsInStore: totalParts,
		}
		await navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2))
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [
		directory,
		sessionId,
		sessionUrl,
		connected,
		connectedCount,
		storeMessages.length,
		messagesWithParts.length,
		totalParts,
		world.instancesByDirectory,
	])

	const testRoute = useCallback(async () => {
		// Use discovery-based routing from World Stream
		const dirInstances = world.instancesByDirectory.get(directory)
		const targetUrl = dirInstances?.[0]?.baseUrl

		if (!targetUrl) {
			setLastSend({
				url: "N/A",
				status: "ERROR: No server discovered for directory",
				time: Date.now(),
			})
			return
		}

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
	}, [directory, sessionId, world.instancesByDirectory])

	// Get servers from World Stream instead of deleted /api/opencode/servers
	// The /api/opencode/servers route was removed when browser discovery was consolidated into World Stream
	// See: packages/core/src/world/discovery/ for the new discovery architecture
	const allInstances = Array.from(world.instances.values())

	// Early return AFTER all hooks
	if (!isOpen) return null

	return (
		<div className="fixed bottom-20 right-4 z-50 bg-black/90 text-green-400 font-mono text-xs p-3 rounded-lg max-w-md max-h-[500px] overflow-auto border border-green-500/50">
			<div className="flex items-center justify-between mb-2">
				<div className="font-bold text-green-300">SSE Debug Panel</div>
				<button
					type="button"
					onClick={copyDebugInfo}
					className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-gray-300"
				>
					{copied ? "Copied!" : "Copy"}
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
						<span className="text-gray-400">Session-based:</span>
						<span className={`ml-2 ${sessionUrl ? "text-green-300" : "text-yellow-400"}`}>
							{sessionUrl || "not cached"}
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
							{sessionUrl || multiServerUrl || "NO SERVER (error)"}
						</span>
					</div>
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
						<span className="text-gray-400">Last:</span>{" "}
						<span className={lastSend.status.startsWith("OK") ? "text-green-400" : "text-red-400"}>
							{lastSend.status}
						</span>
					</div>
				)}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Servers:</span> {allInstances.length}
				{allInstances.length === 0 && (
					<div className="ml-2 text-yellow-400">
						No servers discovered (World Stream not connected)
					</div>
				)}
				{allInstances.map((instance) => (
					<div key={instance.baseUrl} className="ml-2 text-gray-400">
						<span className={instance.directory === directory ? "text-green-400" : ""}>
							{instance.baseUrl} → {instance.directory.split("/").pop()}
						</span>
						{instance.directory === directory && " ✓"}
					</div>
				))}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Messages:</span> {storeMessages.length} ({totalParts}{" "}
				parts)
			</div>

			{/* Send Test Section */}
			<div className="mb-2 p-2 bg-purple-900/50 rounded border border-purple-500/50">
				<span className="text-purple-300 font-bold">SEND TESTS:</span>
				<div className="mt-2 space-y-1">
					<button
						type="button"
						onClick={testSendViaHook}
						disabled={isSending}
						className="w-full px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-white text-[10px]"
					>
						{isSending ? "Sending..." : "useSendMessage hook"}
					</button>
					<button
						type="button"
						onClick={testSendViaSessions}
						disabled={isSending}
						className="w-full px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-white text-[10px]"
					>
						{isSending ? "Sending..." : "sessions.promptAsync"}
					</button>
					<button
						type="button"
						onClick={testSendViaFetch}
						disabled={isSending}
						className="w-full px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-white text-[10px]"
					>
						{isSending ? "Sending..." : "raw fetch"}
					</button>
				</div>

				<div className="mt-2 text-[10px]">
					<span className="text-gray-400">Hook pending:</span>{" "}
					<span className={hookIsPending ? "text-yellow-400" : "text-gray-300"}>
						{hookIsPending ? "yes" : "no"}
					</span>
					{hookError && <div className="text-red-400 mt-1">Error: {hookError.message}</div>}
				</div>

				{sendTestResults.length > 0 && (
					<div className="mt-2 space-y-1">
						{sendTestResults.slice(-3).map((result) => (
							<div key={`${result.method}-${result.timestamp}`} className="text-[10px]">
								<span className={result.success ? "text-green-400" : "text-red-400"}>
									{result.success ? "✓" : "✗"} {result.method}
								</span>
								<span className="text-gray-500 ml-1">({result.timestamp}ms)</span>
								{result.error && <div className="text-red-400 ml-2 break-all">{result.error}</div>}
							</div>
						))}
					</div>
				)}
			</div>

			{/* World Stream SSE State */}
			<div className="p-2 bg-green-900/50 rounded border border-green-500/50">
				<span className="text-green-300 font-bold">SSE STATE:</span>
				<div className="mt-1 space-y-1 text-[10px]">
					<div>
						<span className="text-gray-400">Connected:</span>{" "}
						<span className={connected ? "text-green-400" : "text-red-400"}>
							{connected ? "yes" : "no"}
						</span>
						<span className="text-gray-500 ml-2">({connectedCount} connections)</span>
					</div>
				</div>
			</div>
		</div>
	)
}
