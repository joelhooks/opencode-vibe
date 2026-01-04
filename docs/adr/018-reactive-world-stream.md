# ADR 018: Reactive World Stream Architecture

**Status:** ✅ Implemented  
**Date:** 2026-01-01 (Completed: 2026-01-04)  
**Deciders:** Joel Hooks  
**Affected Components:** `@opencode-vibe/core`, `@opencode-vibe/react`, Web App, TUI, CLI  
**Related ADRs:** ADR-017 (Session Management in Core Layer), ADR-016 (Core Layer Responsibility), ADR-015 (Event Architecture Simplification)

> **Implementation Note (2026-01-04)**: World Stream is now THE source of truth for reactive state.
> React hooks (`useWorld()`, `useWorldSession()`, `useWorldSessionList()`) delegate to World Stream.
> Zustand SSE handlers disabled for core data (sessions, messages, parts). Zustand preserved only for UI-local state (ready flags, todos, model limits).

---

```
    ╔══════════════════════════════════════════════════════════════════╗
    ║   🌊 THE WORLD FLOWS TO YOU, YOU DON'T FETCH THE WORLD 🌊       ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║   BEFORE: Pull-based subscriptions                               ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  CONSUMER                                               │    ║
    ║   │  ├── subscribe(sessions)     ─┐                         │    ║
    ║   │  ├── subscribe(messages)      ├── piece together state  │    ║
    ║   │  ├── subscribe(parts)         │   in every consumer     │    ║
    ║   │  ├── subscribe(status)       ─┘                         │    ║
    ║   │  └── derive: are they consistent? 🤷                    │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   AFTER: Push-based world stream                                 ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  CORE                                                   │    ║
    ║   │  └── worldStream ──▶ { sessions + messages + parts +    │    ║
    ║   │                        status + derived fields }        │    ║
    ║   │                       ALWAYS CONSISTENT ✓               │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                    │                                             ║
    ║                    ▼                                             ║
    ║   ┌──────────┐ ┌──────────┐ ┌──────────┐                         ║
    ║   │  React   │ │   TUI    │ │   CLI    │                         ║
    ║   │ useState │ │ for await│ │ snapshot │                         ║
    ║   └──────────┘ └──────────┘ └──────────┘                         ║
    ║                                                                  ║
    ║   Core derives. Consumers receive. Zero coordination burden.     ║
    ╚══════════════════════════════════════════════════════════════════╝
```

---

## Executive Summary

This ADR proposes two foundational principles for the opencode-next architecture:

1. **Push-based reactive world stream** - Core derives ALL state and emits complete, consistent world snapshots. Consumers just subscribe.

2. **Progressive Discovery for Agents** - Tools teach agents what's possible at each step. No front-loaded system prompts. Discoverable capabilities at every interaction.

**Key insight:** The complexity in our current architecture isn't in the reducers—it's in the coordination. Every consumer must subscribe to sessions, messages, parts, AND status, then ensure they're looking at consistent views. ADR-017's pure reducers are correct, but they don't solve the coordination problem.

**The parallel insight:** Agents face the same problem with tools. They're given a 500-line system prompt, expected to internalize it, and then navigate without guidance. That's pull-based learning. We want push-based discovery.

**The shift:** Move from "consumers assemble state" to "core emits world". Move from "agents read documentation" to "tools teach agents".

---

## The Progressive Discovery Principle

```
    ╔══════════════════════════════════════════════════════════════════╗
    ║     🧭 PROGRESSIVE DISCOVERY FOR AGENTS 🧭                       ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║   ANTI-PATTERN: Front-loaded system prompts                      ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  500-LINE SYSTEM PROMPT                                 │    ║
    ║   │  ├── Read all this first                                │    ║
    ║   │  ├── Memorize these commands                            │    ║
    ║   │  ├── Learn these edge cases                             │    ║
    ║   │  └── Good luck! 👋                                      │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   PATTERN: Tools that teach                                      ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  STEP 1: Agent runs tool                                │    ║
    ║   │          └── Tool output includes "what you can do next"│    ║
    ║   │                                                         │    ║
    ║   │  STEP 2: Agent picks next action                        │    ║
    ║   │          └── Tool output includes relevant context      │    ║
    ║   │                                                         │    ║
    ║   │  STEP 3: Something fails                                │    ║
    ║   │          └── Error shows how to recover                 │    ║
    ║   │                                                         │    ║
    ║   │  STEP N: Agent needs advanced feature                   │    ║
    ║   │          └── Tool reveals it at the right moment        │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   Like HATEOAS for APIs: affordances delivered via responses.    ║
    ╚══════════════════════════════════════════════════════════════════╝
```

### Why Agents Need Discoverable Interfaces

Roy Fielding's REST dissertation introduced HATEOAS: **H**ypermedia **A**s **T**he **E**ngine **O**f **A**pplication **S**tate. The idea is simple—API responses include links to available actions. Clients don't need to memorize an API spec; they follow the affordances in each response.

> "All affordances for an API are delivered by means of hypermedia."  
> — Roy Fielding

This principle is even more critical for AI agents. Why?

1. **Agents have limited context windows** - A 500-line system prompt eats valuable context that could be used for the actual task.

2. **Agents forget over long sessions** - Instructions at the top of a conversation are weighted less as the conversation grows.

3. **Static prompts can't adapt** - A tool in error state needs different guidance than a tool in success state. Pre-written prompts can't know the current state.

4. **Agents learn by doing** - Few-shot examples embedded in tool output are more effective than abstract instructions.

### The Anti-Pattern: 500-Line System Prompts

```
SYSTEM: You are an AI assistant using the FooBar CLI.

Available commands:
  foo create <name> --type <type> [--options...]
  foo list [--filter <filter>] [--sort <field>]
  foo update <id> --field <value> [--field <value>...]
  foo delete <id> [--force]
  foo sync [--direction <in|out>] [--dry-run]
  ...
  (200 more lines of command documentation)
  
Edge cases:
  - If foo sync fails with error X, try Y
  - If foo create returns code 3, the name is taken
  - Always run foo list before foo delete
  ...
  (150 more lines of edge cases)

Best practices:
  ...
  (100 more lines)
```

Problems:
- Agent must parse and remember all this before doing anything
- Context used for docs can't be used for reasoning
- No guarantee agent reads it carefully (or at all)
- Can't adapt to current state

### The Pattern: Tools That Teach

```bash
$ world-viz --help

╔═══════════════════════════════════════╗
║     🌍 WORLD STREAM VISUALIZER 🌍     ║
╚═══════════════════════════════════════╝

Visualize live OpenCode session data via SSE streaming.

Usage:
  world-viz                    # Auto-discover servers or use mock
  world-viz --json             # JSON output mode
  world-viz --url <url>        # Connect to specific server

Quickstart:
  # First time? Try mock mode (no server needed):
  $ world-viz
  
  # With real backend:
  $ cd ~/project && opencode   # Terminal 1
  $ world-viz                  # Terminal 2

See also:
  world-viz --explain          # How this works
  world-viz --api-docs         # Backend API reference
```

Key elements:
- **Obvious entrypoint** - Just run `world-viz`
- **Progressive complexity** - Basic usage first, options revealed as needed
- **Quickstart section** - Few-shot examples showing actual usage
- **Contextual "See also"** - Points to next steps without overwhelming

### Incremental Disclosure in Practice

> "Incremental Disclosure: Revealing information and features progressively to users rather than presenting all options at once, reducing cognitive overload."  
> — UX Design Principles

The world-viz CLI demonstrates this:

**Level 1: Just run it**
```bash
$ world-viz
🔍 Discovering OpenCode servers...
✓ Found server:
    localhost:3000 → /Users/joel/project
```

**Level 2: Failure teaches recovery**
```bash
$ world-viz
🔍 Discovering OpenCode servers...
✗ No servers found

Starting mock mode...

TO CONNECT TO REAL SERVER:
  1. Start OpenCode:  cd ~/project && opencode
  2. Then run:        world-viz
```

**Level 3: Multiple servers reveals selection**
```bash
$ world-viz
🔍 Discovering OpenCode servers...
✓ Found 3 servers:
    → localhost:3000 → /Users/joel/project-a
      localhost:3001 → /Users/joel/project-b
      localhost:3002 → /Users/joel/project-c

Connecting to localhost:3000...

TIP: Use --url to connect to a specific server
```

**Level 4: Errors include recovery steps**
```bash
❌ Connection error: ECONNREFUSED

Troubleshooting:
  • Is the OpenCode backend running?
  • Is it accessible at http://localhost:3000?
  • Try: curl -v http://localhost:3000/session/list
```

Each level reveals only what's needed. The agent (or human) learns the tool by using it.

---

## Context

### ADR-017's Approach (Pure Reducers)

ADR-017 recommended extracting pure reducers to core:

```typescript
// Core: pure functions
directoryReducer(state, event) => state

// React: thin Zustand adapter  
handleSSEEvent(event) => set(state => directoryReducer(state, event))

// TUI: direct usage
sse.onEvent(e => state = directoryReducer(state, e))
```

This is **good** - it centralizes logic. But it's still **pull-based**. Every consumer must:

1. Subscribe to the SSE stream
2. Maintain their own state container
3. Apply the reducer on each event
4. Derive composite views (sessions with status, messages with parts)
5. Handle the timing of when derivations are valid

### Problems with Pull-Based

**Problem 1: Subscription Coordination**

```typescript
// React consumer today
const sessions = useOpencodeStore(s => s.sessions)
const status = useOpencodeStore(s => s.sessionStatus)
const messages = useOpencodeStore(s => s.messages)

// These are THREE separate subscriptions
// Session might update before status
// Status might update before messages
// Consumer sees inconsistent intermediate states
```

**Problem 2: Stale Closures**

```typescript
useEffect(() => {
  // Captured `sessions` is stale after next update
  sessions.forEach(s => {
    // Bug: status[s.id] might be from different point in time
    if (status[s.id] === "running") { ... }
  })
}, [sessions, status]) // Dependencies don't guarantee consistency
```

**Problem 3: Duplicated Derivation**

Every consumer that needs "sessions with their messages and status" must:

```typescript
// Same logic duplicated everywhere
const enrichedSessions = useMemo(() => 
  sessions.map(session => ({
    ...session,
    status: sessionStatus[session.id] ?? "completed",
    messages: messages[session.id]?.map(msg => ({
      ...msg,
      parts: parts[msg.id] ?? []
    })) ?? [],
    isActive: sessionStatus[session.id] === "running",
  }))
, [sessions, sessionStatus, messages, parts])
```

**Problem 4: Non-React Consumers**

TUI and CLI can't use `useMemo`. They must implement their own memoization, caching, and consistency guarantees.

### The Discovery Problem (Parallel to State)

The same pull-based vs push-based tension exists for agent tooling:

| State Management | Agent Tooling |
|------------------|---------------|
| Consumers pull from multiple subscriptions | Agents pull from system prompts |
| Consumers derive consistency themselves | Agents derive usage patterns themselves |
| Core should push complete world | Tools should push relevant guidance |
| Automatic consistency guarantee | Contextual, adaptive help |

---

## The Vision: World Stream

Instead of consumers pulling from multiple sources, **Core pushes complete world snapshots**:

```typescript
// Core derives EVERYTHING
const worldAtom = Atom.make(
  Effect.gen(function* (get: Atom.Context) {
    const sessions = yield* get.result(sessionsAtom)
    const messages = yield* get.result(messagesAtom)
    const parts = yield* get.result(partsAtom)
    const statuses = yield* get.result(statusesAtom)
    
    // Derive complete, consistent view
    return {
      sessions: sessions.map(session => ({
        ...session,
        status: statuses[session.id] ?? "completed",
        isActive: statuses[session.id] === "running",
        messages: messages[session.id]?.map(msg => ({
          ...msg,
          parts: parts[msg.id] ?? []
        })) ?? [],
        unreadCount: messages[session.id]?.filter(m => !m.read).length ?? 0,
      })),
      activeSessionCount: sessions.filter(s => 
        statuses[s.id] === "running"
      ).length,
      lastUpdated: Date.now(),
    }
  })
)
```

**Key guarantees:**

1. **Atomic updates** - World snapshot is consistent at any point in time
2. **Single derivation** - Logic lives in Core, runs once per update
3. **Framework agnostic** - Same stream feeds React, TUI, CLI
4. **Effect-powered** - Full async, error handling, resource management

---

## Technology: effect-atom

[effect-atom](https://github.com/tim-smart/effect-atom) is the right tool because:

### 1. Reactive State with Effect Integration

```typescript
import { Atom, Result } from "@effect-atom/atom"
import { Effect, Stream } from "effect"

// Base atoms from SSE events
const sessionsAtom = Atom.make(Effect.succeed([] as Session[]))
const statusAtom = Atom.make(Effect.succeed({} as Record<string, SessionStatus>))

// Derived atoms - automatic dependency tracking
const activeSessionsAtom = Atom.make(
  Effect.fnUntraced(function* (get: Atom.Context) {
    const sessions = yield* get.result(sessionsAtom)
    const status = yield* get.result(statusAtom)
    return sessions.filter(s => status[s.id] === "running")
  })
)
```

### 2. Stream Integration

```typescript
// SSE events as a Stream feed into atoms
const sseStream = Stream.fromEventSource(url)

const worldAtom = Atom.make(
  sseStream.pipe(
    Stream.scan(initialState, applyEvent),
    Stream.map(deriveWorld)
  )
)
```

### 3. Service Layer Integration

```typescript
// Create runtime with our services
const runtimeAtom = Atom.runtime(
  Layer.mergeAll(
    SSEService.Default,
    ConfigService.Default
  )
)

// Atoms that use services
const worldAtom = runtimeAtom.atom(
  Effect.gen(function* () {
    const sse = yield* SSEService
    return yield* sse.connect().pipe(
      Stream.scan(initialState, applyEvent),
      Stream.map(deriveWorld)
    )
  })
)
```

### 4. Resource Management

```typescript
const worldAtom = Atom.make(
  Effect.gen(function* () {
    // Cleanup runs when atom is no longer used
    yield* Effect.addFinalizer(() => 
      Effect.log("Closing SSE connection")
    )
    
    const connection = yield* SSEService.connect()
    return yield* connection.events
  })
)
```

### Why Not Redux/Zustand/Jotai?

| Feature | Zustand | Jotai | effect-atom |
|---------|---------|-------|-------------|
| Async derivation | Manual | Limited | Native Effect |
| Resource cleanup | Manual | Manual | Automatic (Scope) |
| Stream processing | Manual | Manual | Native Stream |
| Service DI | None | None | Native Layer |
| Backpressure | None | None | Native Stream |
| Error handling | Try/catch | Try/catch | Typed Effect errors |

We already use Effect throughout the codebase. effect-atom is the Effect-native answer.

---

## Decision

**Adopt effect-atom for reactive world stream in Core. Expose simple consumer APIs that don't require Effect knowledge. Design all CLI tools with progressive discovery for agents.**

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  CONSUMER APIs (No Effect Required)                                 │
│  ├── subscribe(callback) → unsubscribe                              │
│  ├── getSnapshot() → Promise<WorldState>                            │
│  ├── [Symbol.asyncIterator] → for await...of                        │
│  └── React: useWorld(), useSession(id), useMessages(sessionId)      │
├─────────────────────────────────────────────────────────────────────┤
│  EFFECT LAYER (For Power Users)                                     │
│  ├── WorldStream.stream → Effect.Stream<WorldState>                 │
│  ├── WorldStream.sessionsForDirectory(dir) → Stream<Session[]>      │
│  ├── WorldStream.activeSession(dir) → Stream<Session | null>        │
│  └── Full Effect composition, Services, Layers                      │
├─────────────────────────────────────────────────────────────────────┤
│  EFFECT-ATOM LAYER (Internal)                                       │
│  ├── sessionsAtom: Atom<Result<Session[]>>                          │
│  ├── messagesAtom: Atom<Result<Record<string, Message[]>>>          │
│  ├── partsAtom: Atom<Result<Record<string, Part[]>>>                │
│  ├── statusAtom: Atom<Result<Record<string, SessionStatus>>>        │
│  └── worldAtom: Atom<Result<WorldState>> (derived)                  │
├─────────────────────────────────────────────────────────────────────┤
│  SSE LAYER (Input)                                                  │
│  ├── MultiServerSSE → Effect.Stream<GlobalEvent>                    │
│  └── Events update base atoms                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### WorldState Type

```typescript
// packages/core/src/state/world.ts

export interface EnrichedSession extends Session {
  /** Computed status from SSE events */
  status: SessionStatus
  /** True if status === "running" */
  isActive: boolean
  /** Messages with their parts embedded */
  messages: EnrichedMessage[]
  /** Number of unread messages */
  unreadCount: number
  /** Context usage percentage */
  contextUsagePercent: number
  /** Last activity timestamp (for sorting) */
  lastActivityAt: number
}

export interface EnrichedMessage extends Message {
  /** Parts belonging to this message */
  parts: Part[]
  /** True if any part is still streaming */
  isStreaming: boolean
}

export interface WorldState {
  /** All sessions enriched with computed fields */
  sessions: EnrichedSession[]
  /** Count of currently active sessions */
  activeSessionCount: number
  /** Most recently active session */
  activeSession: EnrichedSession | null
  /** SSE connection status */
  connectionStatus: "connecting" | "connected" | "disconnected" | "error"
  /** Last update timestamp */
  lastUpdated: number
}
```

---

## Consumer API Design

### Discovery-Aware CLI Pattern

Every CLI tool should follow the progressive discovery pattern. Here's the template from world-viz:

```typescript
// Help text with progressive disclosure
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
╔═══════════════════════════════════════╗
║     🌍 WORLD STREAM VISUALIZER 🌍     ║
╚═══════════════════════════════════════╝

Visualize live OpenCode session data via SSE streaming.

Usage:
  world-viz                    # Auto-discover servers or use mock
  world-viz --json             # JSON output mode
  world-viz --url <url>        # Connect to specific server

Quickstart:
  # First time? Try mock mode (no server needed):
  $ world-viz
  
  # With real backend:
  $ cd ~/project && opencode   # Terminal 1
  $ world-viz                  # Terminal 2

See also:
  world-viz --explain          # How this works
  world-viz --api-docs         # Backend API reference
`)
  process.exit(0)
}
```

**Key elements:**
1. **Visual banner** - Immediately identifiable
2. **One-liner description** - What this tool does
3. **Usage section** - Most common invocations first
4. **Quickstart** - Copy-pasteable examples
5. **See also** - Progressive complexity pointers

### Simple API (No Effect)

```typescript
// packages/core/src/state/world-stream.ts

import { Atom } from "@effect-atom/atom"
import { Effect, Runtime, Fiber, Stream } from "effect"

export interface WorldStreamConfig {
  baseUrl: string
  directory?: string
}

export interface WorldStreamHandle {
  /** Subscribe to world updates */
  subscribe: (callback: (world: WorldState) => void) => () => void
  
  /** Get current snapshot (one-shot) */
  getSnapshot: () => Promise<WorldState>
  
  /** Async iterator for TUI/CLI */
  [Symbol.asyncIterator]: () => AsyncIterator<WorldState>
  
  /** Disconnect and cleanup */
  dispose: () => Promise<void>
}

export const createWorldStream = (
  config: WorldStreamConfig
): WorldStreamHandle => {
  // Create runtime with SSE service configured
  const layer = Layer.mergeAll(
    SSEService.live(config.baseUrl),
    ConfigService.live(config)
  )
  const runtime = Runtime.make(layer)
  
  // The world atom - derived from base atoms
  const worldAtom = runtimeAtom.atom(/* ... */)
  
  return {
    subscribe: (callback) => {
      const fiber = runtime.runFork(
        Atom.changes(worldAtom).pipe(
          Stream.tap(world => Effect.sync(() => callback(world))),
          Stream.runDrain
        )
      )
      
      // Return unsubscribe function
      return () => {
        runtime.runSync(Fiber.interrupt(fiber))
      }
    },
    
    getSnapshot: () => 
      runtime.runPromise(
        Atom.get(worldAtom).pipe(
          Effect.flatMap(Result.toEffect)
        )
      ),
    
    [Symbol.asyncIterator]: () => {
      const queue = new AsyncQueue<WorldState>()
      
      const fiber = runtime.runFork(
        Atom.changes(worldAtom).pipe(
          Stream.tap(world => Effect.sync(() => queue.push(world))),
          Stream.runDrain
        )
      )
      
      return {
        next: async () => {
          const value = await queue.pop()
          return { value, done: false }
        },
        return: async () => {
          await runtime.runPromise(Fiber.interrupt(fiber))
          return { value: undefined, done: true }
        }
      }
    },
    
    dispose: () => runtime.runPromise(Effect.unit)
  }
}
```

### Consumer Experiences

**React - No Effect knowledge needed:**

```typescript
// packages/react/src/hooks/use-world.ts
import { createWorldStream, WorldState } from "@opencode-vibe/core/state"
import { useState, useEffect, useSyncExternalStore } from "react"

export function useWorld(): WorldState | null {
  const stream = useWorldStream() // from context
  const [world, setWorld] = useState<WorldState | null>(null)
  
  useEffect(() => stream.subscribe(setWorld), [stream])
  
  return world
}

// Convenience selectors
export function useSession(id: string): EnrichedSession | undefined {
  const world = useWorld()
  return world?.sessions.find(s => s.id === id)
}

export function useActiveSessions(): EnrichedSession[] {
  const world = useWorld()
  return world?.sessions.filter(s => s.isActive) ?? []
}

export function useSessionMessages(sessionId: string): EnrichedMessage[] {
  const world = useWorld()
  return world?.sessions.find(s => s.id === sessionId)?.messages ?? []
}
```

**TUI - Async iterator:**

```typescript
// TUI client (Ink or similar)
import { createWorldStream } from "@opencode-vibe/core/state"

const stream = createWorldStream({ baseUrl: "http://localhost:3000" })

// Main render loop
for await (const world of stream) {
  console.clear()
  
  for (const session of world.sessions) {
    const status = session.isActive ? "🟢" : "⚪"
    console.log(`${status} ${session.title}`)
    
    if (session.isActive) {
      const lastMsg = session.messages.at(-1)
      if (lastMsg?.isStreaming) {
        console.log(`  └─ Streaming: ${lastMsg.parts.length} parts`)
      }
    }
  }
}
```

**CLI - One-shot promise:**

```typescript
// CLI client
import { createWorldStream } from "@opencode-vibe/core/state"

async function main() {
  const stream = createWorldStream({ baseUrl: "http://localhost:3000" })
  const world = await stream.getSnapshot()
  
  console.log(`Sessions: ${world.sessions.length}`)
  console.log(`Active: ${world.activeSessionCount}`)
  
  for (const session of world.sessions) {
    console.log(`- ${session.title} (${session.status})`)
  }
  
  await stream.dispose()
}
```

**Power User - Full Effect:**

```typescript
// Direct Effect usage when needed
import { WorldStream } from "@opencode-vibe/core/state"
import { Effect, Stream } from "effect"

const program = Effect.gen(function* () {
  // Get active sessions as Effect stream
  const activeSessions = yield* WorldStream.sessionsForDirectory("/my/project").pipe(
    Stream.map(sessions => sessions.filter(s => s.isActive)),
    Stream.take(1),
    Stream.runHead
  )
  
  // Do something with them
  yield* Effect.log(`Active sessions: ${activeSessions?.length ?? 0}`)
})

// Run with custom layer composition
const result = await program.pipe(
  Effect.provide(SSEService.live("http://localhost:3000")),
  Effect.runPromise
)
```

---

## Discovery-First Design Patterns

This section codifies the patterns for building agent-friendly CLI tools.

### Pattern 1: Auto-Discovery with Fallback Chains

```typescript
// From world-viz/src/discovery.ts - discover running servers
export async function discoverServers(): Promise<DiscoveredServer[]> {
  try {
    // Find all listening TCP ports for bun/opencode processes
    const { stdout } = await execAsync(
      `lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E 'bun|opencode'`,
      { timeout: 2000 }
    )
    
    // Verify each candidate is actually an OpenCode server
    const candidates = parseOutput(stdout)
    return await verifyOpencodeServers(candidates)
  } catch {
    return [] // Graceful degradation
  }
}
```

The key insight: **Try to do the right thing automatically. Fall back gracefully. Guide the user to manual options.**

```
┌─────────────────────────────────────────────────────────────────────┐
│  DISCOVERY FALLBACK CHAIN                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Try auto-discovery (lsof for listening ports)                   │
│     ├── Success: Use discovered server                              │
│     │            → "✓ Found server: localhost:3000"                 │
│     │                                                               │
│     └── No servers found                                            │
│         │                                                           │
│         ▼                                                           │
│  2. Fall back to mock mode                                          │
│     └── "✗ No servers found. Starting mock mode..."                 │
│         "TO CONNECT TO REAL SERVER:"                                │
│         "  1. Start OpenCode: cd ~/project && opencode"             │
│         "  2. Then run: world-viz"                                  │
│         │                                                           │
│         ▼                                                           │
│  3. Error in mock mode                                              │
│     └── "❌ Connection error: ECONNREFUSED"                         │
│         "Troubleshooting:"                                          │
│         "  • Mock server not running?"                              │
│         "  • Start it with: bun run mock-server.ts"                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Pattern 2: Error Messages That Teach

Every error should include:
1. What went wrong (symptom)
2. Likely cause (diagnosis)
3. How to fix it (remedy)
4. How to verify the fix (validation)

```typescript
// From world-viz/src/main.ts
process.on("uncaughtException", (error) => {
  console.error("\n❌ Connection error:", error.message)
  console.error("\nTroubleshooting:")
  if (useMock) {
    console.error(
      "  • Mock server not running? Start it with: bun run mock-server.ts"
    )
  } else {
    console.error("  • Is the OpenCode backend running?")
    console.error(`  • Is it accessible at ${baseUrl}?`)
    console.error("  • Try: curl -v " + baseUrl + "/session/list")
  }
  process.exit(1)
})
```

**Anti-pattern:**
```
Error: ECONNREFUSED
```

**Pattern:**
```
❌ Connection error: ECONNREFUSED

Troubleshooting:
  • Is the OpenCode backend running?
  • Is it accessible at http://localhost:3000?
  • Try: curl -v http://localhost:3000/session/list
```

### Pattern 3: Progressive Capability Revelation

Start simple. Reveal complexity when it's relevant.

```
┌─────────────────────────────────────────────────────────────────────┐
│  PROGRESSIVE REVELATION STAGES                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  STAGE 1: Just run it                                               │
│  $ world-viz                                                        │
│  → Auto-discovers, connects, shows data                             │
│                                                                     │
│  STAGE 2: Basic options (revealed in --help)                        │
│  $ world-viz --json                                                 │
│  → Machine-readable output                                          │
│                                                                     │
│  STAGE 3: Advanced options (revealed when needed)                   │
│  $ world-viz --url http://custom:3001                               │
│  → TIP shown when multiple servers found                            │
│                                                                     │
│  STAGE 4: Power features (revealed in --explain)                    │
│  $ world-viz --api-docs                                             │
│  → Backend API reference for integration                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Pattern 4: Contextual "What You Can Do Next"

Every tool output should hint at logical next actions:

```bash
$ world-viz
✓ Found 3 servers:
    → localhost:3000 → /Users/joel/project-a
      localhost:3001 → /Users/joel/project-b
      localhost:3002 → /Users/joel/project-c

Connecting to localhost:3000...

TIP: Use --url to connect to a specific server  # ← Next action hint
```

```bash
$ world-viz
✗ No servers found

Starting mock mode...

TO CONNECT TO REAL SERVER:              # ← Recovery path
  1. Start OpenCode: cd ~/project && opencode
  2. Then run: world-viz
```

### Pattern 5: Nine Affordances for API/Tool Design

Mike Amundsen identified nine affordances that well-designed APIs should expose:

| Affordance | Description | CLI Application |
|------------|-------------|-----------------|
| **Safe** | Read-only, no side effects | `world-viz` (just viewing) |
| **Idempotent** | Same result on repeat | `world-viz --url X` |
| **Unsafe** | Modifies state | `session delete X` |
| **Inline** | Embedded in response | Status shown inline |
| **Templated** | URL/command with placeholders | `--url <url>` |
| **Transclude** | Include by reference | `--explain` points to docs |
| **Embed** | Nested resource in response | Session includes messages |
| **Item** | Individual resource | Single session view |
| **Collection** | List of resources | Session list view |

Every CLI command should be classifiable in these terms. This makes capabilities predictable.

---

## Relationship to ADR-017

ADR-017 proposed pure reducers in Core. **This ADR builds on that foundation:**

| ADR-017 (Pure Reducers) | ADR-018 (World Stream) |
|-------------------------|------------------------|
| `directoryReducer(state, event) => state` | Still used internally by atoms |
| Consumers apply reducer themselves | Core applies reducer, emits derived world |
| Multiple subscriptions, manual coordination | Single subscription, automatic consistency |
| Framework-specific reactivity | Framework-agnostic stream |

**ADR-018 supersedes ADR-017's consumer integration pattern** but preserves the pure reducer insight. The reducers become internal implementation details of the atom layer.

```typescript
// ADR-017 reducers become internal
const sessionsAtom = Atom.make(
  Effect.gen(function* (get: Atom.Context) {
    const events = yield* get.result(sseEventsAtom)
    // Use ADR-017's pure reducer
    return events.reduce(sessionReducer, [])
  })
)
```

---

## Benefits

| Benefit | Impact |
|---------|--------|
| **Consistency guaranteed** | No more "subscribed to A but not B" bugs |
| **Single derivation** | Logic runs once in Core, not N times per consumer |
| **Framework agnostic** | Same stream feeds React, TUI, CLI, tests |
| **No Zustand needed** | React layer becomes trivially simple hooks |
| **Effect isolation** | Consumers don't need to learn Effect |
| **Resource management** | Automatic cleanup via Effect Scope |
| **Backpressure** | Effect Stream handles fast updates gracefully |
| **Testability** | Pure atoms, mockable services, no framework deps |
| **Agent-friendly tools** | Progressive discovery reduces context burden |
| **Self-documenting CLIs** | Error messages guide recovery |

---

## Costs

| Cost | Impact | Mitigation |
|------|--------|------------|
| **New dependency** | effect-atom package | Already use Effect, natural extension |
| **Learning curve** | effect-atom API | Simple consumer API hides complexity |
| **Migration effort** | Rewrite store integration | Phased migration, old API remains during transition |
| **Memory overhead** | Derived state computed eagerly | effect-atom's lazy evaluation, only active atoms computed |
| **Bundle size** | effect-atom + Effect | Already pay Effect cost, marginal addition |
| **Discovery implementation** | Extra code for fallback chains | Pattern is reusable, amortized across tools |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| effect-atom immature | Low | High | Author (tim-smart) is Effect core team, actively maintained |
| Performance regression | Medium | Medium | Benchmark in Phase 1, compare to Zustand baseline |
| Effect in React patterns | Medium | Medium | Proven runWithRuntime pattern, simple hooks hide Effect |
| Over-derivation | Low | Low | effect-atom only computes when dependencies change |
| Type complexity | Medium | Low | Consumer types are simple, Effect types are internal |
| Discovery pattern complexity | Low | Low | Pattern is well-defined, implemented once |

---

## Implementation Plan

### Phase 0: Spike (1-2 days)

**Goal:** Prove effect-atom works with our SSE pattern.

**Tasks:**
1. Install `@effect-atom/atom`
2. Create minimal `sessionsAtom` that updates from SSE
3. Create minimal `worldAtom` that derives enriched sessions
4. Create `subscribe()` wrapper
5. Verify in dev console

**Success Criteria:**
- SSE events update atoms
- Derived world atom reflects changes
- Subscribe callback receives updates
- No Effect imports in test consumer

**Rollback:** Delete spike branch, no production impact.

### Phase 1: Core World Stream + Discovery Patterns (3-5 days)

**Goal:** Full WorldState implementation in Core. Establish discovery patterns.

**Tasks:**
1. Define `WorldState`, `EnrichedSession`, `EnrichedMessage` types
2. Create base atoms: `sessionsAtom`, `messagesAtom`, `partsAtom`, `statusAtom`
3. Create derived `worldAtom` with all enrichment logic
4. Implement `createWorldStream()` with subscribe/snapshot/iterator APIs
5. **Extract discovery utilities to shared package**
6. **Document discovery pattern for other tools**
7. Add tests for derivation logic
8. Add tests for subscription lifecycle

**Success Criteria:**
- `createWorldStream()` works standalone (no React)
- All enrichment fields populated correctly
- Consistency: world snapshot is always internally consistent
- Discovery utilities exported and documented
- Type check passes
- Tests pass

### Phase 2: React Integration (2-3 days)

**Goal:** Replace Zustand with world stream hooks.

**Tasks:**
1. Create `WorldStreamProvider` context
2. Implement `useWorld()` hook
3. Implement selector hooks: `useSession()`, `useSessionMessages()`, etc.
4. Update one page to use new hooks (pilot)
5. Verify SSR compatibility (if applicable)

**Success Criteria:**
- Pilot page works with new hooks
- No regressions in functionality
- Performance comparable to Zustand
- Type check passes

### Phase 3: Full Migration (3-5 days)

**Goal:** All React components use world stream.

**Tasks:**
1. Migrate remaining pages to new hooks
2. Remove old Zustand store (or deprecate)
3. Update documentation
4. Remove SSEProvider/useSSEEvents (replaced by stream)

**Success Criteria:**
- All pages use new hooks
- Old store code removed or deprecated
- No feature regressions
- Build size reduced (no Zustand)

### Phase 4: Multi-Client Examples + Discovery Refinement (2-3 days)

**Goal:** Prove framework-agnostic promise with real clients. Refine discovery patterns.

**Tasks:**
1. Create TUI example using async iterator API
2. Create CLI example using snapshot API
3. **Apply discovery patterns to all CLI tools**
4. **Add `--explain` / `--api-docs` to tools**
5. Document consumer patterns
6. Add integration tests

**Success Criteria:**
- TUI renders live session updates
- CLI can query current state
- Same Core code powers all clients
- All tools follow discovery patterns
- Examples are runnable with `bun run`

---

## Testing Strategy

### Atom Unit Tests

```typescript
// packages/core/src/state/world.test.ts
import { describe, it, expect } from "vitest"
import { Atom, Result } from "@effect-atom/atom"
import { Effect } from "effect"
import { worldAtom, sessionsAtom, statusAtom } from "./world"

describe("worldAtom", () => {
  it("enriches sessions with status", async () => {
    // Set base atoms
    await Atom.set(sessionsAtom, [{ id: "s1", title: "Test" }])
    await Atom.set(statusAtom, { s1: "running" })
    
    // Get derived world
    const world = await Atom.get(worldAtom).pipe(
      Effect.flatMap(Result.toEffect),
      Effect.runPromise
    )
    
    expect(world.sessions[0].status).toBe("running")
    expect(world.sessions[0].isActive).toBe(true)
    expect(world.activeSessionCount).toBe(1)
  })
  
  it("embeds parts in messages", async () => {
    await Atom.set(messagesAtom, { 
      s1: [{ id: "m1", sessionID: "s1" }] 
    })
    await Atom.set(partsAtom, { 
      m1: [{ id: "p1", messageID: "m1", type: "text" }] 
    })
    
    const world = await Atom.get(worldAtom).pipe(
      Effect.flatMap(Result.toEffect),
      Effect.runPromise
    )
    
    expect(world.sessions[0].messages[0].parts).toHaveLength(1)
    expect(world.sessions[0].messages[0].parts[0].id).toBe("p1")
  })
})
```

### Consumer API Tests

```typescript
// packages/core/src/state/world-stream.test.ts
import { describe, it, expect, vi } from "vitest"
import { createWorldStream } from "./world-stream"

describe("createWorldStream", () => {
  it("subscribe receives world updates", async () => {
    const stream = createWorldStream({ baseUrl: "http://localhost:3000" })
    const callback = vi.fn()
    
    const unsubscribe = stream.subscribe(callback)
    
    // Simulate SSE event (via test helper)
    await emitTestEvent({ type: "session.created", ... })
    
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String) })
        ])
      })
    )
    
    unsubscribe()
    await stream.dispose()
  })
  
  it("async iterator yields updates", async () => {
    const stream = createWorldStream({ baseUrl: "http://localhost:3000" })
    
    const iterator = stream[Symbol.asyncIterator]()
    
    // Emit event
    await emitTestEvent({ type: "session.created", ... })
    
    const { value } = await iterator.next()
    expect(value.sessions.length).toBeGreaterThan(0)
    
    await iterator.return?.()
    await stream.dispose()
  })
})
```

### Discovery Tests

```typescript
// packages/core/src/discovery/discover.test.ts
import { describe, it, expect, vi } from "vitest"
import { discoverServers } from "./discover"

describe("discoverServers", () => {
  it("returns empty array when no servers found", async () => {
    // Mock lsof returning nothing
    const servers = await discoverServers()
    expect(servers).toEqual([])
  })
  
  it("verifies candidates by calling /project/current", async () => {
    // Mock lsof returning port 3000
    // Mock fetch for /project/current
    const servers = await discoverServers()
    expect(servers[0]).toMatchObject({
      port: 3000,
      directory: expect.any(String)
    })
  })
})
```

### React Hook Tests

```typescript
// packages/react/src/hooks/use-world.test.tsx
import { describe, it, expect } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useWorld, useSession } from "./use-world"
import { WorldStreamProvider } from "../providers/world-stream-provider"

describe("useWorld", () => {
  it("returns null initially, then world state", async () => {
    const { result } = renderHook(() => useWorld(), {
      wrapper: ({ children }) => (
        <WorldStreamProvider baseUrl="http://localhost:3000">
          {children}
        </WorldStreamProvider>
      )
    })
    
    expect(result.current).toBeNull()
    
    // Wait for initial SSE connection and first update
    await waitFor(() => {
      expect(result.current).not.toBeNull()
      expect(result.current?.sessions).toBeDefined()
    })
  })
})
```

---

## Conclusion

This ADR establishes two interconnected principles:

1. **Push-based reactive world stream** - Core owns state derivation. Consumers subscribe to complete, consistent world snapshots. No coordination burden on clients.

2. **Progressive Discovery for Agents** - Tools teach agents through contextual output, not front-loaded prompts. Errors guide recovery. Complexity reveals progressively.

These principles share a common insight: **inversion of control**.

For state: Core pushes complete world state; consumers just subscribe.
For tooling: Tools push relevant guidance; agents just act.

> "Hypermedia APIs: Scalability through client/server separation and self-contained messages. Clients and servers can evolve independently."

The same applies to agent tooling. When tools are self-describing and contextually helpful, agents can evolve their usage patterns independently of the tool's implementation.

**effect-atom** is the right tool for the reactive layer because:
1. We already use Effect everywhere
2. It integrates Stream, Scope, and Layer natively
3. It's maintained by Effect core team
4. Simple consumer APIs hide Effect complexity

**The discovery patterns** codified here apply to every CLI tool we build:
1. Auto-discovery with fallback chains
2. Error messages that teach
3. Progressive capability revelation
4. Contextual "what you can do next" hints

This is Joel's holiday project. No external consumers. TUI exists today. The time to try this is now.

---

## References

- **effect-atom:** https://github.com/tim-smart/effect-atom
- **Effect Stream:** https://effect.website/docs/stream
- **ADR-017:** Session Management in Core Layer
- **ADR-016:** Core Layer Responsibility Model
- **ADR-015:** Event Architecture Simplification
- **HATEOAS:** Fielding's REST dissertation, Chapter 5
- **API Affordances:** Mike Amundsen's "Design and Build Great Web APIs"
- **Prior Art:**
  - Elm Architecture (model → view, no intermediate subscriptions)
  - Redux Observables (action stream → state stream)
  - RxJS BehaviorSubject (current value + stream)
  - Recoil selectors (derived state, atom-based)
  - Hypermedia Controls (HATEOAS, HAL, JSON:API)
  - Effect Patterns repo (progressive mastery approach)

---

> "The purpose of abstraction is not to be vague, but to create a new semantic level in which one can be absolutely precise."  
> — Edsger W. Dijkstra

**The world stream is that new semantic level:** consumers don't think about sessions + messages + parts + status as separate things. They think about *the world* as a single, always-consistent thing.

**Progressive discovery is the same principle for agents:** they don't think about command syntax + flags + edge cases. They think about *what they can do next*, guided by each interaction.

> "All affordances for an API are delivered by means of hypermedia."  
> — Roy Fielding

For our tools: **All affordances for a CLI are delivered by means of its output.**
