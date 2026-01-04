# ADR-019: SSE Event Flow Architecture

**Status:** Accepted  
**Date:** 2026-01-04  
**Deciders:** Joel Hooks  
**Affected Components:** `@opencode-vibe/core`, `@opencode-vibe/react`, Web App  
**Related ADRs:** [ADR-016](016-core-layer-responsibility.md) (Core Layer Responsibility), [ADR-018](018-reactive-world-stream.md) (Reactive World Stream), [ADR-015](015-event-architecture-simplification.md)

```
    ╔══════════════════════════════════════════════════════════════════╗
    ║   🚨 DON'T BUILD PARALLEL STATE SYSTEMS 🚨                       ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║   WHAT BROKE: Two parallel systems, no connection               ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  ZUSTAND SSE HANDLERS                                   │    ║
    ║   │  ├── handleSessionCreated()                             │    ║
    ║   │  ├── handleMessageUpdated()                             │    ║
    ║   │  └── handlePartUpdated()                                │    ║
    ║   │       ↓                                                 │    ║
    ║   │  Zustand Store                                          │    ║
    ║   │  ├── sessions[]                                         │    ║
    ║   │  ├── messages{}                                         │    ║
    ║   │  └── parts{}                                            │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   MEANWHILE, IN A PARALLEL UNIVERSE:                             ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  WORLD STREAM                                           │    ║
    ║   │  ├── SSE → effect-atom → derived world                  │    ║
    ║   │  └── NO CONNECTION TO REACT                             │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   RESULT: React reads stale Zustand, World Stream never used    ║
    ║                                                                  ║
    ║   THE FIX: One source of truth                                   ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  Backend SSE                                            │    ║
    ║   │       ↓                                                 │    ║
    ║   │  Core World Stream (effect-atom)                        │    ║
    ║   │       ↓                                                 │    ║
    ║   │  React Hooks (subscribe to World Stream)                │    ║
    ║   │       ↓                                                 │    ║
    ║   │  UI Components                                          │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   Zustand preserved ONLY for UI-local state (ready, todos).      ║
    ╚══════════════════════════════════════════════════════════════════╝
```

---

## Executive Summary

**Problem:** The session page read from Zustand store, but SSE events flowed to World Stream. Two parallel state systems with no connection.

**Root Cause:** Incremental migration left half-finished plumbing. React hooks still subscribed to Zustand, World Stream existed but wasn't consumed.

**Solution:** React hooks now delegate to World Stream. Zustand SSE handlers disabled for core data (sessions, messages, parts). Zustand preserved ONLY for UI-local state (ready flags, todos, model limits).

**Impact:** Session page now reactive again. World Stream is THE source of truth.

---

## Context

### What Broke

The session page (`app/sessions/[id]/page.tsx`) displayed stale data because:

1. **React read from Zustand** - `useOpencodeStore()` hooks subscribed to Zustand slices
2. **SSE events fed World Stream** - Backend events flowed to `effect-atom` registry
3. **No connection** - World Stream computed derived state but React never subscribed

**Symptoms:**
- New messages didn't appear until page refresh
- Session status stuck at "completed" when actually running
- Parts updates invisible to UI

### Why This Happened

**ADR-018 established World Stream** as the reactive state layer powered by `effect-atom`. The migration was incremental:

✅ **Phase 1 Complete** - World Stream implementation in Core  
✅ **Phase 2 Started** - React hooks created (`useWorld`, `useWorldSession`, `useWorldSessionList`)  
❌ **Phase 2 Incomplete** - React components still used old Zustand hooks  
❌ **Phase 3 Not Started** - Zustand SSE handlers still active, conflicting with World Stream

**Result:** Two parallel systems, both receiving SSE events, but React only read from one.

---

## The Correct Architecture

### Event Flow (ADR-016 + ADR-018)

```
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND (packages/opencode)                                         │
│  └── SSE Event Stream (/api/events)                                 │
│      ├── session.created                                            │
│      ├── message.updated                                            │
│      ├── message.part.updated                                       │
│      └── session.status                                             │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CORE WORLD STREAM (@opencode-vibe/core/world)                      │
│  ├── WorldSSE: SSE connection → effect-atom registry                │
│  ├── Base Atoms:                                                    │
│  │   ├── sessionsAtom: Atom<Session[]>                              │
│  │   ├── messagesAtom: Atom<Record<sessionId, Message[]>>           │
│  │   ├── partsAtom: Atom<Record<messageId, Part[]>>                 │
│  │   └── statusAtom: Atom<Record<sessionId, SessionStatus>>         │
│  └── Derived Atoms:                                                 │
│      └── worldAtom: Atom<WorldState> (enriched sessions+messages)   │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  REACT HOOKS (@opencode-vibe/react)                                 │
│  ├── useWorld() → WorldState                                        │
│  ├── useWorldSession(id) → EnrichedSession                          │
│  ├── useWorldSessionList() → EnrichedSession[]                      │
│  └── DELEGATES to Core promise APIs, subscribes to World Stream     │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UI COMPONENTS (app/)                                                │
│  └── Use React hooks, render UI                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ZUSTAND (UI-LOCAL STATE ONLY)                                      │
│  ├── ready: boolean (connection status)                             │
│  ├── todos: Todo[] (UI checklist state)                             │
│  └── modelLimits: Record<model, limits> (static config)             │
│  └── NO sessions, messages, or parts (those flow through World Stream)|
└─────────────────────────────────────────────────────────────────────┘
```

### Key Principles (ADR-016: Core Layer Responsibility)

1. **Core owns computation** - World Stream derives ALL state
2. **React binds UI** - Hooks subscribe to World Stream, pass data to components
3. **NEVER create parallel SSE handlers** - SSE events ONLY feed Core atoms
4. **Zustand for UI-local state ONLY** - Ready flags, UI toggles, static config
5. **Single source of truth** - Core World Stream, not Zustand

---

## What NOT to Do

### Anti-Pattern 1: Parallel SSE Event Handlers

❌ **WRONG** - Handling SSE events in both Core AND React:

```typescript
// ANTI-PATTERN: packages/react/src/stores/opencode-store.ts
export const useOpencodeStore = create<OpencodeStore>((set, get) => ({
  sessions: [],
  messages: {},
  parts: {},
  
  // ❌ DON'T: Parallel SSE handlers
  handleSSEEvent: (event: Event) => {
    switch (event.type) {
      case "session.created":
        set(state => ({ sessions: [...state.sessions, event.data] }))
        break
      case "message.updated":
        set(state => ({
          messages: { ...state.messages, [event.sessionId]: [...] }
        }))
        break
      // ... duplicating Core logic
    }
  }
}))

// ANTI-PATTERN: packages/app/src/providers/sse-provider.tsx
<SSEProvider onEvent={store.handleSSEEvent}> {/* ❌ Feeds Zustand */}
  {children}
</SSEProvider>

// MEANWHILE: packages/core/src/world/sse.ts
WorldSSE.connect() // ✅ Also handling events, but React doesn't use it
```

**Problems:**
- Two systems processing same events
- Inconsistent state (one updates before the other)
- React reads stale Zustand, ignores fresh World Stream
- Logic duplication, drift over time

### Anti-Pattern 2: Components Reading Zustand Directly

❌ **WRONG** - Components subscribing to Zustand for sessions/messages:

```typescript
// ANTI-PATTERN: app/sessions/[id]/page.tsx
export default function SessionPage({ params }: { params: { id: string } }) {
  // ❌ Reading from Zustand (parallel system)
  const session = useOpencodeStore(s => 
    s.sessions.find(sess => sess.id === params.id)
  )
  const messages = useOpencodeStore(s => s.messages[params.id] ?? [])
  
  // World Stream exists but isn't used!
  return <SessionView session={session} messages={messages} />
}
```

**Problems:**
- World Stream computes derived state (session + messages + status) but React ignores it
- Stale data from Zustand (SSE events feed World Stream, not Zustand anymore)
- Breaking the ADR-016 boundary (React doing computation instead of Core)

### Anti-Pattern 3: Dual Implementation During Migration

❌ **WRONG** - Keeping both systems active "temporarily":

```typescript
// ANTI-PATTERN: Feeding SSE to BOTH systems
const sseEvents = useSSEEvents()

useEffect(() => {
  // ❌ Feeding BOTH Zustand and World Stream
  store.handleSSEEvent(event)      // Updates Zustand
  worldStream.handleEvent(event)   // Updates Core atoms
  
  // Now we have two sources of truth!
}, [sseEvents])
```

**Problems:**
- Double memory usage
- Timing bugs (which updates first?)
- Impossible to debug (which system is "right"?)
- Migration never completes (both systems entrenched)

---

## The Fix (Implemented 2026-01-04)

### 1. React Hooks Delegate to World Stream

✅ **CORRECT** - Hooks call Core promise APIs, subscribe to World Stream:

```typescript
// packages/react/src/hooks/use-world-session.ts
import { useWorldStream } from "./use-world-stream"
import type { EnrichedSession } from "@opencode-vibe/core/world"

/**
 * Get a single session by ID with computed fields.
 * Subscribes to World Stream - updates when SSE events arrive.
 */
export function useWorldSession(
  sessionId: string | undefined
): EnrichedSession | undefined {
  const world = useWorldStream()
  
  if (!sessionId || !world) return undefined
  
  return world.sessions.find(s => s.id === sessionId)
}
```

### 2. Zustand SSE Handlers Disabled for Core Data

✅ **CORRECT** - Zustand handlers removed/disabled:

```typescript
// packages/react/src/stores/opencode-store.ts
export const useOpencodeStore = create<OpencodeStore>((set, get) => ({
  // ✅ UI-local state ONLY
  ready: false,
  todos: [],
  modelLimits: {},
  
  // ❌ REMOVED: sessions, messages, parts (now in World Stream)
  // ❌ REMOVED: handleSSEEvent() - SSE feeds World Stream, not Zustand
  
  setReady: (ready: boolean) => set({ ready }),
  addTodo: (todo: Todo) => set(s => ({ todos: [...s.todos, todo] })),
}))
```

### 3. Components Use World Stream Hooks

✅ **CORRECT** - Components read from World Stream:

```typescript
// app/sessions/[id]/page.tsx
import { useWorldSession } from "@opencode-vibe/react/hooks"

export default function SessionPage({ params }: { params: { id: string } }) {
  // ✅ Reading from World Stream (THE source of truth)
  const session = useWorldSession(params.id)
  
  if (!session) return <NotFound />
  
  // session.messages already embedded (Core pre-joins)
  // session.status already computed (Core derives)
  return <SessionView session={session} />
}
```

---

## How to Add Real-Time Features Correctly

### Pattern: Backend → Core → React

When adding a new real-time feature (e.g., agent status updates), follow this flow:

#### 1. Backend Emits SSE Event

```typescript
// packages/opencode/src/agents/agent-service.ts
export class AgentService {
  async updateStatus(agentId: string, status: AgentStatus) {
    // Update state
    this.agents.set(agentId, { ...this.agents.get(agentId), status })
    
    // ✅ Emit SSE event
    GlobalBus.emit({
      type: "agent.status",
      properties: { agentId, status, timestamp: Date.now() }
    })
  }
}
```

#### 2. Core Handles Event in Atom

```typescript
// packages/core/src/world/atoms.ts
import { Atom } from "@effect-atom/atom"
import type { Event } from "../types/sdk"

export const agentsAtom = Atom.make(
  Effect.gen(function* (get: Atom.Context) {
    const events = yield* get.result(sseEventsAtom)
    
    return events.reduce((agents, event) => {
      if (event.type === "agent.status") {
        const { agentId, status } = event.properties
        return {
          ...agents,
          [agentId]: { ...agents[agentId], status }
        }
      }
      return agents
    }, {} as Record<string, Agent>)
  })
)

// Derive in worldAtom
export const worldAtom = Atom.make(
  Effect.gen(function* (get: Atom.Context) {
    const sessions = yield* get.result(sessionsAtom)
    const agents = yield* get.result(agentsAtom) // ✅ Include agents
    
    return {
      sessions: sessions.map(s => ({
        ...s,
        activeAgents: Object.values(agents).filter(a => 
          a.sessionId === s.id && a.status === "running"
        )
      })),
      agents, // ✅ Expose in WorldState
      // ...
    }
  })
)
```

#### 3. React Hook Subscribes

```typescript
// packages/react/src/hooks/use-session-agents.ts
import { useWorldSession } from "./use-world-session"
import type { Agent } from "@opencode-vibe/core/types/sdk"

export function useSessionAgents(sessionId: string): Agent[] {
  const session = useWorldSession(sessionId)
  return session?.activeAgents ?? []
}
```

#### 4. Component Renders

```typescript
// app/sessions/[id]/components/agent-status.tsx
import { useSessionAgents } from "@opencode-vibe/react/hooks"

export function AgentStatus({ sessionId }: { sessionId: string }) {
  const agents = useSessionAgents(sessionId)
  
  return (
    <div>
      {agents.map(agent => (
        <div key={agent.id}>
          {agent.name}: {agent.status}
        </div>
      ))}
    </div>
  )
}
```

### ✅ Checklist for New Real-Time Features

- [ ] Backend emits SSE event via `GlobalBus.emit()`
- [ ] Core creates/updates atom for entity type
- [ ] Core includes entity in `worldAtom` derivation
- [ ] React hook subscribes to World Stream (via `useWorld()` or derived hook)
- [ ] Component uses React hook, renders UI
- [ ] **NEVER** add SSE handler to Zustand
- [ ] **NEVER** duplicate derivation logic in React
- [ ] **ALWAYS** compute in Core, bind in React

---

## Debugging Event Flow Issues

### Symptom: Component shows stale data

**Diagnosis:**
1. Check if component uses World Stream hooks (`useWorldSession`, etc.) or Zustand
2. Verify SSE events arriving via browser DevTools Network tab (`/api/events`)
3. Check effect-atom registry has atom for entity type
4. Verify `worldAtom` includes derived field

**Common Causes:**
- Component still using Zustand hooks (migrate to World Stream hooks)
- SSE event not handled in Core atom reducer
- `worldAtom` not deriving field from base atom
- React hook not subscribed to World Stream

### Symptom: Events arrive but UI doesn't update

**Diagnosis:**
1. Check if `worldAtom` recomputes when base atom updates (add logging)
2. Verify React hook subscription lifecycle (mount/unmount logging)
3. Check for stale closures in hook (dependencies array)
4. Verify component re-renders when hook value changes

**Common Causes:**
- `effect-atom` missing `Atom.keepAlive` (atom resets after microtask)
- React hook missing dependency (stale closure)
- Component memoized without proper comparison
- Subscription not established (missing `useEffect` dependency)

### Debug Tools

```typescript
// Enable World Stream logging
localStorage.setItem("debug", "world-stream")

// Watch atom updates
import { Atom } from "@effect-atom/atom"
const unwatch = Atom.watch(worldAtom, (world) => {
  console.log("[WORLD]", world)
})

// Trace SSE events
// packages/core/src/world/sse.ts
WorldSSE.connect().pipe(
  Stream.tap(event => Effect.log("SSE", event.type)),
  // ...
)
```

---

## Migration Checklist (Completed 2026-01-04)

- [x] React hooks delegate to World Stream (`useWorld`, `useWorldSession`, `useWorldSessionList`)
- [x] Components use World Stream hooks instead of Zustand
- [x] Zustand SSE handlers disabled for sessions/messages/parts
- [x] Zustand preserved only for UI-local state (ready, todos, modelLimits)
- [x] Session page reactive (displays live updates)
- [x] No parallel state systems (World Stream is THE source of truth)
- [x] Documentation updated (this ADR)

---

## Consequences

### Positive

1. **Single source of truth** - World Stream is authoritative, no conflicts
2. **Reactive UI** - Components update when SSE events arrive
3. **Simpler React layer** - Hooks just subscribe, no computation
4. **Aligns with ADR-016** - Core owns computation, React binds UI
5. **Testable** - Core atoms tested in isolation, React hooks integration tested
6. **Type-safe** - `EnrichedSession` type includes all derived fields
7. **Performance** - Derivation happens once in Core, not per component

### Negative

1. **Migration effort** - All components must switch from Zustand to World Stream hooks
2. **Learning curve** - Team must understand World Stream subscription model
3. **Debugging complexity** - effect-atom atom lifecycle less familiar than Zustand

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Revert to parallel systems | Medium | High | Code review catches Zustand SSE handlers |
| Stale closures in hooks | Medium | Medium | Strict dependency arrays, ESLint rules |
| Performance regression | Low | Medium | Benchmark World Stream vs Zustand (already done in ADR-018) |
| effect-atom bugs | Low | High | Fallback to simple subscription pattern |

---

## Architectural Boundaries (ADR-016)

This ADR reinforces ADR-016's smart boundary pattern:

```
┌─────────────────────────────────────────────────────────────────────┐
│  REACT LAYER (UI binding only)                                       │
│  ├── Hooks subscribe to World Stream                                │
│  ├── Components render UI                                           │
│  └── NO computation, NO SSE handling, NO derivation                 │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CORE LAYER (computation boundary)                                   │
│  ├── World Stream: SSE → effect-atom → derived state                │
│  ├── Atoms compute: session status, message+parts join, etc.        │
│  └── React NEVER imports Effect, only subscribes to World Stream    │
└─────────────────────────────────────────────────────────────────────┘
```

**Violations:**
- ❌ React components with SSE `useEffect` hooks → move to Core atom
- ❌ Zustand reducers duplicating Core logic → delete, use World Stream
- ❌ Components deriving state (useMemo, filtering) → move to Core atom

---

## References

- **ADR-016:** [Core Layer Responsibility](016-core-layer-responsibility.md) - Smart boundary pattern
- **ADR-018:** [Reactive World Stream](018-reactive-world-stream.md) - effect-atom architecture
- **ADR-015:** [Event Architecture Simplification](015-event-architecture-simplification.md) - SSE patterns
- **effect-atom:** https://github.com/tim-smart/effect-atom
- **Prior Art:**
  - Elm Architecture (single source of truth, no parallel state)
  - Redux (unidirectional data flow)
  - React Server Components (server owns computation, client binds UI)

---

> "The purpose of abstraction is not to be vague, but to create a new semantic level in which one can be absolutely precise."  
> — Edsger W. Dijkstra

**World Stream is that semantic level:** Components don't think about sessions + messages + parts + status as separate entities. They think about *the world* as a single, always-consistent snapshot.

**Parallel state systems violate this principle:** They create vague boundaries where it's unclear which system is authoritative. Precision requires a single source of truth.

---

**Next Actions:**

1. Monitor session page for reactivity issues in production
2. Migrate remaining components from Zustand to World Stream hooks
3. Add integration tests for SSE → World Stream → React flow
4. Document World Stream subscription patterns for team
5. Consider removing Zustand entirely (only 3 UI-local fields remain)
