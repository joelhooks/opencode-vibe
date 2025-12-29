"use client"

import { Fragment, useEffect, useMemo } from "react"
import type { UIMessage, ChatStatus } from "ai"
import { useMessagesWithParts } from "@/react/use-messages-with-parts"
import { useSessionStatus } from "@/react/use-session-status"
import { useOpencodeStore } from "@/react/store"
import { transformMessages } from "@/lib/transform-messages"
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

/**
 * Client component for session messages with real-time updates.
 *
 * Reads messages from Zustand store which is updated by useMultiServerSSE.
 * This ensures real-time updates from ALL OpenCode servers (TUIs, serve processes, etc.)
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
	// Hydrate store on mount with server-fetched data
	// CRITICAL: Must happen BEFORE SSE events start arriving
	// Empty deps = runs once on mount only
	// biome-ignore lint/correctness/useExhaustiveDependencies: Intentional - hydrate once on mount with initial prop values
	useEffect(() => {
		const store = useOpencodeStore.getState()
		// Use directory from props or fallback to session's directory
		const targetDirectory = directory || "/"
		store.hydrateMessages(targetDirectory, sessionId, initialStoreMessages, initialStoreParts)
	}, []) // Empty deps - run once on mount

	// Get messages with parts from Zustand store (updated by useMultiServerSSE)
	const storeMessages = useMessagesWithParts(sessionId)

	// Get session status from store
	const { running } = useSessionStatus(sessionId)

	// Transform store messages to UIMessage format
	const transformedStoreMessages = useMemo(() => {
		if (storeMessages.length === 0) return []
		return transformMessages(storeMessages)
	}, [storeMessages])

	// Use store messages if available, otherwise fall back to initial messages
	// This ensures we show initial SSR data until real-time updates arrive
	const messages = storeMessages.length > 0 ? transformedStoreMessages : initialMessages

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
						{messages
							.filter((message) => (message.parts?.length ?? 0) > 0)
							.map((message, messageIndex) => (
								<div key={message.id || `msg-${messageIndex}`} className="flex flex-col gap-3">
									{message.parts!.map((part, i) => {
										// Generate stable key from message ID + part index
										const partKey = `${message.id || messageIndex}-part-${i}`

										if (part.type === "text") {
											return (
												<Message key={partKey} from={message.role}>
													<MessageContent>
														<MessageResponse>{part.text}</MessageResponse>
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
											// Use comprehensive sanitization - only allow valid element name chars
											const safeType = toolPart.type.replace(
												/[^a-zA-Z0-9\-_.]/g,
												"_",
											) as typeof toolPart.type

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
							))}
						{status === "submitted" && <Loader />}
					</ConversationContent>
				)}
				<ConversationScrollButton />
			</Conversation>
		</div>
	)
}
