import { useCallback, useState, useRef, useEffect } from "react"
import { createClient } from "@/core/client"
import type { Prompt } from "@/types/prompt"
import { convertToApiParts } from "@/lib/prompt-api"
import { useSessionStatus } from "./use-session-status"

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
 * - First message sends immediately via prompt_async (returns 204)
 * - Subsequent messages wait for session to become idle before sending
 * - Session status tracked via SSE session.status events
 * - Queue auto-processes when session transitions from running → idle
 *
 * **Integration Points:**
 * - Uses `useSessionStatus` to monitor session running state
 * - Integrates with SSE via store.handleEvent → session.status updates
 * - Session status format: "running" | "pending" | "completed" | "error"
 *
 * Accepts rich prompt parts (text, file attachments) and converts them
 * to API format before sending.
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

	// Queue for pending messages
	const queueRef = useRef<QueuedMessage[]>([])
	const isProcessingRef = useRef(false)
	// Ref to hold the processNext function to avoid circular deps
	const processNextRef = useRef<(() => Promise<void>) | undefined>(undefined)

	// Track session status to know when to process next message
	const { running } = useSessionStatus(sessionId)

	// Process a single message
	// NOTE: We create the client fresh each time to pick up the latest
	// server discovery from multiServerSSE. The session->port mapping
	// updates dynamically as we receive SSE events.
	const processMessage = useCallback(
		async (parts: Prompt, model?: ModelSelection) => {
			// Create client fresh to get latest server routing
			// Pass sessionId for session-specific routing (routes to the server that owns this session)
			const client = createClient(directory, sessionId)

			// Convert client parts to API format
			const apiParts = convertToApiParts(parts, directory || "")

			// Use promptAsync for fire-and-forget behavior
			// Returns 204 immediately, SSE events will notify when complete
			const response = await client.session.promptAsync({
				path: { id: sessionId },
				body: {
					parts: apiParts,
					model: model
						? {
								providerID: model.providerID,
								modelID: model.modelID,
							}
						: undefined,
				},
			})

			// Check if SDK returned an error in the response
			if (response.error) {
				const errorMessage =
					typeof response.error === "object" && "message" in response.error
						? String(response.error.message)
						: String(response.error)
				throw new Error(errorMessage)
			}

			// No response data to handle - promptAsync returns 204 void
		},
		[sessionId, directory],
	)

	// Process next message from queue if session is idle
	const processNext = useCallback(async () => {
		// Don't process if:
		// - Already processing a message
		// - Queue is empty
		// - Session is running (server-side AI is busy)
		if (isProcessingRef.current || queueRef.current.length === 0 || running) {
			return
		}

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
			message.resolve()
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
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
				// Use setTimeout to avoid recursive call stack and let React update
				setTimeout(() => processNextRef.current?.(), 0)
			}
		}
	}, [processMessage, running])

	// Store processNext in ref so it can call itself without circular dep
	processNextRef.current = processNext

	const sendMessage = useCallback(
		async (parts: Prompt, model?: ModelSelection) => {
			// Don't send empty messages
			if (parts.length === 0) {
				return
			}

			return new Promise<void>((resolve, reject) => {
				// Add to queue
				queueRef.current.push({ parts, model, resolve, reject })
				setQueueLength(queueRef.current.length)

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
