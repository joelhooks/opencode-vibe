/**
 * Effect Schema definitions for SSE events
 *
 * Source of truth: https://github.com/sst/opencode/blob/dev/packages/sdk/openapi.json
 * Sync this file when OpenAPI spec changes.
 *
 * Parse at boundary - types flow everywhere.
 * Based on backend event shapes from mem-b8ab15188f533bf4.
 *
 * Event Structure: { type: string, properties: {...} }
 * Part Base: ALL parts have { id, sessionID, messageID }
 */

import { Schema as S } from "effect"

// ============================================================================
// Part Schemas
// ============================================================================

/**
 * PartBase - ALL parts have these fields
 * CRITICAL: sessionID is included - no message lookup needed
 */
export class PartBase extends S.Class<PartBase>("PartBase")({
	id: S.String,
	sessionID: S.String,
	messageID: S.String,
}) {}

/**
 * TextPart - Plain text content
 */
export class TextPart extends PartBase.extend<TextPart>("TextPart")({
	type: S.Literal("text"),
	text: S.String,
}) {}

/**
 * ReasoningPart - Model reasoning/thinking
 */
export class ReasoningPart extends PartBase.extend<ReasoningPart>("ReasoningPart")({
	type: S.Literal("reasoning"),
	reasoning: S.String,
}) {}

/**
 * FilePart - File content or reference
 */
export class FilePart extends PartBase.extend<FilePart>("FilePart")({
	type: S.Literal("file"),
	path: S.optional(S.String),
	content: S.optional(S.String),
}) {}

/**
 * ToolPart - Tool invocation/result
 */
export class ToolPart extends PartBase.extend<ToolPart>("ToolPart")({
	type: S.Literal("tool"),
	tool: S.String,
	state: S.optional(S.Record({ key: S.String, value: S.Unknown })),
}) {}

/**
 * StepStartPart - Step execution start
 */
export class StepStartPart extends PartBase.extend<StepStartPart>("StepStartPart")({
	type: S.Literal("step-start"),
	step: S.optional(S.String),
}) {}

/**
 * StepFinishPart - Step execution finish
 */
export class StepFinishPart extends PartBase.extend<StepFinishPart>("StepFinishPart")({
	type: S.Literal("step-finish"),
	step: S.optional(S.String),
}) {}

/**
 * SnapshotPart - State snapshot
 */
export class SnapshotPart extends PartBase.extend<SnapshotPart>("SnapshotPart")({
	type: S.Literal("snapshot"),
	snapshot: S.optional(S.Unknown),
}) {}

/**
 * PatchPart - State patch/diff
 */
export class PatchPart extends PartBase.extend<PatchPart>("PatchPart")({
	type: S.Literal("patch"),
	patch: S.optional(S.Unknown),
}) {}

/**
 * AgentPart - Agent invocation
 */
export class AgentPart extends PartBase.extend<AgentPart>("AgentPart")({
	type: S.Literal("agent"),
	agent: S.optional(S.String),
}) {}

/**
 * RetryPart - Retry metadata
 */
export class RetryPart extends PartBase.extend<RetryPart>("RetryPart")({
	type: S.Literal("retry"),
	attempt: S.optional(S.Number),
}) {}

/**
 * CompactionPart - Compaction metadata
 */
export class CompactionPart extends PartBase.extend<CompactionPart>("CompactionPart")({
	type: S.Literal("compaction"),
	reason: S.optional(S.String),
}) {}

/**
 * Part - Discriminated union of all part types
 */
export const Part = S.Union(
	TextPart,
	ReasoningPart,
	FilePart,
	ToolPart,
	StepStartPart,
	StepFinishPart,
	SnapshotPart,
	PatchPart,
	AgentPart,
	RetryPart,
	CompactionPart,
)
export type Part = S.Schema.Type<typeof Part>

// ============================================================================
// Session Schemas
// ============================================================================

/**
 * Session.Info - Core session metadata
 */
export class SessionInfo extends S.Class<SessionInfo>("SessionInfo")({
	id: S.String,
	title: S.String,
	directory: S.String,
	projectID: S.optional(S.String),
	parentID: S.optional(S.String),
	summary: S.optional(S.Unknown),
	share: S.optional(S.Unknown),
	version: S.optional(S.String),
	time: S.Struct({
		created: S.Number,
		updated: S.Number,
		compacting: S.optional(S.Number),
		archived: S.optional(S.Number),
	}),
	permission: S.optional(S.Unknown),
	revert: S.optional(S.Unknown),
}) {}

/**
 * SessionStatus - Discriminated union for session states
 */
export const SessionStatusIdle = S.Struct({
	type: S.Literal("idle"),
})

export const SessionStatusBusy = S.Struct({
	type: S.Literal("busy"),
})

export const SessionStatusRetry = S.Struct({
	type: S.Literal("retry"),
	attempt: S.Number,
	message: S.String,
	next: S.Number,
})

export const SessionStatus = S.Union(SessionStatusIdle, SessionStatusBusy, SessionStatusRetry)
export type SessionStatus = S.Schema.Type<typeof SessionStatus>

// ============================================================================
// Message Schemas
// ============================================================================

/**
 * Message.Info - Core message metadata (discriminated by role)
 */
export const MessageInfo = S.Struct({
	id: S.String,
	sessionID: S.String,
	role: S.String, // "user" | "assistant" - keep loose for now
	time: S.Struct({
		created: S.Number,
		completed: S.optional(S.Number),
	}),
	// Optional fields present on different role types
	summary: S.optional(S.Unknown),
	agent: S.optional(S.String),
	model: S.optional(S.Unknown),
	system: S.optional(S.Unknown),
	tools: S.optional(S.Unknown),
	variant: S.optional(S.Unknown),
	error: S.optional(S.Unknown),
	parentID: S.optional(S.String),
	modelID: S.optional(S.String),
	providerID: S.optional(S.String),
	mode: S.optional(S.String),
	path: S.optional(S.Unknown),
	cost: S.optional(S.Unknown),
	tokens: S.optional(S.Unknown),
	finish: S.optional(S.String),
})
export type MessageInfo = S.Schema.Type<typeof MessageInfo>

// ============================================================================
// Session Event Schemas
// ============================================================================

export class SessionCreatedEvent extends S.Class<SessionCreatedEvent>("SessionCreatedEvent")({
	type: S.Literal("session.created"),
	properties: S.Struct({
		info: SessionInfo,
	}),
}) {}

export class SessionUpdatedEvent extends S.Class<SessionUpdatedEvent>("SessionUpdatedEvent")({
	type: S.Literal("session.updated"),
	properties: S.Struct({
		info: SessionInfo,
	}),
}) {}

export class SessionDeletedEvent extends S.Class<SessionDeletedEvent>("SessionDeletedEvent")({
	type: S.Literal("session.deleted"),
	properties: S.Struct({
		info: SessionInfo,
	}),
}) {}

export class SessionStatusEvent extends S.Class<SessionStatusEvent>("SessionStatusEvent")({
	type: S.Literal("session.status"),
	properties: S.Struct({
		sessionID: S.String,
		status: SessionStatus,
	}),
}) {}

export class SessionIdleEvent extends S.Class<SessionIdleEvent>("SessionIdleEvent")({
	type: S.Literal("session.idle"),
	properties: S.Struct({
		sessionID: S.String,
	}),
}) {}

export class SessionCompactedEvent extends S.Class<SessionCompactedEvent>("SessionCompactedEvent")({
	type: S.Literal("session.compacted"),
	properties: S.Struct({
		sessionID: S.String,
	}),
}) {}

export class SessionErrorEvent extends S.Class<SessionErrorEvent>("SessionErrorEvent")({
	type: S.Literal("session.error"),
	properties: S.Struct({
		sessionID: S.optional(S.String),
		error: S.Unknown,
	}),
}) {}

export class SessionDiffEvent extends S.Class<SessionDiffEvent>("SessionDiffEvent")({
	type: S.Literal("session.diff"),
	properties: S.Struct({
		sessionID: S.String,
		diff: S.Array(S.Unknown), // FileDiff[] - keep loose for now
	}),
}) {}

// ============================================================================
// Message Event Schemas
// ============================================================================

export class MessageUpdatedEvent extends S.Class<MessageUpdatedEvent>("MessageUpdatedEvent")({
	type: S.Literal("message.updated"),
	properties: S.Struct({
		info: MessageInfo,
	}),
}) {}

export class MessageRemovedEvent extends S.Class<MessageRemovedEvent>("MessageRemovedEvent")({
	type: S.Literal("message.removed"),
	properties: S.Struct({
		sessionID: S.String,
		messageID: S.String,
	}),
}) {}

// ============================================================================
// Part Event Schemas
// ============================================================================

/**
 * message.part.updated - Part object is NESTED in properties.part
 * CRITICAL: part.sessionID is available directly, no lookup needed
 */
export class MessagePartUpdatedEvent extends S.Class<MessagePartUpdatedEvent>(
	"MessagePartUpdatedEvent",
)({
	type: S.Literal("message.part.updated"),
	properties: S.Struct({
		part: Part,
		delta: S.optional(S.String),
	}),
}) {}

export class MessagePartRemovedEvent extends S.Class<MessagePartRemovedEvent>(
	"MessagePartRemovedEvent",
)({
	type: S.Literal("message.part.removed"),
	properties: S.Struct({
		sessionID: S.String,
		messageID: S.String,
		partID: S.String,
	}),
}) {}

// ============================================================================
// SSEEvent Union
// ============================================================================

/**
 * SSEEvent - Discriminated union of ALL SSE event types
 * Parse incoming events through this schema at the boundary
 */
export const SSEEvent = S.Union(
	SessionCreatedEvent,
	SessionUpdatedEvent,
	SessionDeletedEvent,
	SessionStatusEvent,
	SessionIdleEvent,
	SessionCompactedEvent,
	SessionErrorEvent,
	SessionDiffEvent,
	MessageUpdatedEvent,
	MessageRemovedEvent,
	MessagePartUpdatedEvent,
	MessagePartRemovedEvent,
)
export type SSEEvent = S.Schema.Type<typeof SSEEvent>
