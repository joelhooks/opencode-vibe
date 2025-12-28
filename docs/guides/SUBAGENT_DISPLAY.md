# Subagent Display & Tracking Guide

```
    ╔═══════════════════════════════════════════════════════════════╗
    ║                                                               ║
    ║   ┌─────────────────────────────────────────────────────┐    ║
    ║   │  ███████╗██╗   ██╗██████╗  █████╗  ██████╗ ███████╗ │    ║
    ║   │  ██╔════╝██║   ██║██╔══██╗██╔══██╗██╔════╝ ██╔════╝ │    ║
    ║   │  ███████╗██║   ██║██████╔╝███████║██║  ███╗█████╗   │    ║
    ║   │  ╚════██║██║   ██║██╔══██╗██╔══██║██║   ██║██╔══╝   │    ║
    ║   │  ███████║╚██████╔╝██████╔╝██║  ██║╚██████╔╝███████╗ │    ║
    ║   │  ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝ │    ║
    ║   │                                                     │    ║
    ║   │         SUBAGENT DISPLAY & TRACKING GUIDE           │    ║
    ║   └─────────────────────────────────────────────────────┘    ║
    ║                                                               ║
    ║   Making invisible subagents visible in your React client    ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
```

---

## The Problem

When OpenCode spawns subagents via the Task tool, they execute in **child sessions** that are:

- Linked via `parentID` but not surfaced in the UI
- Only visible as a collapsed "task" tool with a summary
- Missing real-time progress, tool calls, and streaming output

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CURRENT STATE (INVISIBLE)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Parent Session                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ User: "Explore the codebase"                                │   │
│  │                                                             │   │
│  │ Assistant:                                                  │   │
│  │   [Task: explore] ← Collapsed, shows only summary           │   │
│  │     • Read file.ts                                          │   │
│  │     • Grep "pattern"                                        │   │
│  │     • (no streaming, no real-time updates)                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Child Session (INVISIBLE)                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Full conversation with streaming, tool calls, reasoning... │   │
│  │ User never sees this!                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Solution

Subscribe to child session events and render them inline or in an expandable panel.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DESIRED STATE (VISIBLE)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Parent Session                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ User: "Explore the codebase"                                │   │
│  │                                                             │   │
│  │ Assistant:                                                  │   │
│  │   [Task: explore] ▼ (expanded)                              │   │
│  │   ┌───────────────────────────────────────────────────────┐ │   │
│  │   │ @explore subagent                                     │ │   │
│  │   │                                                       │ │   │
│  │   │ I'll search for API patterns...                       │ │   │
│  │   │                                                       │ │   │
│  │   │ [Read] src/api/routes.ts ✓                            │ │   │
│  │   │ [Grep] "export.*Handler" ✓                            │ │   │
│  │   │ [Read] src/api/middleware.ts ⏳ (streaming...)         │ │   │
│  │   │                                                       │ │   │
│  │   │ Found 12 API handlers across 4 files...               │ │   │
│  │   └───────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [How Subagents Work](#1-how-subagents-work)
2. [TypeScript Types](#2-typescript-types)
3. [SSE Event Tracking](#3-sse-event-tracking)
4. [React Implementation](#4-react-implementation)
5. [UI Components](#5-ui-components)
6. ["Currently Doing" Status Indicator](#6-currently-doing-status-indicator) ← **NEW**
7. [Advanced Patterns](#7-advanced-patterns)

---

## 1. How Subagents Work

### Spawning Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SUBAGENT LIFECYCLE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Parent calls Task tool                                          │
│     └─► Task({ subagent_type: "explore", prompt: "..." })           │
│                                                                     │
│  2. Task tool creates child session                                 │
│     └─► Session.create({ parentID: parentSessionID })               │
│     └─► Child session ID stored in ToolPart.metadata.sessionId      │
│                                                                     │
│  3. Task tool subscribes to child session events                    │
│     └─► Listens for message.part.updated in child                   │
│     └─► Updates parent ToolPart.metadata.summary                    │
│                                                                     │
│  4. Child session executes                                          │
│     └─► Full agentic loop with tools, streaming, etc.               │
│     └─► Events emitted: message.created, part.created, etc.         │
│                                                                     │
│  5. Task tool completes                                             │
│     └─► Returns child's final output to parent                      │
│     └─► Parent ToolPart marked completed                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Insight

The child session is a **full session** with its own messages, parts, and events. The parent only sees a summary via `ToolPart.metadata.summary`. To show real-time subagent progress, you must:

1. Detect when a Task tool starts (has `metadata.sessionId`)
2. Subscribe to the child session's events
3. Render child session content inline or in an expandable panel

---

## 2. TypeScript Types

### Session with Parent Link

```typescript
interface Session {
  id: string;
  parentID?: string; // Links child to parent session
  title: string;
  // ... other fields
}
```

### Task Tool Part

```typescript
interface ToolPart {
  id: string;
  type: "tool";
  tool: string; // "task" for subagent tools
  callID: string;
  state: ToolState;
}

// When tool is "task", state.metadata contains:
interface TaskToolMetadata {
  sessionId: string; // Child session ID - THE KEY!
  summary: TaskSummaryItem[]; // Collapsed view of child tools
}

interface TaskSummaryItem {
  id: string; // Part ID in child session
  tool: string; // Tool name (read, grep, edit, etc.)
  state: {
    status: "pending" | "running" | "completed" | "error";
    title?: string; // Tool output title
  };
}
```

### Tool States

```typescript
type ToolState =
  | ToolStatePending
  | ToolStateRunning
  | ToolStateCompleted
  | ToolStateError;

interface ToolStatePending {
  status: "pending";
  input: Record<string, unknown>;
  raw: string;
}

interface ToolStateRunning {
  status: "running";
  input: Record<string, unknown>;
  title?: string;
  metadata?: TaskToolMetadata; // Contains sessionId for task tools
  time: { start: number };
}

interface ToolStateCompleted {
  status: "completed";
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: TaskToolMetadata; // Contains sessionId + summary
  time: { start: number; end: number };
}

interface ToolStateError {
  status: "error";
  input: Record<string, unknown>;
  error: string;
  metadata?: TaskToolMetadata;
  time: { start: number; end: number };
}
```

### Message Types (for child session)

```typescript
interface UserMessage {
  id: string;
  sessionID: string;
  role: "user";
  agent: string;
  // ... other fields
}

interface AssistantMessage {
  id: string;
  sessionID: string;
  role: "assistant";
  agent: string;
  tokens: TokenUsage;
  cost: number;
  // ... other fields
}

type Message = UserMessage | AssistantMessage;
```

### Part Types (for child session)

```typescript
type Part = TextPart | ToolPart | StepStartPart | StepFinishPart | FilePart;
// ... other part types

interface TextPart {
  id: string;
  type: "text";
  text: string;
}

interface ToolPart {
  id: string;
  type: "tool";
  tool: string;
  callID: string;
  state: ToolState;
}
```

---

## 3. SSE Event Tracking

### Events to Subscribe To

The global SSE endpoint (`GET /global/event`) emits events for **all sessions** in the directory. Filter by `sessionID` to track specific child sessions.

```typescript
// Session events
interface EventSessionCreated {
  type: "session.created";
  properties: { info: Session }; // Check info.parentID
}

interface EventSessionUpdated {
  type: "session.updated";
  properties: { info: Session };
}

interface EventSessionStatus {
  type: "session.status";
  properties: {
    sessionID: string;
    status: SessionStatus;
  };
}

// Message events
interface EventMessageCreated {
  type: "message.created";
  properties: { info: Message }; // Check info.sessionID
}

interface EventMessageUpdated {
  type: "message.updated";
  properties: { info: Message };
}

// Part events (most important for real-time updates)
interface EventPartCreated {
  type: "message.part.created";
  properties: { part: Part }; // Check part.sessionID
}

interface EventPartUpdated {
  type: "message.part.updated";
  properties: {
    part: Part;
    delta?: string; // Streaming text delta
  };
}
```

### Detecting Child Sessions

```typescript
function isChildSession(session: Session, parentId: string): boolean {
  return session.parentID === parentId;
}

function isTaskToolWithSession(part: Part): part is ToolPart & {
  state: { metadata: { sessionId: string } };
} {
  return (
    part.type === "tool" &&
    part.tool === "task" &&
    "metadata" in part.state &&
    typeof part.state.metadata?.sessionId === "string"
  );
}
```

---

## 4. React Implementation

### Subagent Store

```typescript
// stores/subagent.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface SubagentSession {
  id: string;
  parentSessionId: string;
  parentPartId: string; // The Task tool part that spawned this
  agentName: string;
  status: "running" | "completed" | "error";
  messages: Message[];
  parts: Record<string, Part[]>; // By message ID
}

interface SubagentState {
  // Map of child session ID -> subagent data
  sessions: Record<string, SubagentSession>;

  // Map of parent part ID -> child session ID (for quick lookup)
  partToSession: Record<string, string>;

  // Expanded state for UI
  expanded: Set<string>; // Set of expanded part IDs

  // Actions
  registerSubagent: (
    childSessionId: string,
    parentSessionId: string,
    parentPartId: string,
    agentName: string,
  ) => void;

  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, message: Message) => void;
  addPart: (sessionId: string, messageId: string, part: Part) => void;
  updatePart: (sessionId: string, messageId: string, part: Part) => void;
  setStatus: (sessionId: string, status: SubagentSession["status"]) => void;

  toggleExpanded: (partId: string) => void;
  isExpanded: (partId: string) => boolean;

  getByParentPart: (partId: string) => SubagentSession | undefined;
}

export const useSubagentStore = create<SubagentState>()(
  immer((set, get) => ({
    sessions: {},
    partToSession: {},
    expanded: new Set(),

    registerSubagent: (
      childSessionId,
      parentSessionId,
      parentPartId,
      agentName,
    ) =>
      set((state) => {
        state.sessions[childSessionId] = {
          id: childSessionId,
          parentSessionId,
          parentPartId,
          agentName,
          status: "running",
          messages: [],
          parts: {},
        };
        state.partToSession[parentPartId] = childSessionId;
      }),

    addMessage: (sessionId, message) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (session) {
          session.messages.push(message);
          session.parts[message.id] = [];
        }
      }),

    updateMessage: (sessionId, message) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (session) {
          const idx = session.messages.findIndex((m) => m.id === message.id);
          if (idx !== -1) {
            session.messages[idx] = message;
          }
        }
      }),

    addPart: (sessionId, messageId, part) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (session) {
          if (!session.parts[messageId]) {
            session.parts[messageId] = [];
          }
          session.parts[messageId].push(part);
        }
      }),

    updatePart: (sessionId, messageId, part) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (session && session.parts[messageId]) {
          const idx = session.parts[messageId].findIndex(
            (p) => p.id === part.id,
          );
          if (idx !== -1) {
            session.parts[messageId][idx] = part;
          }
        }
      }),

    setStatus: (sessionId, status) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (session) {
          session.status = status;
        }
      }),

    toggleExpanded: (partId) =>
      set((state) => {
        if (state.expanded.has(partId)) {
          state.expanded.delete(partId);
        } else {
          state.expanded.add(partId);
        }
      }),

    isExpanded: (partId) => get().expanded.has(partId),

    getByParentPart: (partId) => {
      const sessionId = get().partToSession[partId];
      return sessionId ? get().sessions[sessionId] : undefined;
    },
  })),
);
```

### SSE Event Handler

```typescript
// hooks/useSubagentSync.ts
import { useEffect } from "react";
import { useSubagentStore } from "@/stores/subagent";

export function useSubagentSync(parentSessionId: string) {
  const registerSubagent = useSubagentStore((s) => s.registerSubagent);
  const addMessage = useSubagentStore((s) => s.addMessage);
  const updateMessage = useSubagentStore((s) => s.updateMessage);
  const addPart = useSubagentStore((s) => s.addPart);
  const updatePart = useSubagentStore((s) => s.updatePart);
  const setStatus = useSubagentStore((s) => s.setStatus);
  const sessions = useSubagentStore((s) => s.sessions);

  // Track which child sessions we're watching
  const childSessionIds = new Set(
    Object.values(sessions)
      .filter((s) => s.parentSessionId === parentSessionId)
      .map((s) => s.id),
  );

  useEffect(() => {
    const handleEvent = (event: SSEEvent) => {
      const { type, properties } = event.payload;

      switch (type) {
        // Detect new child sessions
        case "session.created": {
          const session = properties.info as Session;
          if (session.parentID === parentSessionId) {
            // Extract agent name from title: "description (@agent subagent)"
            const match = session.title.match(/@(\w+)\s+subagent/);
            const agentName = match?.[1] || "unknown";

            // We need to find the parent part ID - this comes from the Task tool
            // For now, we'll update this when we see the tool part
            registerSubagent(session.id, parentSessionId, "", agentName);
          }
          break;
        }

        // Track child session status
        case "session.status": {
          const { sessionID, status } = properties;
          if (childSessionIds.has(sessionID)) {
            if (status.type === "idle") {
              setStatus(sessionID, "completed");
            }
          }
          break;
        }

        // Track child session messages
        case "message.created": {
          const message = properties.info as Message;
          if (childSessionIds.has(message.sessionID)) {
            addMessage(message.sessionID, message);
          }
          break;
        }

        case "message.updated": {
          const message = properties.info as Message;
          if (childSessionIds.has(message.sessionID)) {
            updateMessage(message.sessionID, message);
          }
          break;
        }

        // Track child session parts (most important!)
        case "message.part.created": {
          const part = properties.part as Part;
          if (childSessionIds.has(part.sessionID)) {
            addPart(part.sessionID, part.messageID, part);
          }
          break;
        }

        case "message.part.updated": {
          const part = properties.part as Part;
          if (childSessionIds.has(part.sessionID)) {
            updatePart(part.sessionID, part.messageID, part);
          }
          break;
        }
      }
    };

    // Subscribe to SSE
    return subscribeToSSE(handleEvent);
  }, [parentSessionId, childSessionIds]);
}
```

### Detecting Task Tool Parts

```typescript
// hooks/useTaskToolDetection.ts
import { useEffect } from "react";
import { useSubagentStore } from "@/stores/subagent";
import { useMessageStore } from "@/stores/message";

export function useTaskToolDetection(sessionId: string) {
  const parts = useMessageStore((s) => s.parts[sessionId] || {});
  const registerSubagent = useSubagentStore((s) => s.registerSubagent);
  const sessions = useSubagentStore((s) => s.sessions);

  useEffect(() => {
    // Scan all parts for task tools with sessionId
    for (const [messageId, messageParts] of Object.entries(parts)) {
      for (const part of messageParts) {
        if (
          part.type === "tool" &&
          part.tool === "task" &&
          part.state.metadata?.sessionId
        ) {
          const childSessionId = part.state.metadata.sessionId;

          // Register if not already tracked
          if (!sessions[childSessionId]) {
            const agentType = part.state.input?.subagent_type || "unknown";
            registerSubagent(childSessionId, sessionId, part.id, agentType);
          }
        }
      }
    }
  }, [parts, sessionId]);
}
```

### Hook for Subagent Data

```typescript
// hooks/useSubagent.ts
import { useSubagentStore } from "@/stores/subagent";

export function useSubagent(partId: string) {
  const subagent = useSubagentStore((s) => s.getByParentPart(partId));
  const isExpanded = useSubagentStore((s) => s.isExpanded(partId));
  const toggleExpanded = useSubagentStore((s) => s.toggleExpanded);

  return {
    subagent,
    isExpanded,
    toggleExpanded: () => toggleExpanded(partId),
    hasSubagent: !!subagent,
    isRunning: subagent?.status === "running",
    isCompleted: subagent?.status === "completed",
  };
}
```

---

## 5. UI Components

### Task Tool with Expandable Subagent

```tsx
// components/TaskToolPart.tsx
import { useSubagent } from "@/hooks/useSubagent";
import { SubagentView } from "./SubagentView";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface TaskToolPartProps {
  part: ToolPart;
}

export function TaskToolPart({ part }: TaskToolPartProps) {
  const { subagent, isExpanded, toggleExpanded, isRunning } = useSubagent(
    part.id,
  );

  const input = part.state.input as {
    subagent_type?: string;
    description?: string;
  };

  const summary = (part.state.metadata?.summary || []) as TaskSummaryItem[];

  return (
    <div className="task-tool-part">
      {/* Header - always visible */}
      <button onClick={toggleExpanded} className="task-tool-header">
        <div className="task-tool-icon">
          {isRunning ? (
            <Loader2 className="animate-spin" />
          ) : isExpanded ? (
            <ChevronDown />
          ) : (
            <ChevronRight />
          )}
        </div>

        <div className="task-tool-info">
          <span className="task-tool-agent">@{input.subagent_type}</span>
          <span className="task-tool-description">{input.description}</span>
        </div>

        <div className="task-tool-status">
          <StatusBadge status={part.state.status} />
        </div>
      </button>

      {/* Collapsed summary */}
      {!isExpanded && summary.length > 0 && (
        <div className="task-tool-summary">
          {summary.slice(-3).map((item) => (
            <div key={item.id} className="task-summary-item">
              <ToolIcon name={item.tool} />
              <span className="task-summary-title">
                {item.state.title || item.tool}
              </span>
              <StatusDot status={item.state.status} />
            </div>
          ))}
          {summary.length > 3 && (
            <span className="task-summary-more">
              +{summary.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Expanded subagent view */}
      {isExpanded && subagent && <SubagentView subagent={subagent} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-500",
    running: "bg-blue-500 animate-pulse",
    completed: "bg-green-500",
    error: "bg-red-500",
  };

  return (
    <span className={`status-badge ${styles[status] || ""}`}>{status}</span>
  );
}

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-400",
    running: "bg-blue-400 animate-pulse",
    completed: "bg-green-400",
    error: "bg-red-400",
  };

  return <span className={`status-dot ${styles[status] || ""}`} />;
}
```

### Subagent View (Full Content)

```tsx
// components/SubagentView.tsx
import { SubagentSession } from "@/stores/subagent";
import { MessageBubble } from "./MessageBubble";
import { PartRenderer } from "./PartRenderer";

interface SubagentViewProps {
  subagent: SubagentSession;
}

export function SubagentView({ subagent }: SubagentViewProps) {
  return (
    <div className="subagent-view">
      <div className="subagent-header">
        <span className="subagent-agent">@{subagent.agentName}</span>
        <StatusIndicator status={subagent.status} />
      </div>

      <div className="subagent-messages">
        {subagent.messages.map((message) => (
          <div key={message.id} className="subagent-message">
            {message.role === "assistant" && (
              <div className="subagent-parts">
                {(subagent.parts[message.id] || []).map((part) => (
                  <PartRenderer key={part.id} part={part} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {subagent.status === "running" && (
        <div className="subagent-running">
          <Loader2 className="animate-spin" />
          <span>Working...</span>
        </div>
      )}
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  if (status === "running") {
    return (
      <div className="status-running">
        <Loader2 className="animate-spin h-3 w-3" />
        <span>Running</span>
      </div>
    );
  }

  if (status === "completed") {
    return <span className="status-completed">Completed</span>;
  }

  if (status === "error") {
    return <span className="status-error">Error</span>;
  }

  return null;
}
```

### Part Renderer (for subagent parts)

```tsx
// components/PartRenderer.tsx
import { Part, ToolPart, TextPart } from "@/types";

interface PartRendererProps {
  part: Part;
}

export function PartRenderer({ part }: PartRendererProps) {
  switch (part.type) {
    case "text":
      return <TextPartView part={part} />;
    case "tool":
      return <ToolPartView part={part} />;
    default:
      return null;
  }
}

function TextPartView({ part }: { part: TextPart }) {
  return (
    <div className="text-part">
      <Markdown content={part.text} />
    </div>
  );
}

function ToolPartView({ part }: { part: ToolPart }) {
  const isRunning = part.state.status === "running";
  const isCompleted = part.state.status === "completed";
  const isError = part.state.status === "error";

  return (
    <div className={`tool-part tool-${part.state.status}`}>
      <div className="tool-header">
        <ToolIcon name={part.tool} />
        <span className="tool-name">{part.tool}</span>
        {isRunning && <Loader2 className="animate-spin h-3 w-3" />}
        {isCompleted && <CheckIcon className="h-3 w-3 text-green-500" />}
        {isError && <XIcon className="h-3 w-3 text-red-500" />}
      </div>

      {isCompleted && part.state.title && (
        <div className="tool-title">{part.state.title}</div>
      )}

      {isError && <div className="tool-error">{part.state.error}</div>}
    </div>
  );
}
```

### Streaming Text Support

```tsx
// components/StreamingText.tsx
import { useEffect, useState } from "react";

interface StreamingTextProps {
  partId: string;
  initialText: string;
}

export function StreamingText({ partId, initialText }: StreamingTextProps) {
  const [text, setText] = useState(initialText);

  useEffect(() => {
    // Subscribe to part updates for streaming deltas
    const unsubscribe = subscribeToPartUpdates(partId, (delta) => {
      setText((prev) => prev + delta);
    });

    return unsubscribe;
  }, [partId]);

  return <Markdown content={text} />;
}
```

---

## 6. "Currently Doing" Status Indicator

The shallow/rolled-up view should show what the subagent is **actively doing right now**. This comes from the `metadata.summary` array on the Task tool part - specifically the last item with `status: "running"`.

### Data Source

The Task tool streams updates to its `metadata.summary` as the child session executes tools:

```typescript
// From ToolPart when tool === "task"
interface TaskToolMetadata {
  sessionId: string;
  summary: Array<{
    id: string;
    tool: string;
    state: {
      status: "pending" | "running" | "completed" | "error";
      title?: string; // Only present when completed
    };
  }>;
}
```

### Extracting "Currently Doing"

```typescript
function getCurrentlyDoing(part: ToolPart): CurrentActivity | null {
  if (part.tool !== "task") return null;
  if (part.state.status === "pending") return null;

  const metadata = part.state.metadata as TaskToolMetadata | undefined;
  if (!metadata?.summary) return null;

  // Find the currently running tool (last one with status: "running")
  const running = metadata.summary
    .filter((item) => item.state.status === "running")
    .at(-1);

  if (running) {
    return {
      type: "running",
      tool: running.tool,
      // No title yet - still in progress
    };
  }

  // If nothing running, show the last completed tool
  const lastCompleted = metadata.summary
    .filter((item) => item.state.status === "completed")
    .at(-1);

  if (lastCompleted) {
    return {
      type: "completed",
      tool: lastCompleted.tool,
      title: lastCompleted.state.title,
    };
  }

  return null;
}

interface CurrentActivity {
  type: "running" | "completed";
  tool: string;
  title?: string;
}
```

### Compact Status Component

```tsx
// components/SubagentCurrentActivity.tsx
import { Loader2, Check, FileText, Search, Edit, Terminal } from "lucide-react";

interface SubagentCurrentActivityProps {
  part: ToolPart;
}

export function SubagentCurrentActivity({
  part,
}: SubagentCurrentActivityProps) {
  const activity = getCurrentlyDoing(part);

  if (!activity) {
    // Still initializing
    if (part.state.status === "running") {
      return (
        <div className="current-activity initializing">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Starting...</span>
        </div>
      );
    }
    return null;
  }

  const ToolIcon = getToolIcon(activity.tool);

  return (
    <div className={`current-activity ${activity.type}`}>
      {activity.type === "running" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          <ToolIcon className="h-3 w-3" />
          <span className="tool-name">{formatToolName(activity.tool)}</span>
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span className="activity-title">
            {activity.title || activity.tool}
          </span>
        </>
      )}
    </div>
  );
}

function getToolIcon(tool: string) {
  const icons: Record<string, typeof FileText> = {
    read: FileText,
    grep: Search,
    glob: Search,
    edit: Edit,
    write: Edit,
    bash: Terminal,
    // Add more as needed
  };
  return icons[tool] || FileText;
}

function formatToolName(tool: string): string {
  const names: Record<string, string> = {
    read: "Reading file",
    grep: "Searching",
    glob: "Finding files",
    edit: "Editing",
    write: "Writing",
    bash: "Running command",
    task: "Subagent",
  };
  return names[tool] || tool;
}
```

### Rolled-Up Task Tool Header with Activity

```tsx
// components/TaskToolCompact.tsx
interface TaskToolCompactProps {
  part: ToolPart;
  onClick: () => void;
}

export function TaskToolCompact({ part, onClick }: TaskToolCompactProps) {
  const input = part.state.input as {
    subagent_type?: string;
    description?: string;
  };
  const metadata = part.state.metadata as TaskToolMetadata | undefined;
  const isRunning = part.state.status === "running";
  const isCompleted = part.state.status === "completed";

  // Count completed tools
  const completedCount =
    metadata?.summary?.filter((s) => s.state.status === "completed").length ??
    0;

  return (
    <button onClick={onClick} className="task-tool-compact">
      {/* Left: Status indicator */}
      <div className="task-status">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : isCompleted ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Circle className="h-4 w-4 text-gray-400" />
        )}
      </div>

      {/* Middle: Agent + description + current activity */}
      <div className="task-info">
        <div className="task-header-row">
          <span className="task-agent">@{input.subagent_type}</span>
          <span className="task-description">{input.description}</span>
        </div>

        {/* Currently doing - the key feature! */}
        {isRunning && <SubagentCurrentActivity part={part} />}

        {/* Completed summary */}
        {isCompleted && completedCount > 0 && (
          <span className="task-completed-count">
            {completedCount} tool{completedCount !== 1 ? "s" : ""} executed
          </span>
        )}
      </div>

      {/* Right: Expand chevron */}
      <ChevronRight className="h-4 w-4 text-gray-400" />
    </button>
  );
}
```

### Real-Time Updates via SSE

The `message.part.updated` event fires whenever the Task tool's metadata changes. This happens every time a child tool starts or completes:

```typescript
// In your SSE handler
case "message.part.updated": {
  const part = event.payload.properties.part;

  // Update the part in your store
  updatePart(part.sessionID, part.messageID, part);

  // The component will re-render with new metadata.summary
  // showing the updated "currently doing" status
  break;
}
```

### CSS for Current Activity

```css
.current-activity {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.current-activity.running {
  color: var(--color-primary);
}

.current-activity.running .tool-name {
  animation: pulse 2s infinite;
}

.current-activity.initializing {
  color: var(--color-text-muted);
  font-style: italic;
}

.task-tool-compact {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  width: 100%;
  text-align: left;
  background: var(--color-bg-element);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.task-tool-compact:hover {
  background: var(--color-bg-panel);
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-agent {
  font-weight: 600;
  color: var(--color-primary);
  flex-shrink: 0;
}

.task-description {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-completed-count {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}
```

### Example Output

```
┌─────────────────────────────────────────────────────────────────┐
│  ROLLED UP VIEW (Collapsed)                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⟳ @explore  Research the authentication flow                  │
│     🔍 Searching...                                             │
│                                                    [▶]          │
│                                                                 │
│  ✓ @refactorer  Rename getUserById to findUserById              │
│     12 tools executed                                           │
│                                                    [▶]          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  EXPANDED VIEW (Click to expand)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⟳ @explore  Research the authentication flow           [▼]    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  I'll search for authentication patterns...             │   │
│  │                                                         │   │
│  │  ✓ [Read] src/auth/middleware.ts                        │   │
│  │  ✓ [Grep] "session" in src/                             │   │
│  │  ⟳ [Read] src/auth/providers/oauth.ts  ← Currently      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Points

1. **Data comes from `metadata.summary`** - No extra API calls needed
2. **Real-time via SSE** - `message.part.updated` fires on every tool state change
3. **Last running tool** - Show the most recent tool with `status: "running"`
4. **Fallback to last completed** - When nothing running, show what just finished
5. **Compact display** - Tool icon + action verb ("Reading file", "Searching...")

---

## 7. Advanced Patterns

### Hybrid View Architecture

Combine shallow and deep views for optimal UX:

```
┌─────────────────────────────────────────────────────────────────┐
│                      HYBRID VIEW PATTERN                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SHALLOW VIEW (Default - No API calls)                          │
│  ─────────────────────────────────────                          │
│  Data source: Parent session's ToolPart.metadata                │
│  Shows: Agent name, description, current activity, tool count   │
│  Updates: Via parent session's SSE stream                       │
│                                                                 │
│  DEEP VIEW (On-demand - Lazy loaded)                            │
│  ────────────────────────────────────                           │
│  Data source: GET /session/:childId/message                     │
│  Shows: Full conversation, all tool calls, streaming text       │
│  Updates: Dedicated SSE subscription to child session           │
│                                                                 │
│  TRANSITION                                                     │
│  ──────────                                                     │
│  User clicks expand → Fetch child messages → Subscribe to SSE   │
│  User clicks collapse → Keep data cached → Unsubscribe SSE      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Nested Subagents

Subagents can spawn their own subagents. Handle this recursively:

```tsx
// components/TaskToolPart.tsx (updated)
export function TaskToolPart({
  part,
  depth = 0,
}: TaskToolPartProps & { depth?: number }) {
  const { subagent, isExpanded, toggleExpanded } = useSubagent(part.id);

  // Limit nesting depth for UI sanity
  const maxDepth = 3;

  return (
    <div className="task-tool-part" style={{ marginLeft: `${depth * 16}px` }}>
      {/* ... header ... */}

      {isExpanded && subagent && (
        <SubagentView
          subagent={subagent}
          renderTaskTool={(taskPart) =>
            depth < maxDepth ? (
              <TaskToolPart part={taskPart} depth={depth + 1} />
            ) : (
              <CollapsedTaskTool part={taskPart} />
            )
          }
        />
      )}
    </div>
  );
}
```

### Auto-Expand Running Subagents

```tsx
// hooks/useAutoExpandRunning.ts
import { useEffect } from "react";
import { useSubagentStore } from "@/stores/subagent";

export function useAutoExpandRunning() {
  const sessions = useSubagentStore((s) => s.sessions);
  const expanded = useSubagentStore((s) => s.expanded);
  const toggleExpanded = useSubagentStore((s) => s.toggleExpanded);

  useEffect(() => {
    // Auto-expand running subagents
    for (const session of Object.values(sessions)) {
      if (session.status === "running" && !expanded.has(session.parentPartId)) {
        toggleExpanded(session.parentPartId);
      }
    }
  }, [sessions]);
}
```

### Subagent Progress Bar

```tsx
// components/SubagentProgress.tsx
interface SubagentProgressProps {
  subagent: SubagentSession;
}

export function SubagentProgress({ subagent }: SubagentProgressProps) {
  // Count tool states
  const allParts = Object.values(subagent.parts).flat();
  const toolParts = allParts.filter((p): p is ToolPart => p.type === "tool");

  const completed = toolParts.filter(
    (p) => p.state.status === "completed",
  ).length;
  const running = toolParts.filter((p) => p.state.status === "running").length;
  const total = toolParts.length;

  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="subagent-progress">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
        {running > 0 && (
          <div
            className="progress-running"
            style={{
              left: `${progress}%`,
              width: `${(running / total) * 100}%`,
            }}
          />
        )}
      </div>
      <span className="progress-text">
        {completed}/{total} tools
      </span>
    </div>
  );
}
```

### Mobile-Friendly Subagent Sheet

```tsx
// components/SubagentSheet.tsx
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";

interface SubagentSheetProps {
  partId: string;
  open: boolean;
  onClose: () => void;
}

export function SubagentSheet({ partId, open, onClose }: SubagentSheetProps) {
  const { subagent } = useSubagent(partId);

  if (!subagent) return null;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[80vh]">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span className="font-medium">@{subagent.agentName}</span>
            <StatusIndicator status={subagent.status} />
          </div>
        </SheetHeader>

        <div className="subagent-sheet-content">
          <SubagentView subagent={subagent} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

---

## CSS Styles

```css
/* styles/subagent.css */

.task-tool-part {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.task-tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--color-bg-element);
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.task-tool-header:hover {
  background: var(--color-bg-panel);
}

.task-tool-agent {
  font-weight: 600;
  color: var(--color-primary);
}

.task-tool-description {
  color: var(--color-text-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-tool-summary {
  padding: 8px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--color-border);
}

.task-summary-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.subagent-view {
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
  max-height: 400px;
  overflow-y: auto;
}

.subagent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-bg-panel);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
}

.subagent-messages {
  padding: 12px;
}

.subagent-parts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-part {
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-bg-element);
}

.tool-part.tool-running {
  border-left: 2px solid var(--color-primary);
}

.tool-part.tool-completed {
  border-left: 2px solid var(--color-success);
}

.tool-part.tool-error {
  border-left: 2px solid var(--color-error);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.tool-title {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  color: white;
}

.subagent-running {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--color-text-muted);
}

/* Progress bar */
.subagent-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--color-bg-element);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--color-success);
  transition: width 0.3s ease;
}

.progress-running {
  position: absolute;
  top: 0;
  height: 100%;
  background: var(--color-primary);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
```

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SUBAGENT DISPLAY CHECKLIST                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Detection                                                          │
│  ─────────                                                          │
│  [x] Detect Task tool parts with metadata.sessionId                 │
│  [x] Track child sessions via parentID                              │
│  [x] Map parent part ID → child session ID                          │
│                                                                     │
│  SSE Subscription                                                   │
│  ────────────────                                                   │
│  [x] Subscribe to session.created (detect new children)             │
│  [x] Subscribe to message.created/updated (child messages)          │
│  [x] Subscribe to message.part.created/updated (child parts)        │
│  [x] Subscribe to session.status (completion detection)             │
│                                                                     │
│  State Management                                                   │
│  ────────────────                                                   │
│  [x] Subagent store with messages and parts                         │
│  [x] Expanded/collapsed state per task tool                         │
│  [x] Status tracking (running/completed/error)                      │
│                                                                     │
│  UI Components                                                      │
│  ─────────────                                                      │
│  [x] Expandable task tool header                                    │
│  [x] Collapsed summary view                                         │
│  [x] Full subagent view with messages/parts                         │
│  [x] Streaming text support                                         │
│  [x] Progress indicators                                            │
│  [x] Mobile-friendly sheet variant                                  │
│                                                                     │
│  "Currently Doing" Status (NEW)                                     │
│  ──────────────────────────────                                     │
│  [x] Extract running tool from metadata.summary                     │
│  [x] Show tool icon + action verb in rolled-up view                 │
│  [x] Real-time updates via message.part.updated                     │
│  [x] Fallback to last completed when nothing running                │
│                                                                     │
│  Hybrid View Architecture                                           │
│  ────────────────────────                                           │
│  [x] Shallow view: No API calls, uses parent's ToolPart.metadata    │
│  [x] Deep view: Lazy-loaded on expand, dedicated SSE subscription   │
│  [x] Cached data on collapse (don't refetch)                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Points

1. **No dedicated subagent events** - Track via `session.created` + `parentID` and `message.part.updated`
2. **Child session ID in metadata** - `ToolPart.state.metadata.sessionId` is the key
3. **Subscribe to child events** - Filter SSE events by child session ID
4. **Expandable UI** - Show collapsed summary by default, expand for full view
5. **Real-time updates** - Parts update via SSE, including streaming text deltas

---

_Last updated: December 2024_
