/**
 * useSession - Unified facade hook for session management
 *
 * This hook provides a complete session API by wrapping all internal hooks:
 * - Session data (useSessionData)
 * - Messages with parts (useMessagesWithParts)
 * - Session status (useSessionStatus)
 * - Send message action (useSendMessage)
 * - Context usage (useContextUsage)
 * - Compaction state (useCompactionState)
 * - Subagent sync (useSubagentSync)
 *
 * **Design Philosophy:**
 * - Single import for all session functionality
 * - Internal hooks remain available for optimized use cases
 * - Facade reduces boilerplate for common patterns
 * - Minimal overhead - just delegation, no extra state
 *
 * @example
 * ```tsx
 * function SessionView({ sessionId }: { sessionId: string }) {
 *   const {
 *     data,
 *     messages,
 *     running,
 *     sendMessage,
 *     contextUsage,
 *     compacting
 *   } = useSession(sessionId)
 *
 *   if (!data) return <div>Loading...</div>
 *
 *   return (
 *     <div>
 *       <h1>{data.title}</h1>
 *       {running && <Spinner />}
 *       <MessageList messages={messages} />
 *       <ContextIndicator usage={contextUsage} />
 *       {compacting && <CompactionIndicator />}
 *       <PromptInput onSend={sendMessage} />
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useEffect, useRef } from "react"
import type { Prompt } from "../types/prompt"
import type { Session, ContextUsage } from "../store/types"
import { useSessionData } from "./use-session-data"
import { useMessagesWithParts, type OpencodeMessage } from "./internal/use-messages-with-parts"
import { useSessionStatus } from "./internal/use-session-status"
import { useSendMessage, type ModelSelection } from "./use-send-message"
import { useContextUsage } from "./internal/use-context-usage"
import { useCompactionState } from "./internal/use-compaction-state"
import { useSubagentSync } from "./internal/use-subagent-sync"
import { useOpencode } from "../providers"
import { useOpencodeStore } from "../store"

/**
 * Options for useSession hook
 */
export interface UseSessionOptions {
	/** Directory to scope session to (uses context directory if omitted) */
	directory?: string
	/** Callback when a new message is created */
	onMessage?: (msg: any) => void
	/** Callback when an error occurs */
	onError?: (err: Error) => void
}

/**
 * Return value from useSession hook
 */
export interface UseSessionReturn {
	// Session data
	/** Session metadata (undefined if not found or archived) */
	data: Session | undefined
	/** Messages with associated parts */
	messages: OpencodeMessage[]

	// Status
	/** Whether the session is currently running (AI is processing) */
	running: boolean
	/** Whether a message send is in progress */
	isLoading: boolean
	/** Error from last send operation */
	error: Error | undefined

	// Actions
	/** Send a message to the session */
	sendMessage: (parts: Prompt, model?: ModelSelection) => Promise<void>
	/** Number of messages waiting in send queue */
	queueLength: number

	// Context
	/** Token usage and context limit information */
	contextUsage: ContextUsage | undefined
	/** Whether session is currently being compacted */
	compacting: boolean
}

/**
 * Unified session hook combining all session-related functionality
 *
 * @param sessionId - Session ID to manage
 * @param options - Optional configuration (directory, callbacks)
 * @returns Complete session API
 *
 * @example
 * ```tsx
 * const session = useSession(sessionId, {
 *   onMessage: (msg) => console.log('New message:', msg),
 *   onError: (err) => toast.error(err.message)
 * })
 * ```
 */
export function useSession(sessionId: string, options?: UseSessionOptions): UseSessionReturn {
	const contextValue = useOpencode()
	const directory = options?.directory ?? contextValue.directory

	// Session data
	const data = useSessionData(sessionId)
	const messages = useMessagesWithParts(sessionId)

	// Session status
	const status = useSessionStatus(sessionId)
	const running = status === "running"

	// Send message
	const { sendMessage, isLoading, error, queueLength } = useSendMessage({
		sessionId,
		directory,
	})

	// Context usage
	const contextUsage = useContextUsage(sessionId)

	// Compaction state
	const compactionState = useCompactionState(sessionId)
	const compacting = compactionState.isCompacting

	// Enable subagent tracking for this session
	useSubagentSync({ sessionId })

	// Call onMessage when messages change
	const messagesRef = useRef(messages)
	const onMessageRef = useRef(options?.onMessage)
	onMessageRef.current = options?.onMessage

	useEffect(() => {
		if (!onMessageRef.current) return

		// Find new messages (messages that weren't in previous render)
		const prevMessageIds = new Set(messagesRef.current.map((m) => m.info.id))
		const newMessages = messages.filter((m) => !prevMessageIds.has(m.info.id))

		// Call callback for each new message
		for (const msg of newMessages) {
			onMessageRef.current(msg.info)
		}

		// Update ref for next comparison
		messagesRef.current = messages
	}, [messages])

	// Call onError when error changes
	const onErrorRef = useRef(options?.onError)
	onErrorRef.current = options?.onError

	useEffect(() => {
		if (error && onErrorRef.current) {
			onErrorRef.current(error)
		}
	}, [error])

	return {
		// Session data
		data,
		messages,

		// Status
		running,
		isLoading,
		error,

		// Actions
		sendMessage,
		queueLength,

		// Context
		contextUsage,
		compacting,
	}
}
