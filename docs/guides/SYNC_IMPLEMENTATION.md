# OpenCode Client Sync Implementation Guide

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   ╔═══════════════════════════════════════════════════════════════════╗     │
│   ║                                                                   ║     │
│   ║    ███████╗███████╗███████╗    ███████╗██╗   ██╗███╗   ██╗ ██████╗║     │
│   ║    ██╔════╝██╔════╝██╔════╝    ██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝║     │
│   ║    ███████╗███████╗█████╗      ███████╗ ╚████╔╝ ██╔██╗ ██║██║     ║     │
│   ║    ╚════██║╚════██║██╔══╝      ╚════██║  ╚██╔╝  ██║╚██╗██║██║     ║     │
│   ║    ███████║███████║███████╗    ███████║   ██║   ██║ ╚████║╚██████╗║     │
│   ║    ╚══════╝╚══════╝╚══════╝    ╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝║     │
│   ║                                                                   ║     │
│   ╚═══════════════════════════════════════════════════════════════════╝     │
│                                                                             │
│   The definitive guide to real-time sync with OpenCode's SSE stream         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [The SSE Stream](#the-sse-stream)
3. [Event Types Reference](#event-types-reference)
4. [React Implementation](#react-implementation)
5. [Binary Search for Performance](#binary-search-for-performance)
6. [Directory Scoping](#directory-scoping)
7. [State Management Patterns](#state-management-patterns)
8. [Edge Cases & Gotchas](#edge-cases--gotchas)
9. [Complete Working Example](#complete-working-example)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode Server                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Instance Bus                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │   │
│  │  │ Session  │  │ Message  │  │   Part   │  │   Todo   │            │   │
│  │  │  Events  │  │  Events  │  │  Events  │  │  Events  │            │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │   │
│  │       │             │             │             │                   │   │
│  │       └─────────────┴─────────────┴─────────────┘                   │   │
│  │                           │                                         │   │
│  │                           ▼                                         │   │
│  │                    ┌──────────────┐                                 │   │
│  │                    │  GlobalBus   │  (Node EventEmitter)            │   │
│  │                    └──────┬───────┘                                 │   │
│  └───────────────────────────┼─────────────────────────────────────────┘   │
│                              │                                             │
│                              ▼                                             │
│                    ┌──────────────────┐                                    │
│                    │  GET /global/event │  (SSE Endpoint)                  │
│                    └──────────┬───────┘                                    │
└───────────────────────────────┼─────────────────────────────────────────────┘
                                │
                    ════════════╪════════════  HTTP/SSE
                                │
┌───────────────────────────────┼─────────────────────────────────────────────┐
│                               ▼                           React Client      │
│                    ┌──────────────────┐                                    │
│                    │   SSE Client     │  (EventSource / fetch)             │
│                    └──────────┬───────┘                                    │
│                               │                                             │
│                               ▼                                             │
│                    ┌──────────────────┐                                    │
│                    │  Event Router    │  (by directory)                    │
│                    └──────────┬───────┘                                    │
│                               │                                             │
│           ┌───────────────────┼───────────────────┐                        │
│           ▼                   ▼                   ▼                        │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │  /project-a     │ │  /project-b     │ │    global       │              │
│  │     Store       │ │     Store       │ │     Store       │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Insight:** There is ONE SSE stream for ALL directories. Events are tagged with a `directory` field, and the client routes them to the appropriate store.

---

## The SSE Stream

### Endpoint

```
GET /global/event
```

**No headers required** for the SSE connection itself. The directory header is only needed for REST API calls.

### Event Format

Every SSE message is JSON with this structure:

```typescript
interface GlobalEvent {
  directory: string; // Absolute path OR "global"
  payload: Event; // The actual event data
}

interface Event {
  type: string; // Event type discriminator
  properties: object; // Event-specific data
}
```

### Server Implementation (for reference)

From `packages/opencode/src/server/server.ts:220-284`:

```typescript
.get("/global/event", async (c) => {
  return streamSSE(c, async (stream) => {
    // 1. Send initial connection event
    stream.writeSSE({
      data: JSON.stringify({
        payload: {
          type: "server.connected",
          properties: {},
        },
      }),
    })

    // 2. Subscribe to global bus
    async function handler(event: any) {
      await stream.writeSSE({
        data: JSON.stringify(event),
      })
    }
    GlobalBus.on("event", handler)

    // 3. Heartbeat every 30s (CRITICAL for mobile browsers)
    const heartbeat = setInterval(() => {
      stream.writeSSE({
        data: JSON.stringify({
          payload: {
            type: "server.heartbeat",
            properties: {},
          },
        }),
      })
    }, 30000)

    // 4. Cleanup on disconnect
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat)
        GlobalBus.off("event", handler)
        resolve()
      })
    })
  })
})
```

---

## Event Types Reference

### Session Events

| Event Type        | Properties                             | When Fired                                       |
| ----------------- | -------------------------------------- | ------------------------------------------------ |
| `session.created` | `{ info: Session }`                    | New session created                              |
| `session.updated` | `{ info: Session }`                    | Session metadata changed (title, archived, etc.) |
| `session.deleted` | `{ info: Session }`                    | Session deleted                                  |
| `session.diff`    | `{ sessionID, diff: FileDiff[] }`      | File changes in session                          |
| `session.status`  | `{ sessionID, status: SessionStatus }` | Session busy/idle/retry state                    |
| `session.error`   | `{ sessionID?, error }`                | Error occurred                                   |

### Message Events

| Event Type             | Properties                         | When Fired                       |
| ---------------------- | ---------------------------------- | -------------------------------- |
| `message.updated`      | `{ info: Message }`                | Message created or updated       |
| `message.removed`      | `{ sessionID, messageID }`         | Message deleted                  |
| `message.part.updated` | `{ part: Part, delta?: string }`   | Part created/updated (streaming) |
| `message.part.removed` | `{ sessionID, messageID, partID }` | Part deleted                     |

### Other Events

| Event Type           | Properties                              | When Fired                     |
| -------------------- | --------------------------------------- | ------------------------------ |
| `todo.updated`       | `{ sessionID, todos: Todo[] }`          | Todo list changed              |
| `project.updated`    | `Project`                               | Project metadata changed       |
| `global.disposed`    | `{}`                                    | Server shutting down           |
| `server.connected`   | `{}`                                    | Initial connection established |
| `server.heartbeat`   | `{}`                                    | Keep-alive (every 30s)         |
| `permission.updated` | `Permission`                            | Permission request pending     |
| `permission.replied` | `{ sessionID, permissionID, response }` | Permission answered            |

### TypeScript Types

```typescript
// From @opencode-ai/sdk/v2/client

type Session = {
  id: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  version: string;
  time: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;  // If set, session is archived
  };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs?: FileDiff[];
  };
  share?: { url: string };
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string };
};

type Message = UserMessage | AssistantMessage;

type UserMessage = {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
  system?: string;
  tools?: Record<string, boolean>;
};

type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  parentID: string;
  modelID: string;
  providerID: string;
  agent: string;
  time: { created: number; completed?: number };
  error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | ApiError;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  finish?: string;
};

type Part = TextPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | ...;

type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start: number; end?: number };
};

type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;
};

type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };
```

---

## React Implementation

### Step 1: SSE Hook

```typescript
// hooks/useSSE.ts
import { useEffect, useRef, useCallback } from "react";

interface SSEOptions {
  url: string;
  onEvent: (event: GlobalEvent) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  retryDelay?: number;
  maxRetries?: number;
}

interface GlobalEvent {
  directory: string;
  payload: {
    type: string;
    properties: Record<string, unknown>;
  };
}

export function useSSE({
  url,
  onEvent,
  onError,
  onConnect,
  retryDelay = 3000,
  maxRetries = 10,
}: SSEOptions) {
  const retryCount = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  const connect = useCallback(async () => {
    // Abort any existing connection
    abortController.current?.abort();
    abortController.current = new AbortController();

    try {
      const response = await fetch(`${url}/global/event`, {
        signal: abortController.current.signal,
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });

      if (!response.ok) {
        throw new Error(
          `SSE failed: ${response.status} ${response.statusText}`,
        );
      }

      if (!response.body) {
        throw new Error("No body in SSE response");
      }

      // Reset retry count on successful connection
      retryCount.current = 0;
      onConnect?.();

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += value;
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("data:")) {
              dataLines.push(line.replace(/^data:\s*/, ""));
            }
          }

          if (dataLines.length) {
            try {
              const data = JSON.parse(dataLines.join("\n")) as GlobalEvent;
              onEvent(data);
            } catch (e) {
              console.error("Failed to parse SSE event:", e);
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;

      onError?.(error as Error);

      // Retry with exponential backoff
      if (retryCount.current < maxRetries) {
        const backoff = Math.min(retryDelay * 2 ** retryCount.current, 30000);
        retryCount.current++;
        setTimeout(connect, backoff);
      }
    }
  }, [url, onEvent, onError, onConnect, retryDelay, maxRetries]);

  useEffect(() => {
    connect();
    return () => {
      abortController.current?.abort();
    };
  }, [connect]);

  return {
    reconnect: connect,
  };
}
```

### Step 2: Binary Search Utility

**CRITICAL:** OpenCode sorts arrays by ID (lexicographic). You MUST use binary search for O(log n) updates.

```typescript
// utils/binary.ts
export namespace Binary {
  export function search<T>(
    array: T[],
    id: string,
    compare: (item: T) => string,
  ): { found: boolean; index: number } {
    let left = 0;
    let right = array.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midId = compare(array[mid]);

      if (midId === id) {
        return { found: true, index: mid };
      } else if (midId < id) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return { found: false, index: left };
  }

  export function insert<T>(
    array: T[],
    item: T,
    compare: (item: T) => string,
  ): T[] {
    const id = compare(item);
    let left = 0;
    let right = array.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const midId = compare(array[mid]);

      if (midId < id) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    const result = [...array];
    result.splice(left, 0, item);
    return result;
  }
}
```

### Step 3: Store with Immer

```typescript
// stores/opencode-store.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Binary } from "../utils/binary";
import type {
  Session,
  Message,
  Part,
  SessionStatus,
  Todo,
  FileDiff,
} from "@opencode-ai/sdk/v2/client";

interface DirectoryState {
  ready: boolean;
  sessions: Session[];
  sessionStatus: Record<string, SessionStatus>;
  sessionDiff: Record<string, FileDiff[]>;
  todos: Record<string, Todo[]>;
  messages: Record<string, Message[]>;
  parts: Record<string, Part[]>;
}

interface OpenCodeStore {
  directories: Record<string, DirectoryState>;

  // Actions
  initDirectory: (directory: string) => void;
  handleEvent: (
    directory: string,
    event: { type: string; properties: any },
  ) => void;

  // Session actions
  setSessionReady: (directory: string, ready: boolean) => void;
  setSessions: (directory: string, sessions: Session[]) => void;
  setMessages: (
    directory: string,
    sessionID: string,
    messages: Message[],
  ) => void;
  setParts: (directory: string, messageID: string, parts: Part[]) => void;
}

const createEmptyDirectoryState = (): DirectoryState => ({
  ready: false,
  sessions: [],
  sessionStatus: {},
  sessionDiff: {},
  todos: {},
  messages: {},
  parts: {},
});

export const useOpenCodeStore = create<OpenCodeStore>()(
  immer((set, get) => ({
    directories: {},

    initDirectory: (directory) => {
      set((state) => {
        if (!state.directories[directory]) {
          state.directories[directory] = createEmptyDirectoryState();
        }
      });
    },

    handleEvent: (directory, event) => {
      set((state) => {
        // Ensure directory exists
        if (!state.directories[directory]) {
          state.directories[directory] = createEmptyDirectoryState();
        }
        const dir = state.directories[directory];

        switch (event.type) {
          // ═══════════════════════════════════════════════════════════════
          // SESSION EVENTS
          // ═══════════════════════════════════════════════════════════════
          case "session.updated": {
            const session = event.properties.info as Session;
            const result = Binary.search(dir.sessions, session.id, (s) => s.id);

            // Handle archived sessions (remove them)
            if (session.time.archived) {
              if (result.found) {
                dir.sessions.splice(result.index, 1);
              }
              break;
            }

            // Update or insert
            if (result.found) {
              dir.sessions[result.index] = session;
            } else {
              dir.sessions.splice(result.index, 0, session);
            }
            break;
          }

          case "session.status": {
            dir.sessionStatus[event.properties.sessionID] =
              event.properties.status;
            break;
          }

          case "session.diff": {
            dir.sessionDiff[event.properties.sessionID] = event.properties.diff;
            break;
          }

          // ═══════════════════════════════════════════════════════════════
          // MESSAGE EVENTS
          // ═══════════════════════════════════════════════════════════════
          case "message.updated": {
            const message = event.properties.info as Message;
            const sessionID = message.sessionID;

            // Initialize messages array if needed
            if (!dir.messages[sessionID]) {
              dir.messages[sessionID] = [];
            }

            const messages = dir.messages[sessionID];
            const result = Binary.search(messages, message.id, (m) => m.id);

            if (result.found) {
              messages[result.index] = message;
            } else {
              messages.splice(result.index, 0, message);
            }
            break;
          }

          case "message.removed": {
            const { sessionID, messageID } = event.properties;
            const messages = dir.messages[sessionID];
            if (!messages) break;

            const result = Binary.search(messages, messageID, (m) => m.id);
            if (result.found) {
              messages.splice(result.index, 1);
            }
            break;
          }

          // ═══════════════════════════════════════════════════════════════
          // PART EVENTS (streaming content)
          // ═══════════════════════════════════════════════════════════════
          case "message.part.updated": {
            const part = event.properties.part as Part;
            const messageID = part.messageID;

            // Initialize parts array if needed
            if (!dir.parts[messageID]) {
              dir.parts[messageID] = [];
            }

            const parts = dir.parts[messageID];
            const result = Binary.search(parts, part.id, (p) => p.id);

            if (result.found) {
              parts[result.index] = part;
            } else {
              parts.splice(result.index, 0, part);
            }
            break;
          }

          case "message.part.removed": {
            const { messageID, partID } = event.properties;
            const parts = dir.parts[messageID];
            if (!parts) break;

            const result = Binary.search(parts, partID, (p) => p.id);
            if (result.found) {
              parts.splice(result.index, 1);
            }
            break;
          }

          // ═══════════════════════════════════════════════════════════════
          // TODO EVENTS
          // ═══════════════════════════════════════════════════════════════
          case "todo.updated": {
            dir.todos[event.properties.sessionID] = event.properties.todos;
            break;
          }
        }
      });
    },

    setSessionReady: (directory, ready) => {
      set((state) => {
        if (state.directories[directory]) {
          state.directories[directory].ready = ready;
        }
      });
    },

    setSessions: (directory, sessions) => {
      set((state) => {
        if (state.directories[directory]) {
          // Sort by ID for binary search
          state.directories[directory].sessions = sessions.sort((a, b) =>
            a.id.localeCompare(b.id),
          );
        }
      });
    },

    setMessages: (directory, sessionID, messages) => {
      set((state) => {
        if (state.directories[directory]) {
          // Sort by ID for binary search
          state.directories[directory].messages[sessionID] = messages.sort(
            (a, b) => a.id.localeCompare(b.id),
          );
        }
      });
    },

    setParts: (directory, messageID, parts) => {
      set((state) => {
        if (state.directories[directory]) {
          // Sort by ID for binary search
          state.directories[directory].parts[messageID] = parts.sort((a, b) =>
            a.id.localeCompare(b.id),
          );
        }
      });
    },
  })),
);
```

### Step 4: SDK Client Factory

```typescript
// lib/opencode-client.ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

export function createClient(baseUrl: string, directory?: string) {
  return createOpencodeClient({
    baseUrl,
    directory, // Sets x-opencode-directory header automatically
    throwOnError: true,
  });
}

// For SSE (no timeout)
export function createEventClient(baseUrl: string) {
  return createOpencodeClient({
    baseUrl,
    // No timeout for SSE - it's a long-lived connection
  });
}
```

### Step 5: Provider Component

```typescript
// providers/OpenCodeProvider.tsx
'use client';

import { createContext, useContext, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useSSE } from '../hooks/useSSE';
import { useOpenCodeStore } from '../stores/opencode-store';
import { createClient } from '../lib/opencode-client';

interface OpenCodeContextValue {
  url: string;
  directory: string;
  ready: boolean;
  sync: (sessionID: string) => Promise<void>;
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null);

interface OpenCodeProviderProps {
  url: string;
  directory: string;
  children: ReactNode;
}

export function OpenCodeProvider({ url, directory, children }: OpenCodeProviderProps) {
  const store = useOpenCodeStore();
  const clientRef = useRef(createClient(url, directory));

  // Initialize directory state
  useEffect(() => {
    store.initDirectory(directory);
  }, [directory, store]);

  // Handle SSE events
  const handleEvent = useCallback((event: { directory: string; payload: any }) => {
    const eventDirectory = event.directory;

    // Route global events
    if (eventDirectory === 'global') {
      switch (event.payload?.type) {
        case 'global.disposed':
          // Server restarted - re-bootstrap
          bootstrap();
          break;
        case 'project.updated':
          // Handle project updates if needed
          break;
      }
      return;
    }

    // Route to correct directory
    // CRITICAL: Only process events for OUR directory
    if (eventDirectory === directory) {
      store.handleEvent(directory, event.payload);
    }
  }, [directory, store]);

  // Bootstrap: Load initial data
  const bootstrap = useCallback(async () => {
    const client = clientRef.current;

    try {
      // Load sessions (filtered and sorted)
      const sessionsResponse = await client.session.list();
      const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;

      const sessions = (sessionsResponse.data ?? [])
        .filter((s) => !s.time.archived)
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((s, i) => {
          // Include first N sessions + any updated recently
          if (i < 20) return true;
          return s.time.updated > fourHoursAgo;
        });

      store.setSessions(directory, sessions);

      // Load session statuses
      const statusResponse = await client.session.status();
      if (statusResponse.data) {
        for (const [sessionID, status] of Object.entries(statusResponse.data)) {
          store.handleEvent(directory, {
            type: 'session.status',
            properties: { sessionID, status },
          });
        }
      }

      store.setSessionReady(directory, true);
    } catch (error) {
      console.error('Bootstrap failed:', error);
    }
  }, [directory, store]);

  // Sync a specific session (messages + parts)
  const sync = useCallback(async (sessionID: string) => {
    const client = clientRef.current;

    try {
      const [messagesResponse, todoResponse, diffResponse] = await Promise.all([
        client.session.messages({ sessionID, limit: 100 }),
        client.session.todo({ sessionID }),
        client.session.diff({ sessionID }),
      ]);

      // Set messages (sorted by ID)
      if (messagesResponse.data) {
        const messages = messagesResponse.data.map((m) => m.info);
        store.setMessages(directory, sessionID, messages);

        // Set parts for each message
        for (const msg of messagesResponse.data) {
          store.setParts(directory, msg.info.id, msg.parts);
        }
      }

      // Set todos
      if (todoResponse.data) {
        store.handleEvent(directory, {
          type: 'todo.updated',
          properties: { sessionID, todos: todoResponse.data },
        });
      }

      // Set diffs
      if (diffResponse.data) {
        store.handleEvent(directory, {
          type: 'session.diff',
          properties: { sessionID, diff: diffResponse.data },
        });
      }
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }, [directory, store]);

  // Connect SSE
  useSSE({
    url,
    onEvent: handleEvent,
    onConnect: bootstrap,
    onError: (error) => console.error('SSE error:', error),
  });

  // Get ready state
  const dirState = store.directories[directory];
  const ready = dirState?.ready ?? false;

  return (
    <OpenCodeContext.Provider value={{ url, directory, ready, sync }}>
      {children}
    </OpenCodeContext.Provider>
  );
}

export function useOpenCode() {
  const context = useContext(OpenCodeContext);
  if (!context) {
    throw new Error('useOpenCode must be used within OpenCodeProvider');
  }
  return context;
}
```

### Step 6: Hooks for Components

```typescript
// hooks/useSession.ts
import { useOpenCodeStore } from "../stores/opencode-store";
import { useOpenCode } from "../providers/OpenCodeProvider";
import { useEffect } from "react";

export function useSessions() {
  const { directory, ready } = useOpenCode();
  const sessions = useOpenCodeStore(
    (state) => state.directories[directory]?.sessions ?? [],
  );

  return { sessions, ready };
}

export function useSession(sessionID: string) {
  const { directory, sync } = useOpenCode();
  const session = useOpenCodeStore((state) => {
    const sessions = state.directories[directory]?.sessions ?? [];
    return sessions.find((s) => s.id === sessionID);
  });
  const status = useOpenCodeStore(
    (state) => state.directories[directory]?.sessionStatus[sessionID],
  );

  // Sync on mount
  useEffect(() => {
    sync(sessionID);
  }, [sessionID, sync]);

  return { session, status };
}

export function useMessages(sessionID: string) {
  const { directory } = useOpenCode();
  return useOpenCodeStore(
    (state) => state.directories[directory]?.messages[sessionID] ?? [],
  );
}

export function useParts(messageID: string) {
  const { directory } = useOpenCode();
  return useOpenCodeStore(
    (state) => state.directories[directory]?.parts[messageID] ?? [],
  );
}

export function useSessionStatus(sessionID: string) {
  const { directory } = useOpenCode();
  return useOpenCodeStore(
    (state) => state.directories[directory]?.sessionStatus[sessionID],
  );
}
```

---

## Directory Scoping

### The Critical Rule

**Every REST API call MUST include the directory.** The SDK handles this automatically when you pass `directory` to `createOpencodeClient`:

```typescript
// This sets x-opencode-directory header on ALL requests
const client = createOpencodeClient({
  baseUrl: "http://localhost:3000",
  directory: "/Users/joel/Code/myproject", // EXACT path, no trailing slash
});
```

### What Happens Without Directory

1. Server defaults to `process.cwd()` (where server was started)
2. Events won't match your client's directory
3. Sessions from wrong project appear
4. **Sync completely breaks**

### Directory Matching

```typescript
// Server event
{ directory: "/Users/joel/Code/myproject", payload: { type: "session.updated", ... } }

// Client routing
if (event.directory === myDirectory) {
  // Process event
} else {
  // Ignore - not our project
}
```

**Case sensitivity matters.** `/Users/Joel/Code` ≠ `/Users/joel/Code`

---

## State Management Patterns

### Why Binary Search?

OpenCode generates IDs that are lexicographically sortable (like ULIDs). Arrays are always sorted by ID. Binary search gives O(log n) lookups instead of O(n).

```typescript
// BAD: O(n) - scans entire array
const session = sessions.find((s) => s.id === targetID);

// GOOD: O(log n) - binary search
const result = Binary.search(sessions, targetID, (s) => s.id);
if (result.found) {
  const session = sessions[result.index];
}
```

### Immutable Updates with Immer

```typescript
// With Immer (recommended)
set((state) => {
  const sessions = state.directories[directory].sessions;
  const result = Binary.search(sessions, session.id, (s) => s.id);

  if (result.found) {
    sessions[result.index] = session; // Direct mutation OK with Immer
  } else {
    sessions.splice(result.index, 0, session); // Insert at correct position
  }
});

// Without Immer (manual immutability)
set((state) => ({
  directories: {
    ...state.directories,
    [directory]: {
      ...state.directories[directory],
      sessions: result.found
        ? sessions.map((s, i) => (i === result.index ? session : s))
        : [
            ...sessions.slice(0, result.index),
            session,
            ...sessions.slice(result.index),
          ],
    },
  },
}));
```

### Reconciliation Pattern

When SSE event arrives, don't replace the entire object - merge it:

```typescript
// SolidJS uses reconcile() - for React, use shallow merge
case 'session.updated': {
  const existing = sessions[result.index];
  const updated = event.properties.info;

  // Shallow merge preserves reference equality for unchanged fields
  sessions[result.index] = { ...existing, ...updated };
  break;
}
```

---

## Edge Cases & Gotchas

### 0. Immer + Map Incompatibility (CRITICAL)

**Problem:** Using `Map<string, Message[]>` with Zustand's Immer middleware causes "Proxy has already been revoked" errors.

**Root Cause:** Immer's MapSet plugin wraps Map values in draft proxies that get revoked after the producer function completes. When `Binary.insert` or spread operators try to access array elements later, the proxy is already revoked.

```typescript
// ❌ BAD - Will cause proxy errors
type State = {
  messages: Map<string, Message[]>;
};

// ✅ GOOD - Works perfectly with Immer
type State = {
  messages: Record<string, Message[]>;
};
```

**Migration:**

- `Map.get(k)` → `record[k]`
- `Map.set(k, v)` → `record[k] = v`
- `messages.size` → `Object.keys(messages).length`

**Rule:** Use `Record<K, V>` instead of `Map<K, V>` for ANY Zustand + Immer store with nested structures.

### 1. Race Condition: REST vs SSE

**Problem:** User sends message → SSE event arrives before REST response.

**Solution:** Use optimistic updates + reconciliation:

```typescript
// 1. Add optimistic message immediately
const optimisticMessage = {
  id: generateID(),
  sessionID,
  role: "user",
  // ...
};
store.handleEvent(directory, {
  type: "message.updated",
  properties: { info: optimisticMessage },
});

// 2. Send to server
await client.session.prompt({ sessionID, parts });

// 3. SSE event will update with real data
// Binary search finds by ID, updates in place
```

### 2. Reconnection

The SSE hook handles reconnection with exponential backoff. On reconnect:

```typescript
onConnect: () => {
  // Re-bootstrap to catch any missed events
  bootstrap();
};
```

### 3. Stale Data

**Problem:** Client loads sessions, then SSE event arrives for a session not in initial load.

**Solution:** Events create missing items:

```typescript
case 'session.updated': {
  const result = Binary.search(sessions, session.id, s => s.id);
  if (!result.found) {
    // Insert new session even if not in initial load
    sessions.splice(result.index, 0, session);
  }
}
```

### 4. Multiple Tabs

Each tab has its own SSE connection. All tabs receive same events. State converges naturally.

### 5. Heartbeat Timeout

Mobile browsers (especially WKWebView) kill idle connections. The server sends heartbeats every 30s. If you don't receive a heartbeat for 60s, reconnect.

### 6. Message Parts Streaming

Parts arrive incrementally during AI response. The `delta` field indicates streaming:

```typescript
case 'message.part.updated': {
  const { part, delta } = event.properties;

  if (delta && part.type === 'text') {
    // Streaming text - append delta to existing
    const existing = parts[result.index];
    if (existing?.type === 'text') {
      existing.text += delta;
      return;
    }
  }

  // Full update
  parts[result.index] = part;
}
```

---

## Complete Working Example

### App Structure

```
src/
├── app/
│   ├── layout.tsx
│   └── [directory]/
│       └── page.tsx
├── components/
│   ├── SessionList.tsx
│   ├── SessionView.tsx
│   └── MessageList.tsx
├── hooks/
│   ├── useSSE.ts
│   └── useSession.ts
├── stores/
│   └── opencode-store.ts
├── providers/
│   └── OpenCodeProvider.tsx
├── lib/
│   └── opencode-client.ts
└── utils/
    └── binary.ts
```

### Root Layout

```typescript
// app/layout.tsx
import { OpenCodeProvider } from '@/providers/OpenCodeProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // In real app, get these from env/config
  const url = process.env.NEXT_PUBLIC_OPENCODE_URL ?? 'http://localhost:3000';
  const directory = process.env.NEXT_PUBLIC_OPENCODE_DIRECTORY ?? process.cwd();

  return (
    <html>
      <body>
        <OpenCodeProvider url={url} directory={directory}>
          {children}
        </OpenCodeProvider>
      </body>
    </html>
  );
}
```

### Session List Component

```typescript
// components/SessionList.tsx
'use client';

import { useSessions } from '@/hooks/useSession';
import Link from 'next/link';

export function SessionList() {
  const { sessions, ready } = useSessions();

  if (!ready) {
    return <div>Loading sessions...</div>;
  }

  return (
    <ul>
      {sessions.map((session) => (
        <li key={session.id}>
          <Link href={`/session/${session.id}`}>
            {session.title || 'Untitled Session'}
          </Link>
          <span className="text-muted">
            {new Date(session.time.updated).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

### Session View Component

```typescript
// components/SessionView.tsx
'use client';

import { useSession, useMessages } from '@/hooks/useSession';
import { MessageList } from './MessageList';

interface SessionViewProps {
  sessionID: string;
}

export function SessionView({ sessionID }: SessionViewProps) {
  const { session, status } = useSession(sessionID);
  const messages = useMessages(sessionID);

  if (!session) {
    return <div>Loading session...</div>;
  }

  return (
    <div>
      <header>
        <h1>{session.title}</h1>
        {status?.type === 'busy' && <span>AI is thinking...</span>}
        {status?.type === 'retry' && (
          <span>Retrying... attempt {status.attempt}</span>
        )}
      </header>

      <MessageList messages={messages} />
    </div>
  );
}
```

### Message List Component

```typescript
// components/MessageList.tsx
'use client';

import { useParts } from '@/hooks/useSession';
import type { Message, Part } from '@opencode-ai/sdk/v2/client';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  );
}

function MessageItem({ message }: { message: Message }) {
  const parts = useParts(message.id);

  return (
    <div className={`message ${message.role}`}>
      <div className="message-header">
        <span className="role">{message.role}</span>
        {message.role === 'assistant' && (
          <span className="model">{message.modelID}</span>
        )}
      </div>

      <div className="message-content">
        {parts.map((part) => (
          <PartRenderer key={part.id} part={part} />
        ))}
      </div>

      {message.role === 'assistant' && message.tokens && (
        <div className="message-footer">
          <span>Tokens: {message.tokens.input + message.tokens.output}</span>
          <span>Cost: ${message.cost.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}

function PartRenderer({ part }: { part: Part }) {
  switch (part.type) {
    case 'text':
      return <div className="text-part">{part.text}</div>;

    case 'reasoning':
      return (
        <details className="reasoning-part">
          <summary>Reasoning</summary>
          <div>{part.text}</div>
        </details>
      );

    case 'tool':
      return (
        <div className={`tool-part status-${part.state.status}`}>
          <div className="tool-name">{part.tool}</div>
          {part.state.status === 'completed' && (
            <div className="tool-output">{part.state.output}</div>
          )}
          {part.state.status === 'error' && (
            <div className="tool-error">{part.state.error}</div>
          )}
        </div>
      );

    default:
      return null;
  }
}
```

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYNC CHECKLIST                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✓ ONE SSE connection to /global/event (no directory header needed)        │
│  ✓ Route events by directory field                                         │
│  ✓ Set x-opencode-directory header on ALL REST calls                       │
│  ✓ Use binary search for O(log n) array updates                            │
│  ✓ Sort arrays by ID after initial load                                    │
│  ✓ Handle archived sessions (remove from list)                             │
│  ✓ Sync session on navigation (messages + parts + todos + diffs)           │
│  ✓ Re-bootstrap on reconnect to catch missed events                        │
│  ✓ Handle heartbeat timeout (reconnect after 60s silence)                  │
│  ✓ Use optimistic updates + SSE reconciliation                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The most common sync issues:**

1. **Wrong directory** - Events don't match because directory doesn't match exactly
2. **Missing directory header** - REST calls go to wrong instance
3. **Linear search** - Performance degrades with many sessions/messages
4. **No reconnection** - Connection drops and client doesn't recover
5. **No initial sync** - Messages don't load until SSE event arrives
6. **Immer + Map** - Using Map with Immer causes proxy revocation errors (use Record instead)
7. **Wrong event type** - Subscribing to `message.created` when API only emits `message.updated`
8. **Wrong port** - Hardcoding wrong port (OpenCode default is 4056, not 4096)

Follow this guide and your sync will be bulletproof.

---

## Implementation Notes (Next.js 16 Rebuild)

### Architecture Decisions

The Next.js implementation uses a **context-based SSE pattern** instead of the callback-based pattern shown above:

```typescript
// SSEProvider manages connection at app level
<SSEProvider url={OPENCODE_URL}>
  {children}
</SSEProvider>

// Components subscribe to specific event types
const { subscribe } = useSSE()
useEffect(() => {
  return subscribe("message.updated", (event) => {
    // Handle event
  })
}, [subscribe])
```

**Why context-based?**

- Single SSE connection shared across all components
- No prop drilling of callbacks
- Automatic cleanup on unmount
- Matches React patterns better than callback-based hooks

### File Structure

```
apps/web/src/
├── lib/
│   └── binary.ts              # Binary.search, Binary.insert
├── react/
│   ├── store.ts               # Zustand + Immer store
│   ├── use-sse.tsx            # SSEProvider + useSSE + useSSEDirect
│   └── index.ts               # Public exports
└── app/
    └── providers.tsx          # Client providers wrapper
```

### Key Learnings from Implementation

1. **Rename .ts to .tsx** when adding JSX (SSEProvider needs JSX)
2. **Use Record not Map** for Immer compatibility
3. **Export types** from index.ts for clean imports
4. **Wrap app in Providers** component (client boundary)
5. **useSSEDirect** available for cases needing direct control without provider
