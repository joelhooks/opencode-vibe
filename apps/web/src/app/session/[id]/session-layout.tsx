"use client"

import { useState, createContext, useContext } from "react"
import Link from "next/link"
import type { UIMessage } from "ai"
import { toast } from "sonner"
import { OpencodeSSRPlugin } from "@opencode-vibe/react"
import {
	useSession,
	useMessages,
	useSessionStatus,
	useSendMessage,
	useSSEEvents,
} from "@/app/hooks"
import { NewSessionButton } from "./new-session-button"
import { SessionMessages } from "./session-messages"
import { PromptInput } from "@/components/prompt"
import { OpenCodeLogo } from "@/components/opencode-logo"
import { DebugPanel } from "./debug-panel"
import { ContextUsageBar } from "./context-usage"
import { CompactionIndicator } from "./compaction-indicator"
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
	initialStoreMessages: Array<{
		id: string
		sessionID: string
		role: string
		time: { created: number }
		[key: string]: unknown
	}>
	initialStoreParts: Record<string, any[]>
}

/**
 * Session content component - uses hooks to access reactive data
 *
 * Must be inside OpencodeProvider to access useSession and useMessages.
 */
function SessionContent({
	sessionId,
	directory,
	initialMessages,
	initialStoreMessages,
	initialStoreParts,
	initialSession,
}: {
	sessionId: string
	directory?: string
	initialMessages: UIMessage[]
	initialStoreMessages: Array<{
		id: string
		sessionID: string
		role: string
		time: { created: number }
		[key: string]: unknown
	}>
	initialStoreParts: Record<string, any[]>
	initialSession: Session
}) {
	// Debug panel state
	const [debugPanelOpen, setDebugPanelOpen] = useState(false)
	const toggleDebugPanel = () => setDebugPanelOpen((prev) => !prev)

	// Start SSE and wire events to store - CRITICAL for real-time updates
	useSSEEvents()

	// Use individual factory hooks
	const sessionData = useSession(sessionId)
	const messages = useMessages(sessionId)
	const status = useSessionStatus(sessionId)
	const running = status === "running"

	const { sendMessage, isPending: isLoading } = useSendMessage({
		sessionId,
	})

	// Fallback to initialSession for SSR hydration
	const session = sessionData ?? initialSession

	// Queue length (TODO: need to add this to factory if needed)
	const queueLength = 0

	// Handle prompt submission
	const handleSubmit = async (parts: Prompt) => {
		try {
			await sendMessage(parts)
		} catch (err) {
			toast.error("Failed to send message", {
				description: err instanceof Error ? err.message : "An unknown error occurred",
				duration: 5000,
			})
			console.error("Failed to send message:", err)
		}
	}

	return (
		<DebugPanelContext.Provider value={{ isOpen: debugPanelOpen, toggle: toggleDebugPanel }}>
			<div className="flex flex-col h-full">
				{/* Debug Panel */}
				<DebugPanel sessionId={sessionId} isOpen={debugPanelOpen} />

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
								<div className="text-xs text-muted-foreground">{messages.length} messages</div>
								{/* Context usage bar with progress indicator */}
								<ContextUsageBar sessionId={sessionId} />
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
								{session?.title || "Untitled Session"}
							</h1>
						</div>
						<p className="text-xs text-muted-foreground">
							{session?.time?.updated ? new Date(session.time.updated).toLocaleString() : ""}
						</p>
					</div>
				</header>

				{/* Messages container - full width for scroll, content centered */}
				<main className="flex-1 min-h-0 flex flex-col">
					{/* Messages area */}
					<div className="flex-1 min-h-0">
						<SessionMessages
							sessionId={sessionId}
							directory={directory}
							initialMessages={initialMessages}
							initialStoreMessages={initialStoreMessages}
							initialStoreParts={initialStoreParts}
							status={isLoading ? "submitted" : undefined}
						/>
					</div>

					{/* Compaction indicator - shows at bottom like an hr when compacting */}
					<CompactionIndicator sessionId={sessionId} />
				</main>

				{/* Prompt input - fixed at bottom */}
				<footer className="shrink-0 bg-background pb-safe">
					<div className="max-w-4xl mx-auto px-4 pb-4">
						<PromptInput
							sessionId={sessionId}
							onSubmit={handleSubmit}
							disabled={isLoading}
							queueLength={queueLength}
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
 * Renders OpencodeSSRPlugin to inject config before React hydrates.
 * No longer needs OpencodeProvider - factory hooks work without it.
 * Server-provided initial data is used as fallback until SSE updates arrive.
 */
export function SessionLayout({
	session,
	sessionId,
	directory,
	initialMessages,
	initialStoreMessages,
	initialStoreParts,
}: SessionLayoutProps) {
	return (
		<>
			{/* Inject OpenCode config for factory hooks - must have directory from URL */}
			{directory && (
				<OpencodeSSRPlugin
					config={{
						baseUrl: "/api/opencode",
						directory,
					}}
				/>
			)}
			<SessionContent
				sessionId={sessionId}
				directory={directory}
				initialMessages={initialMessages}
				initialStoreMessages={initialStoreMessages}
				initialStoreParts={initialStoreParts}
				initialSession={session}
			/>
		</>
	)
}
