/**
 * @opencode-vibe/core/sse
 *
 * Server-Sent Events (SSE) streaming for real-time updates
 */

export { normalizeStatus } from "./normalize-status.js"

// SSE Event Schemas (Effect Schema)
// Note: Export schemas with "Schema" suffix to avoid conflicts with domain types
export {
	// Part schemas
	PartBase as PartBaseSchema,
	TextPart as TextPartSchema,
	ReasoningPart as ReasoningPartSchema,
	FilePart as FilePartSchema,
	ToolPart as ToolPartSchema,
	StepStartPart as StepStartPartSchema,
	StepFinishPart as StepFinishPartSchema,
	SnapshotPart as SnapshotPartSchema,
	PatchPart as PatchPartSchema,
	AgentPart as AgentPartSchema,
	RetryPart as RetryPartSchema,
	CompactionPart as CompactionPartSchema,
	Part as PartSchema,
	// Session schemas
	SessionInfo as SessionInfoSchema,
	SessionStatus as SessionStatusSchema,
	// Message schemas
	MessageInfo as MessageInfoSchema,
	// Event schemas
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
	SSEEvent as SSEEventSchema,
	// Types (inferred from schemas)
	type Part as PartSchemaType,
	type SessionStatus as SessionStatusSchemaType,
	type MessageInfo as MessageInfoSchemaType,
	type SSEEvent as SSEEventSchemaType,
} from "./schemas.js"

// Parsing utilities
export { parseSSEEvent, parseSSEEventSync } from "./parse.js"
