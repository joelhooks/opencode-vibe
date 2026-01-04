import { useCallback, useState, useRef, useEffect } from "react"
import type { Prompt, SlashCommand } from "../types/prompt"
import { prompt } from "@opencode-vibe/core/api"
import { useCommands } from "./use-commands"
import { sessions } from "@opencode-vibe/core/api"
import { useSessionStatus } from "./internal/use-session-status"
import { multiServerSSE } from "@opencode-vibe/core/sse"

/**
 * Result of parsing a prompt for slash commands
 */
type ParsedCommand =
	| { isCommand: false }
	| {
			isCommand: true
			commandName: string
			arguments: string
			type: SlashCommand["type"]
	  }

export interface ModelSelection {
	providerID: string
	modelID: string
}

export interface UseSendMessageOptions {
	sessionId: string
	directory?: string
}

interface QueuedMessage {
	parts: Prompt
	model?: ModelSelection
	resolve: () => void
	reject: (error: Error) => void
}

export interface UseSendMessageReturn {
	sendMessage: (parts: Prompt, model?: ModelSelection) => Promise<void>
	isLoading: boolean
	error?: Error
	/** Number of messages waiting in queue */
	queueLength: number
}

/**
 * Hook for sending messages to an OpenCode session with FIFO queue and SSE integration.
 *
 * **Message Queue Behavior:**
 * - Messages are queued client-side in FIFO order
 * - First message sends immediately via router caller (fire-and-forget)
 * - Subsequent messages wait for session to become idle before sending
 * - Session status tracked via SSE session.status events
 * - Queue auto-processes when session transitions from running → idle
 *
 * **Integration Points:**
 * - Uses `useOpencode` caller to invoke session.promptAsync route
 * - Uses `useSessionStatus` to monitor session running state
 * - Integrates with SSE via store.handleEvent → session.status updates
 * - Session status format: "running" | "pending" | "completed" | "error"
 *
 * Accepts rich prompt parts (text, file attachments) and converts them
 * to API format before sending via the Effect router.
 *
 * @example
 * ```tsx
 * const { sendMessage, isLoading, error, queueLength } = useSendMessage({
 *   sessionId: "ses_123",
 *   directory: "/path/to/project"
 * })
 *
 * const parts: Prompt = [
 *   { type: "text", content: "Fix bug in ", start: 0, end: 11 },
 *   { type: "file", path: "src/auth.ts", content: "@src/auth.ts", start: 11, end: 23 }
 * ]
 *
 * // Sends immediately if session is idle, otherwise queues
 * await sendMessage(parts)
 *
 * // Check queue status
 * console.log(`${queueLength} messages waiting`)
 * ```
 */
export function useSendMessage({
	sessionId,
	directory,
}: UseSendMessageOptions): UseSendMessageReturn {
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | undefined>(undefined)
	const [queueLength, setQueueLength] = useState(0)

	// Get command registry for slash command detection
	const { findCommand } = useCommands()

	/**
	 * Parse prompt parts to detect slash commands.
	 * Only text parts are checked - file/image parts are ignored.
	 *
	 * @param parts - The prompt parts to parse
	 * @returns ParsedCommand indicating if this is a command and its details
	 */
	const parseSlashCommand = useCallback(
		(parts: Prompt): ParsedCommand => {
			// Extract text content only (ignore file/image parts)
			const text = parts
				.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
				.map((p) => p.content)
				.join("")
				.trim()

			// Not a command if doesn't start with /
			if (!text.startsWith("/")) {
				return { isCommand: false }
			}

			// Parse command name and arguments
			const [cmdPart = "", ...argParts] = text.split(" ")
			const commandName = cmdPart.slice(1) // Remove leading /
			const args = argParts.join(" ")

			// Look up command in registry
			const command = findCommand(commandName)
			if (!command) {
				// Unknown command - treat as regular prompt
				return { isCommand: false }
			}

			return {
				isCommand: true,
				commandName,
				arguments: args,
				type: command.type,
			}
		},
		[findCommand],
	)

	// Queue for pending messages
	const queueRef = useRef<QueuedMessage[]>([])
	const isProcessingRef = useRef(false)
	// Ref to hold the processNext function to avoid circular deps
	const processNextRef = useRef<(() => Promise<void>) | undefined>(undefined)

	// Track session status to know when to process next message
	const status = useSessionStatus(sessionId)
	const running = status === "running"

	// Log status changes for debugging
	useEffect(() => {
		console.log("[useSendMessage] Session status changed:", { sessionId, status, running })
	}, [sessionId, status, running])

	/**
	 * Wait for multiServerSSE discovery to complete before sending
	 * This prevents routing to the wrong port (e.g., default 4056 instead of actual port)
	 *
	 * @param maxWaitMs - Maximum time to wait for discovery (default: 10s)
	 * @returns true if discovery completed, false if timed out
	 */
	const waitForDiscovery = useCallback(async (maxWaitMs = 10000): Promise<boolean> => {
		const startTime = Date.now()

		while (!multiServerSSE.isDiscoveryComplete() && Date.now() - startTime < maxWaitMs) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		return multiServerSSE.isDiscoveryComplete()
	}, [])

	/**
	 * Process a single message via router caller.
	 *
	 * Routes messages based on content:
	 * - Custom slash commands → session.command route
	 * - Builtin slash commands → skip (handled client-side)
	 * - Regular prompts → session.promptAsync route
	 *
	 * NOTE: Waits for multiServerSSE discovery to complete before sending
	 * to ensure correct port routing. Without this, createClient falls back
	 * to DEFAULT_PROXY_URL which may be the wrong port.
	 *
	 * @returns true if message was processed, false if skipped (builtin command)
	 */
	const processMessage = useCallback(
		async (parts: Prompt, model?: ModelSelection): Promise<boolean> => {
			console.log("[useSendMessage] processMessage called", { parts, model, sessionId, directory })

			// Wait for discovery to complete (max 10s)
			const discoveryComplete = await waitForDiscovery()
			if (!discoveryComplete) {
				console.error("[useSendMessage] Server discovery timed out")
				throw new Error("Server discovery timed out. Is the OpenCode backend running?")
			}
			console.log("[useSendMessage] Discovery complete")

			// Check if this is a slash command
			const parsed = parseSlashCommand(parts)
			console.log("[useSendMessage] Parsed command:", parsed)

			if (parsed.isCommand) {
				if (parsed.type === "custom") {
					// Custom command - route to session.command
					console.log("[useSendMessage] Sending custom command:", parsed.commandName)
					await sessions.command(sessionId, parsed.commandName, parsed.arguments, directory)
					return true
				}
				// Builtin command - skip, handled client-side
				console.log("[useSendMessage] Builtin command, skipping")
				return false
			}

			// Regular prompt - convert and send via session.promptAsync
			const apiParts = prompt.convertToApiParts(parts, directory || "")
			console.log("[useSendMessage] Sending prompt:", { sessionId, apiParts, model, directory })

			await sessions.promptAsync(sessionId, apiParts, model, directory)
			console.log("[useSendMessage] Prompt sent successfully")
			return true
		},
		[sessionId, directory, parseSlashCommand, waitForDiscovery],
	)

	// Process next message from queue if session is idle
	const processNext = useCallback(async () => {
		console.log("[useSendMessage] processNext called", {
			isProcessing: isProcessingRef.current,
			queueLength: queueRef.current.length,
			running,
			status,
		})

		// Don't process if:
		// - Already processing a message
		// - Queue is empty
		// - Session is running (server-side AI is busy)
		if (isProcessingRef.current || queueRef.current.length === 0 || running) {
			console.log("[useSendMessage] Skipping processNext:", {
				alreadyProcessing: isProcessingRef.current,
				emptyQueue: queueRef.current.length === 0,
				sessionRunning: running,
			})
			return
		}

		console.log("[useSendMessage] Processing next message from queue")
		isProcessingRef.current = true
		setIsLoading(true)

		const message = queueRef.current[0]! // Peek first

		try {
			setError(undefined)
			// Fire the message (promptAsync returns immediately - 204 response)
			await processMessage(message.parts, message.model)
			// Remove from queue after send completes
			queueRef.current.shift()
			setQueueLength(queueRef.current.length)
			console.log(
				"[useSendMessage] Message processed successfully, queue length:",
				queueRef.current.length,
			)
			message.resolve()
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
			console.error("[useSendMessage] Error processing message:", error)
			setError(error)
			// Remove failed message from queue
			queueRef.current.shift()
			setQueueLength(queueRef.current.length)
			message.reject(error)
		} finally {
			isProcessingRef.current = false
			setIsLoading(false)

			// After finishing, try to process next message in queue
			// This ensures queue keeps draining when session is idle
			if (queueRef.current.length > 0 && processNextRef.current) {
				console.log("[useSendMessage] More messages in queue, scheduling next")
				// Use setTimeout to avoid recursive call stack and let React update
				setTimeout(() => processNextRef.current?.(), 0)
			}
		}
	}, [processMessage, running, status])

	// Store processNext in ref so it can call itself without circular dep
	processNextRef.current = processNext

	const sendMessage = useCallback(
		async (parts: Prompt, model?: ModelSelection) => {
			console.log("[useSendMessage] sendMessage called", { parts, model })

			// Don't send empty messages
			if (parts.length === 0) {
				console.log("[useSendMessage] Empty message, skipping")
				return
			}

			return new Promise<void>((resolve, reject) => {
				// Add to queue
				queueRef.current.push({ parts, model, resolve, reject })
				setQueueLength(queueRef.current.length)
				console.log("[useSendMessage] Message queued, queue length:", queueRef.current.length)

				// Try to process immediately if session is idle
				processNext()
			})
		},
		[processNext],
	)

	// Watch session status - when session becomes idle, process next queued message
	useEffect(() => {
		// Session became idle - process next message in queue
		if (!running && queueRef.current.length > 0 && !isProcessingRef.current) {
			processNext()
		}
	}, [running, processNext])

	return {
		sendMessage,
		isLoading,
		error,
		queueLength,
	}
}
