"use client"

import { Fragment, useMemo, memo } from "react"
import type { UIMessage, ChatStatus } from "ai"
import { useMessagesWithParts, useSessionStatus } from "@opencode-vibe/react"
import type { Message as CoreMessage, Part } from "@opencode-vibe/core/types"
import {
	transformMessages,
	type ExtendedUIMessage,
	type OpencodeMessage,
} from "@/lib/transform-messages"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning"
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	ConversationEmptyState,
} from "@/components/ai-elements/conversation"
import { Loader } from "@/components/ai-elements/loader"
import { Clock } from "lucide-react"

interface SessionMessagesProps {
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
	/** External status from parent (e.g., when sending a message) */
	status?: ChatStatus
}

// Issue 3 fix: Stable filter function - extracted to module scope
const hasNonEmptyParts = (message: UIMessage) => (message.parts?.length ?? 0) > 0

// Issue 2 fix: Memoization helper for regex sanitization
const sanitizeCache = new Map<string, string>()
const sanitizeToolType = (type: string): string => {
	if (sanitizeCache.has(type)) {
		return sanitizeCache.get(type)!
	}
	const sanitized = type.replace(/[^a-zA-Z0-9\-_.]/g, "_")
	sanitizeCache.set(type, sanitized)
	return sanitized
}

/**
 * Message state for pending/processing detection
 */
type MessageState = "pending" | "processing" | "complete" | "error"

/**
 * Get the state of a message based on its metadata and related messages
 */
function getMessageState(
	message: ExtendedUIMessage,
	allMessages: ExtendedUIMessage[],
	sessionRunning: boolean,
): MessageState {
	const opencode = message._opencode

	if (message.role === "user") {
		// Find assistant response to this user message
		// First try parentID match (if backend provides it)
		let response = allMessages.find(
			(m) => m.role === "assistant" && m._opencode?.parentID === message.id,
		)

		// Fallback: find the next assistant message after this user message by position
		// This handles cases where parentID isn't set (e.g., initial page load)
		if (!response) {
			const userIndex = allMessages.findIndex((m) => m.id === message.id)
			if (userIndex !== -1 && userIndex < allMessages.length - 1) {
				const nextMessage = allMessages[userIndex + 1]
				if (nextMessage?.role === "assistant") {
					response = nextMessage
				}
			}
		}

		if (!response) {
			// No response yet - show as pending (queued) only if session is running
			// If session is idle and no response, it's just an unanswered message (complete)
			return sessionRunning ? "pending" : "complete"
		}

		// Response exists - no longer queued, either processing or complete
		if (response._opencode?.finish) {
			return "complete"
		}

		// Response exists but not finished = processing (but not queued)
		return "processing"
	}

	if (message.role === "assistant") {
		if (!opencode?.finish) {
			return "processing"
		}
		return "complete"
	}

	return "complete"
}

/**
 * Status indicator for pending messages (truly queued, no response yet)
 */
function MessageStatusIndicator({ state }: { state: MessageState }) {
	// Only show "Queued" when truly pending (no assistant response exists yet)
	// Once assistant starts responding, hide the indicator immediately
	if (state !== "pending") return null

	return (
		<div className="flex items-center gap-1.5 text-xs text-amber-500 mt-1">
			<Clock className="size-3" />
			<span>Queued</span>
		</div>
	)
}

/**
 * Issue 1 fix: Memoized message renderer with content-aware comparison.
 * Only re-renders when message content actually changes, not when other messages update.
 */
const MessageRenderer = memo(
	({
		message,
		messageIndex,
		status,
		messageState,
	}: {
		message: ExtendedUIMessage
		messageIndex: number
		status: ChatStatus
		messageState: MessageState
	}) => {
		return (
			<div className="flex flex-col gap-3">
				{message.parts!.map((part, i) => {
					// Generate stable key from message ID + part index
					const partKey = `${message.id || messageIndex}-part-${i}`

					if (part.type === "text") {
						return (
							<Message key={partKey} from={message.role}>
								<MessageContent>
									<MessageResponse>{part.text}</MessageResponse>
									{/* Show status indicator on user messages */}
									{message.role === "user" && i === message.parts!.length - 1 && (
										<MessageStatusIndicator state={messageState} />
									)}
								</MessageContent>
							</Message>
						)
					}

					if (part.type === "reasoning") {
						return (
							<Reasoning key={partKey} isStreaming={status === "streaming"}>
								<ReasoningTrigger />
								<ReasoningContent>{part.text}</ReasoningContent>
							</Reasoning>
						)
					}

					if (part.type?.startsWith("tool-")) {
						const toolPart = part as {
							type: `tool-${string}`
							toolCallId?: string
							title?: string
							state?:
								| "input-streaming"
								| "input-available"
								| "approval-requested"
								| "approval-responded"
								| "output-available"
								| "output-error"
								| "output-denied"
							input?: unknown
							output?: unknown
							errorText?: string
							_opencode?: any // Preserved OpenCode ToolPart
						}

						// Runtime sanitization - safety net for cached data with invalid chars
						// Tool names with < > break React's createElement on Mobile Safari
						// Use cached sanitization (Issue 2 fix)
						const safeType = sanitizeToolType(toolPart.type) as typeof toolPart.type

						// If OpenCode ToolPart is available, use enhanced ToolCard
						if (toolPart._opencode) {
							return <Tool key={partKey} toolPart={toolPart._opencode} />
						}

						// Fallback to basic AI SDK tool rendering
						return (
							<Tool key={partKey}>
								<ToolHeader
									title={toolPart.title || safeType.replace("tool-", "")}
									type={safeType}
									state={toolPart.state}
								/>
								<ToolContent>
									<ToolInput input={toolPart.input} />
									<ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
								</ToolContent>
							</Tool>
						)
					}

					// Unknown part type - render nothing but with a key
					return <Fragment key={partKey} />
				})}
			</div>
		)
	},
	// Content-aware comparison: only re-render if message identity or content changes
	(prev, next) => {
		// Compare message ID
		if (prev.message.id !== next.message.id) return false
		// Compare message state (pending/processing/complete)
		if (prev.messageState !== next.messageState) return false
		// Compare parts length (indicates content change)
		if (prev.message.parts?.length !== next.message.parts?.length) return false
		// Compare streaming status (affects reasoning component)
		if (prev.status !== next.status) return false
		// If last part exists, compare its type and content for streaming updates
		const prevLastPart = prev.message.parts?.[prev.message.parts.length - 1]
		const nextLastPart = next.message.parts?.[next.message.parts.length - 1]
		if (prevLastPart?.type !== nextLastPart?.type) return false
		// For text/reasoning, compare content
		if (prevLastPart?.type === "text" || prevLastPart?.type === "reasoning") {
			if ((prevLastPart as any).text !== (nextLastPart as any).text) return false
		}
		// For tools, compare state
		if (prevLastPart?.type?.startsWith("tool-")) {
			if ((prevLastPart as any).state !== (nextLastPart as any).state) return false
		}
		return true // Props are equal, skip re-render
	},
)
MessageRenderer.displayName = "MessageRenderer"

/**
 * Client component for session messages with real-time updates.
 *
 * Hydrates from server-provided data, then subscribes to SSE for real-time updates.
 * This ensures zero flicker on initial load - data is already present from RSC.
 *
 * This component is DISPLAY ONLY - input handling is done by the parent via PromptInput.
 */
export function SessionMessages({
	sessionId,
	directory,
	initialMessages,
	initialStoreMessages,
	initialStoreParts,
	status: externalStatus,
}: SessionMessagesProps) {
	// Flatten initialStoreParts from Record<messageId, Part[]> to Part[]
	const initialPartsFlat = useMemo(() => {
		return Object.values(initialStoreParts).flat() as Part[]
	}, [initialStoreParts])

	// Get messages with parts from store
	const storeMessages = useMessagesWithParts(sessionId)

	// Get session status from store
	const sessionStatus = useSessionStatus(sessionId)
	const running = sessionStatus === "running"

	// Transform store messages to UIMessage format (with extended metadata)
	// Since we're hydrated, storeMessages always has data on first render
	const messages = useMemo(() => {
		if (storeMessages.length === 0) return initialMessages as ExtendedUIMessage[]
		return transformMessages(storeMessages as unknown as OpencodeMessage[]) as ExtendedUIMessage[]
	}, [storeMessages, initialMessages])

	// Determine status: external (from parent) > running (from store) > ready
	const status: ChatStatus = externalStatus ?? (running ? "streaming" : "ready")
	const isLoading = status === "submitted" || status === "streaming"

	return (
		<div className="flex flex-col h-full min-h-0">
			<Conversation className="flex-1 min-h-0">
				{messages.length === 0 && !isLoading ? (
					<ConversationEmptyState title="No messages yet" description="Start a conversation" />
				) : (
					<ConversationContent>
						{messages.filter(hasNonEmptyParts).map((message, messageIndex) => (
							<MessageRenderer
								key={message.id || `msg-${messageIndex}`}
								message={message}
								messageIndex={messageIndex}
								status={status}
								messageState={getMessageState(message, messages, running)}
							/>
						))}
						{status === "submitted" && <Loader />}
					</ConversationContent>
				)}
				<ConversationScrollButton />
			</Conversation>
		</div>
	)
}
