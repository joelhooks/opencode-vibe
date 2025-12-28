"use client"

import { useEffect, useState, createContext, useContext } from "react"
import Link from "next/link"
import type { UIMessage } from "ai"
import { toast } from "sonner"
import { OpenCodeProvider, useSession, useMessages, useSendMessage, useOpenCode } from "@/react"
import { multiServerSSE } from "@/core/multi-server-sse"
import { useOpencodeStore } from "@/react/store"
import { useMultiServerSSE } from "@/react/use-multi-server-sse"
import { useSessionStatus } from "@/react/use-session-status"
import { useMessagesWithParts } from "@/react/use-messages-with-parts"
import { NewSessionButton } from "./new-session-button"
import { SessionMessages } from "./session-messages"
import { PromptInput } from "@/components/prompt"
import { OpenCodeLogo } from "@/components/opencode-logo"
import type { Session } from "@opencode-ai/sdk/client"
import type { Prompt } from "@/types/prompt"

/**
 * Debug panel visibility context
 */
const DebugPanelContext = createContext<{
	isOpen: boolean
	toggle: () => void
}>({ isOpen: false, toggle: () => {} })

function useDebugPanel() {
	return useContext(DebugPanelContext)
}

/**
 * Discrete toggle button for debug panel
 */
function DebugToggleButton() {
	const { isOpen, toggle } = useDebugPanel()

	return (
		<button
			type="button"
			onClick={toggle}
			className={`text-xs transition-colors flex items-center gap-1 ${
				isOpen
					? "text-green-500 hover:text-green-400"
					: "text-muted-foreground/40 hover:text-muted-foreground/60"
			}`}
			aria-label={isOpen ? "Hide debug panel" : "Show debug panel"}
		>
			<svg
				viewBox="0 0 24 24"
				className="w-3 h-3"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M12 20h9" />
				<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
			</svg>
			{isOpen ? "debug" : ""}
		</button>
	)
}

interface SessionLayoutProps {
	session: Session
	sessionId: string
	directory?: string
	initialMessages: UIMessage[]
}

/**
 * Session content component - uses hooks to access reactive data
 *
 * Must be inside OpenCodeProvider to access useSession and useMessages.
 */
/**
 * Debug panel to visualize SSE state and routing
 */
function DebugPanel({ sessionId }: { sessionId: string }) {
	const { isOpen } = useDebugPanel()
	const [servers, setServers] = useState<Array<{ port: number; pid: number; directory: string }>>(
		[],
	)
	const [lastSend, setLastSend] = useState<{
		url: string
		status: string
		time: number
	} | null>(null)
	const [copied, setCopied] = useState(false)
	const { directory } = useOpenCode()
	const store = useOpencodeStore()
	const messagesWithParts = useMessagesWithParts(sessionId)
	const storeMessages = useMessages(sessionId)

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

	// Get store state
	const dirState = store.directories[directory]
	const allDirs = Object.keys(store.directories)

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
		storeDirectories: allDirs,
		storeMessages: storeMessages.length,
		messagesWithParts: messagesWithParts.length,
		partsInStore: dirState?.parts ? Object.keys(dirState.parts).length : 0,
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
				<span className="text-yellow-400">Store Directories:</span> {allDirs.length}
				{allDirs.map((d) => (
					<div key={d} className="ml-2 text-gray-400">
						<span className={d === directory ? "text-green-400" : ""}>{d}</span>
						{d === directory && " ✓"}
					</div>
				))}
			</div>

			<div className="mb-2">
				<span className="text-yellow-400">Dir State Ready:</span> {dirState?.ready ? "✅" : "❌"}
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
				<span className="text-yellow-400">Parts in Store:</span>{" "}
				{dirState?.parts ? Object.keys(dirState.parts).length : 0} message(s)
			</div>
		</div>
	)
}

function SessionContent({
	sessionId,
	directory,
	initialMessages,
	initialSession,
}: {
	sessionId: string
	directory?: string
	initialMessages: UIMessage[]
	initialSession: Session
}) {
	// Debug panel state
	const [debugPanelOpen, setDebugPanelOpen] = useState(false)
	const toggleDebugPanel = () => setDebugPanelOpen((prev) => !prev)

	const store = useOpencodeStore()
	const { directory: contextDirectory } = useOpenCode()

	// Subscribe to SSE events from all OpenCode servers
	useMultiServerSSE()

	// Hydrate store with initial session data on mount
	useEffect(() => {
		// Add session to store if not already present
		const existing = store.getSession(contextDirectory, sessionId)
		if (!existing) {
			store.addSession(contextDirectory, initialSession)
		}
	}, [sessionId, initialSession, store, contextDirectory])

	// Get reactive session data from store (updated via SSE)
	const session = useSession(sessionId) ?? initialSession

	// Get session running status for header indicator
	const { running } = useSessionStatus(sessionId)

	// Get reactive messages from store
	const storeMessages = useMessages(sessionId)

	// Send message hook - use contextDirectory to ensure we route to the right server
	const { sendMessage, isLoading, error } = useSendMessage({
		sessionId,
		directory: contextDirectory,
	})

	// Handle prompt submission
	const handleSubmit = async (parts: Prompt) => {
		try {
			await sendMessage(parts)
		} catch (err) {
			// Error is already set in useSendMessage state and will trigger toast via useEffect
			console.error("Failed to send message:", err)
		}
	}

	// Show toast when error occurs
	useEffect(() => {
		if (error) {
			toast.error("Failed to send message", {
				description: error.message || "An unknown error occurred",
				duration: 5000,
			})
		}
	}, [error])

	return (
		<DebugPanelContext.Provider value={{ isOpen: debugPanelOpen, toggle: toggleDebugPanel }}>
			<div className="flex flex-col h-full">
				{/* Debug Panel */}
				<DebugPanel sessionId={sessionId} />

				{/* Header - fixed height, doesn't scroll */}
				<header className="shrink-0 z-10 backdrop-blur-sm bg-background/80 border-b border-border/50">
					<div className="max-w-4xl mx-auto px-4 py-3">
						<div className="flex items-center justify-between">
							<Link
								href="/"
								className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
							>
								<OpenCodeLogo width={100} height={18} className="text-foreground" />
								<span className="text-foreground/60 text-xs font-medium">|</span>
								<span className="text-foreground font-semibold text-sm tracking-wide">VIBE</span>
							</Link>
							<div className="flex items-center gap-4">
								{/* Show message count from useMessages hook */}
								<div className="text-xs text-muted-foreground">{storeMessages.length} messages</div>
								<NewSessionButton directory={directory} />
							</div>
						</div>
						{/* Session title from useSession hook */}
						<div className="flex items-center gap-2 mt-1">
							{/* Status indicator dot */}
							<span
								className={`w-2 h-2 rounded-full shrink-0 ${
									running
										? "bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"
										: "bg-muted-foreground/30"
								}`}
								title={running ? "Running" : "Idle"}
							/>
							<h1 className="text-lg font-semibold text-foreground line-clamp-1">
								{session.title || "Untitled Session"}
							</h1>
						</div>
						<p className="text-xs text-muted-foreground">
							{new Date(session.time.updated).toLocaleString()}
						</p>
					</div>
				</header>

				{/* Messages container - full width for scroll, content centered */}
				<main className="flex-1 min-h-0">
					<SessionMessages
						sessionId={sessionId}
						directory={directory}
						initialMessages={initialMessages}
						status={isLoading ? "submitted" : undefined}
					/>
				</main>

				{/* Prompt input - fixed at bottom */}
				<footer className="shrink-0 bg-background pb-safe">
					<div className="max-w-4xl mx-auto px-4 pb-4">
						<PromptInput
							sessionId={sessionId}
							onSubmit={handleSubmit}
							disabled={isLoading}
							placeholder="Type a message... Use @ for files, / for commands"
						/>
						{/* Footer link */}
						<div className="flex justify-center items-center gap-4 mt-3 pt-2 border-t border-border/30">
							<a
								href="https://github.com/joelhooks/opencode-vibe"
								target="_blank"
								rel="noopener noreferrer"
								className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-1.5"
							>
								<svg
									viewBox="0 0 24 24"
									className="w-3.5 h-3.5"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
								</svg>
								joelhooks/opencode-vibe
								<span aria-hidden="true">🏄‍♂️</span>
							</a>
							<DebugToggleButton />
						</div>
					</div>
				</footer>
			</div>
		</DebugPanelContext.Provider>
	)
}

/**
 * Client component wrapper for session page
 *
 * Wraps content with OpenCodeProvider to enable reactive hooks.
 * Server-provided initial data is used as fallback until SSE updates arrive.
 */
export function SessionLayout({
	session,
	sessionId,
	directory,
	initialMessages,
}: SessionLayoutProps) {
	// Default URL to localhost:4056 (OpenCode server)
	const url = process.env.NEXT_PUBLIC_OPENCODE_URL || "http://localhost:4056"

	return (
		<OpenCodeProvider url={url} directory={directory || session.directory}>
			<SessionContent
				sessionId={sessionId}
				directory={directory}
				initialMessages={initialMessages}
				initialSession={session}
			/>
		</OpenCodeProvider>
	)
}
