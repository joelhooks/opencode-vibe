# ADR-019: Hierarchical Event Subscriptions

**Status:** Accepted  
**Date:** 2026-01-06  
**Deciders:** Joel Hooks  
**Affected Components:** `@opencode-vibe/core/world`, `@opencode-vibe/react`, Web App, TUI, CLI  
**Related ADRs:** [ADR-018](018-reactive-world-stream.md) (Reactive World Stream), [ADR-016](016-core-layer-responsibility.md) (Core Layer Responsibility)

```
    ╔══════════════════════════════════════════════════════════════════╗
    ║   🎯 SUBSCRIBE TO WHAT YOU NEED, NOT EVERYTHING 🎯              ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║   CURRENT: Flat subscription, no granularity                     ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  worldStateAtom                                         │    ║
    ║   │  └── 8 leaf atoms (sessions, messages, parts, etc.)     │    ║
    ║   │      └── ANY change triggers ALL subscribers            │    ║
    ║   │          └── No way to subscribe to single session      │    ║
    ║   │          └── No cleanup when idle (memory leak)         │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   PROPOSED: 3-tier hierarchy with idleTTL cleanup                ║
    ║   ┌─────────────────────────────────────────────────────────┐    ║
    ║   │  MachineAtom (port-level)                               │    ║
    ║   │    └─> ProjectAtom (worktree-level)                     │    ║
    ║   │        └─> SessionAtom (session-level)                  │    ║
    ║   │            └─> worldStateAtom (global rollup)           │    ║
    ║   │                                                         │    ║
    ║   │  Subscribe at the tier you need.                        │    ║
    ║   │  idleTTL cleans up unused atoms automatically.          │    ║
    ║   └─────────────────────────────────────────────────────────┘    ║
    ║                                                                  ║
    ║   Key insight: Most consumers need ONE session, not ALL.         ║
    ╚══════════════════════════════════════════════════════════════════╝
```

---

## Executive Summary

**Problem:** The current World Stream architecture provides a single `worldStateAtom` subscription point. Every component subscribes to the entire world, even when it only needs one session. There's no idle cleanup, no per-session subscriptions, and HMR compatibility requires mounting ALL leaf atoms manually.

**Proposal:** Implement a 3-tier atom hierarchy (Machine → Project → Session → World) with:
- **Per-session subscriptions** - Components subscribe to exactly what they need
- **idleTTL cleanup** - Atoms automatically dispose after N minutes of zero subscribers
- **Explicit mounting** - HMR-safe pattern that survives Fast Refresh
- **Slice APIs** - `subscribeMachine()`, `subscribeProject()`, `subscribeSession()`, `subscribeWorld()`

**Impact:** Reduced memory usage, better React rendering performance, proper resource cleanup, HMR stability.

**Research Validation:** Multi-phase research (Effect-TS patterns, effect-atom behavior, flow tracing, Zustand audit) validated the core design patterns. Key correction: Registry.subscribe DOES fire on derived atoms; leaf subscription is a performance optimization, not a correctness requirement.

---

## Current Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BACKEND SSE ENDPOINT                           │
│                      /global/event (port discovery)                     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ SSE stream (text/event-stream)
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        WorldSSE.connectToSSE()                          │
│   packages/core/src/world/sse.ts:141-214                               │
│   - fetch() with ReadableStream                                        │
│   - eventsource-parser for SSE parsing                                 │
│   - Effect Stream for backpressure                                     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ Stream<SSEEvent, Error>
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      WorldSSE.handleEvent()                             │
│   packages/core/src/world/sse.ts:584-667                               │
│   - parseSSEEvent() via Effect Schema (sse/parse.ts)                   │
│   - Skip invalid events (Either.isLeft)                                │
│   - Call onEvent callback (logging)                                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ Parsed SSEEvent
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       routeEvent() dispatcher                           │
│   packages/core/src/world/event-router.ts:31-252                       │
│   - Switch on event.type                                               │
│   - Update appropriate atoms (sessionsAtom, messagesAtom, etc.)        │
│   - Map sessions to instances (sessionToInstancePortAtom)              │
│   - Emit session events (session-events.ts singleton)                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ Registry.set(atom, value)
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        effect-atom Registry                             │
│   packages/core/src/world/atoms.ts:807-877                             │
│   - 8 leaf atoms (keepAlive)                                           │
│   - 1 derived atom (worldStateAtom)                                    │
│   - Auto-invalidation on set()                                         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ Registry.subscribe(atom, callback)
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  createMergedWorldStream.subscribe()                    │
│   packages/core/src/world/merged-stream.ts:315-350                     │
│   - Subscribe to ALL leaf atoms                                        │
│   - Fire callback(worldStateAtom) on ANY change                        │
│   - BehaviorSubject pattern (immediate + changes)                      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ callback(WorldState)
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              React: useWorld() via useSyncExternalStore                 │
│   packages/react/src/hooks/use-world.ts:148-173                        │
│   - Singleton stream (Symbol.for on globalThis)                        │
│   - Cache state in globalThis for sync getSnapshot                     │
│   - HMR-safe (survives Fast Refresh)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### File-by-File Trace

#### Layer 1: SSE Event Ingestion

| File | Lines | Key Concepts |
|------|-------|--------------|
| `packages/core/src/world/sse.ts` | 1-766 | SSE connection, discovery, bootstrap, reconnect |
| `packages/core/src/world/event-router.ts` | 1-253 | Event routing, atom updates, session-to-instance mapping |
| `packages/core/src/world/session-events.ts` | 1-136 | Synchronous session events, HMR-safe singleton |

**SSE Connection Flow:**

1. **`WorldSSE.start()` (sse.ts:255-291)** - Sets connection status, starts discovery or direct connection
2. **`WorldSSE.startDiscoveryLoop()` (sse.ts:334-397)** - Uses `Discovery` service (browser vs Node.js), feeds `instancesAtom`
3. **`WorldSSE.connectToServer()` (sse.ts:402-493)** - Bootstrap fetch + SSE stream, auto-reconnect with backoff
4. **`WorldSSE.handleEvent()` (sse.ts:584-667)** - Parse via Effect Schema, delegate to `routeEvent()`

**Event Routing Table (event-router.ts:31-252):**

| Event Type | Atom Updated | Special Handling |
|------------|-------------|------------------|
| `session.created`, `session.updated` | `sessionsAtom` | Map session to instance port |
| `session.deleted` | Remove from `sessionsAtom` | Remove from `sessionToInstancePortAtom` |
| `message.updated` | `messagesAtom` | Mark session as "running" in `statusAtom` |
| `message.part.updated` | `partsAtom` | Mark session as "running" (STRONG SIGNAL) |
| `session.status` | `statusAtom` | Emit via session-events FIRST (synchronous) |
| `session.idle` | `statusAtom` → "idle" | Emit via session-events FIRST |
| `session.error` | `statusAtom` → "error" | Emit via session-events FIRST |

#### Layer 2: State Management (effect-atom)

| File | Lines | Key Concepts |
|------|-------|--------------|
| `packages/core/src/world/atoms.ts` | 807-1148 | effect-atom primitives, derivation logic |

**Leaf Atoms (8 total):**

| Atom | Type | Line | Purpose |
|------|------|------|---------|
| `sessionsAtom` | `Map<string, Session>` | 811 | Session lookup by ID |
| `messagesAtom` | `Map<string, Message>` | 816 | Message lookup by ID |
| `partsAtom` | `Map<string, Part>` | 821 | Part lookup by ID |
| `statusAtom` | `Map<string, SessionStatus>` | 826 | Session status by ID |
| `connectionStatusAtom` | `string union` | 831 | Global connection state |
| `instancesAtom` | `Map<number, Instance>` | 838 | Instance lookup by port |
| `projectsAtom` | `Map<string, Project>` | 843 | Project lookup by worktree |
| `sessionToInstancePortAtom` | `Map<string, number>` | 848 | Session routing map |

**Derived Atom:**

- **`worldStateAtom` (atoms.ts:861-877)** - Computes enriched `WorldState` from leaf atoms via `deriveWorldStateFromData()` (atoms.ts:885-1142)

**Derivation Steps (atoms.ts:885-1142):**

1. Build indexes (`partsByMessage`, `messagesBySession`) - lines 897-936
2. Enrich sessions (join messages+parts, compute `isStreaming`, `contextUsagePercent`, `compactionState`, `lastActivityAt`) - lines 939-1022
3. Sort sessions by `lastActivityAt` descending - lines 1024-1025
4. Compute aggregates (`activeSession`, `activeSessionCount`, `byDirectory`, `stats`) - lines 1027-1044
5. Build instance maps (`instanceByPort`, `instancesByDirectory`, `sessionToInstance`) - lines 1046-1068
6. Enrich projects (join instances+sessions) - lines 1071-1093
7. Return complete `WorldState` - lines 1095-1121

#### Layer 3: Stream Orchestration

| File | Lines | Key Concepts |
|------|-------|--------------|
| `packages/core/src/world/merged-stream.ts` | 1-491 | Stream orchestration, subscription pattern, HMR mount fix |
| `packages/core/src/world/stream.ts` | 1-55 | Public API, delegates to merged-stream |

**Subscription Pattern (merged-stream.ts:315-350):**

```typescript
// CRITICAL: Subscribe to ALL leaf atoms, not derived worldStateAtom
// Registry.subscribe on derived atoms DOESN'T fire when dependencies change
const subscriptions = [
  registry.subscribe(sessionsAtom, () => callback(registry.get(worldStateAtom))),
  registry.subscribe(messagesAtom, () => callback(registry.get(worldStateAtom))),
  registry.subscribe(partsAtom, () => callback(registry.get(worldStateAtom))),
  // ... all 8 leaf atoms
]
```

**HMR Mount Fix (merged-stream.ts:229-239):**

```typescript
// CRITICAL: Mount ALL leaf atoms for Fast Refresh compatibility
const cleanups = [
  registry.mount(sessionsAtom),
  registry.mount(messagesAtom),
  registry.mount(partsAtom),
  // ... all 8 leaf atoms
]
```

#### Layer 4: React Binding

| File | Lines | Key Concepts |
|------|-------|--------------|
| `packages/react/src/hooks/use-world.ts` | 1-206 | React binding, useSyncExternalStore, HMR-safe singleton, SSR config |

**HMR-Safe Singleton (use-world.ts:49-109):**

```typescript
// Survives Fast Refresh via Symbol.for on globalThis
const STREAM_KEY = Symbol.for("opencode.world.stream")

function getOrCreateStream(): WorldStreamHandle {
  if (!globalThis[STREAM_KEY]) {
    globalThis[STREAM_KEY] = createWorldStream(config)
  }
  return globalThis[STREAM_KEY]
}
```

**useSyncExternalStore Pattern (use-world.ts:148-173):**

```typescript
export function useWorld(): WorldState {
  const stream = getOrCreateStream()
  
  return useSyncExternalStore(
    stream.subscribe,      // subscribe function
    () => cachedState,     // getSnapshot (sync, cached)
    () => emptyState       // getServerSnapshot (SSR)
  )
}
```

---

## Current Gaps

### Gap 1: No Idle TTL Management

**Problem:** SSE connections and atoms persist indefinitely, even when no components are subscribed.

**Current Behavior:**
- Connections persist until manual `dispose()` or page navigation
- Atoms with `keepAlive` never clean up
- Multiple browser tabs = multiple connections = memory accumulation

**Impact:**
- Memory leaks in long-running sessions
- Unnecessary SSE connections to servers
- No automatic resource reclamation

**Evidence:**
- `merged-stream.ts:229-239` - Mount ALL atoms, never unmount
- `atoms.ts:811-848` - All atoms use `Atom.keepAlive`

### Gap 2: No Per-Session Subscriptions

**Problem:** Components that display a single session must subscribe to the entire world.

**Current Workaround (use-world.ts):**

```typescript
export function useWorldSession(sessionId: string): EnrichedSession | undefined {
  const world = useWorld() // Subscribes to EVERYTHING
  return world?.sessions.find(s => s.id === sessionId) // Filter in component
}
```

**Impact:**
- Every session page re-renders on ANY world change
- Chat messages from session A re-render session B's page
- O(n) filtering on every render

**Evidence:**
- `use-world.ts:148-173` - Only `useWorld()` exists, no granular hooks
- No `SessionAtom` tier in `atoms.ts`

### Gap 3: Subscription Pattern Complexity

**Problem:** Subscribing to granular slices (per-session, per-project) requires verbose wiring of multiple leaf atoms.

**Current Pattern (merged-stream.ts:322-345):**

```typescript
// Subscribe to ALL leaf atoms to get complete world state
const unsub1 = registry.subscribe(sessionsAtom, () => {
  callback(registry.get(worldStateAtom))
})
const unsub2 = registry.subscribe(messagesAtom, () => {
  callback(registry.get(worldStateAtom))
})
// ... repeat for all 8 leaf atoms
```

**Why This Pattern Works:**
- Registry.subscribe DOES fire on derived atoms when dependencies change (validated via effect-atom source)
- BUT: Subscribing to leaf atoms directly is preferred for performance (avoids recomputing derived state on every leaf change)
- This pattern gives us fine-grained control over when callbacks fire

**Impact:**
- Verbose subscription code
- Must manually wire every leaf atom
- Easy to miss a leaf atom during refactoring
- Need abstraction layer for per-session/per-project subscriptions

**Evidence:**
- `merged-stream.ts:315-350` - Explicit subscription to all 8 atoms
- effect-atom source: setValue → invalidateChildren → notify() fires listeners

### Gap 4: HMR Mount Brittleness

**Problem:** Fast Refresh destroys module scope but preserves `globalThis`. Atoms on `globalThis` need explicit `mount()` to survive.

**Current Fix (merged-stream.ts:229-239):**

```typescript
// Must mount ALL leaf atoms, not just worldStateAtom
const cleanups = [
  registry.mount(sessionsAtom),
  registry.mount(messagesAtom),
  // ... all 8
]
```

**Gotcha:**
- If you add a new leaf atom and forget to mount it, HMR breaks
- No compile-time check for missing mounts
- Easy to introduce regressions

**Evidence:**
- Research document lines 407-416 documents this fix
- `merged-stream.ts:229-239` implements the workaround

---

## Proposed Design

### Validated Patterns

The following patterns have been validated through research and source code analysis:

#### ✅ Effect-TS Scope-Based Finalization

**Pattern:** Use `Effect.acquireRelease` for subscription lifecycle management with automatic cleanup via parent Scope.

**Evidence:**
- Effect-TS best practices document scope cascading cleanup via parent-child tracking
- Hierarchical scopes naturally model the 3-tier hierarchy (Machine → Project → Session)
- `acquireRelease` is the idiomatic Effect pattern for resource management

**Application:**
```typescript
Effect.acquireRelease(
  // Acquire: Create subscription
  Effect.sync(() => {
    const unsub = registry.subscribe(atom, callback)
    return { unsub, timer: null }
  }),
  // Release: Cleanup on scope close
  (resource) => Effect.sync(() => resource.unsub())
)
```

#### ✅ effect-atom Derived Atoms Fire on Dependency Changes

**Correction:** The original ADR claimed `Registry.subscribe` on derived atoms doesn't fire. This is **INCORRECT**.

**Validated Behavior:**
- `Registry.subscribe(derivedAtom, callback)` DOES fire when dependencies change
- Source evidence: `setValue → invalidateChildren → recursive invalidation → notify() fires all listeners`
- Test evidence: effect-atom test suite proves derived listeners fire after batch commit

**Why We Still Subscribe to Leaf Atoms:**
- Performance optimization, not correctness requirement
- Subscribing to leaf atoms gives fine-grained control over when callbacks fire
- Avoids recomputing expensive derived state on every leaf change
- Optional pattern, not mandatory

#### ✅ effect-atom keepAlive and mount Patterns

**keepAlive:** Prevents atom value reset after microtask without active subscription. Makes state permanent.

**mount():** Creates a no-op subscription to keep atom active. Returns cleanup function for disposal. Temporary state preservation.

**Evidence:**
- effect-atom test suite: `keepAlive false` test shows reset after microtask
- HMR pattern: `registry.mount(atom)` keeps atoms alive during Fast Refresh

**Application:**
```typescript
// Permanent state (survives microtasks)
const sessionAtom = Atom.make(initialSession).pipe(Atom.keepAlive)

// Temporary state (HMR survival)
const cleanup = registry.mount(sessionAtom)
// Later: cleanup() to unmount
```

#### ✅ Single Reactive Flow Path

**Validated:** SSE → parseSSEEvent → routeEvent → registry.set(atom) → worldStateAtom invalidation → subscribe callbacks → React re-render

**Evidence:**
- Flow trace analysis confirmed no duplicate paths, no legacy handlers, no branching logic
- One concern: `getWorldRegistry()` export may enable external event routing (needs boundary enforcement)

**Critical Finding:** No Zustand involvement in reactive path (session/message/part events flow through atoms only)

### 3-Tier Atom Dependency Graph

**Terminology Clarification:** effect-atom has ONE registry. The 3-tier "hierarchy" is a DEPENDENCY GRAPH between atoms, not nested registries. All atoms live in the same registry, but they form a directed acyclic graph (DAG) of dependencies.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ATOM DEPENDENCY GRAPH                            │
│                     (all atoms in ONE registry)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  TIER 1: MachineAtom (one per port/instance)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  machineAtoms: Map<port, MachineAtom>                           │   │
│  │  ├── instanceAtom: Instance metadata (pid, startTime, etc.)    │   │
│  │  ├── statusAtom: Connection status for this instance           │   │
│  │  └── idleTTL: Auto-cleanup after 5 min of zero subscriptions   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│              │                                                          │
│              │ dependency edge (ProjectAtom reads MachineAtom)          │
│              ▼                                                          │
│  TIER 2: ProjectAtom (one per worktree/directory)                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  projectAtoms: Map<directory, ProjectAtom>                      │   │
│  │  ├── machineRefs: Set<port> (machines serving this project)    │   │
│  │  ├── sessionsAtom: Sessions for this project only              │   │
│  │  ├── aggregateStatusAtom: Derived from machine statuses        │   │
│  │  └── idleTTL: Auto-cleanup after 5 min of zero subscriptions   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│              │                                                          │
│              │ dependency edge (SessionAtom reads ProjectAtom)          │
│              ▼                                                          │
│  TIER 3: SessionAtom (one per session)                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  sessionAtoms: Map<sessionId, SessionAtom>                      │   │
│  │  ├── sessionAtom: Session metadata                              │   │
│  │  ├── messagesAtom: Messages for this session only              │   │
│  │  ├── partsAtom: Parts for this session only                    │   │
│  │  ├── statusAtom: Status for this session only                  │   │
│  │  ├── enrichedSessionAtom: Derived (messages + parts + status)  │   │
│  │  └── idleTTL: Auto-cleanup after 5 min of zero subscriptions   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│              │                                                          │
│              │ dependency edge (worldStateAtom reads all tiers)         │
│              ▼                                                          │
│  GLOBAL: worldStateAtom (backward compatibility)                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  worldStateAtom: Derived from all ProjectAtoms                  │   │
│  │  └── Preserves current API for existing consumers              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  KEY INSIGHT: Subscription granularity, NOT registry nesting.          │
│  - subscribeSession() subscribes to Tier 3 atoms only                  │
│  - subscribeWorld() subscribes to all leaf atoms                       │
│  - Invalidation propagates UP the dependency edges automatically       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### idleTTL Design

**Concept:** Each tier tracks subscription count. When count reaches 0, start a cleanup timer. Cancel timer if new subscription arrives. Dispose atom after TTL expires.

**Effect-TS Patterns:**

1. **acquireRelease for subscription lifecycle:** Scope-based finalization ensures cleanup cascades through the hierarchy (Machine → Project → Session).
   - Idiomatic Effect pattern for resource management
   - Automatic cleanup via parent Scope (no manual tracking)
   - Composable with Effect services (Discovery, SSE connection)
   - Type-safe resource lifecycle (acquire, use, release)

2. **PubSub for bounded backpressure:** Use `Effect.PubSub` for subscription fan-out with bounded capacity.
   - Prevents slow subscribers from blocking fast producers
   - Configurable capacity (default 16) and strategy (dropping, sliding)
   - Natural fit for SSE → multiple subscribers pattern

### Native effect-atom idleTTL API

**IMPORTANT:** effect-atom has NATIVE idleTTL support. Do NOT implement a custom wrapper.

```typescript
import { Atom, Registry } from "@effect/atom"
import { Duration } from "effect"

// Method 1: Per-atom idleTTL
const sessionAtom = Atom.make(session).pipe(
  Atom.setIdleTTL(Duration.minutes(5))
)

// Method 2: Registry-wide default
const registry = Registry.make({ 
  defaultIdleTTL: 300_000  // 5 minutes in ms
})

// Method 3: Effect Duration for type safety
const registry = Registry.make({ 
  defaultIdleTTL: Duration.toMillis(Duration.minutes(5))
})
```

**⚠️ GOTCHA:** `Atom.setIdleTTL()` implicitly sets `keepAlive: false`. Atoms with idleTTL will:
1. Start a cleanup timer when subscription count reaches 0
2. Dispose after TTL expires if no new subscriptions
3. Lose state after disposal (must re-fetch on next subscription)

**State Machine:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      idleTTL STATE MACHINE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐  subscribe()   ┌─────────────┐                        │
│  │   IDLE      │ ───────────────▶   ACTIVE    │                        │
│  │  (cleanup   │                │ (count > 0) │                        │
│  │   pending)  │ ◀─────────────── └─────────────┘                        │
│  └─────────────┘  unsubscribe()                                        │
│        │          && count == 0                                        │
│        │                                                                │
│        │ TTL expires                                                   │
│        ▼                                                                │
│  ┌─────────────┐                                                       │
│  │  DISPOSED   │  Atom removed from registry                          │
│  │             │  SSE connection closed (if last reference)           │
│  └─────────────┘                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Usage Pattern for Tiered Atoms:**

```typescript
// Session atoms get idleTTL (ephemeral, many of them)
const createSessionAtom = (sessionId: string) => 
  Atom.make(initialSession).pipe(
    Atom.setIdleTTL(Duration.minutes(5))
  )

// World atom stays keepAlive (singleton, always needed)
const worldStateAtom = Atom.derived(registry => {
  // ... derivation logic
}).pipe(Atom.keepAlive)
```

**SSR Considerations:**

```typescript
// Server-side: No timers, no cleanup
const registry = Registry.make({ 
  defaultIdleTTL: typeof window === 'undefined' 
    ? undefined  // No TTL on server
    : 300_000    // 5 min on client
})
```

### HMR Mounting Requirements

**Problem:** effect-atom atoms reset to initial value after microtask if no active subscription. Fast Refresh triggers this.

**Solution:** Use `Symbol.for` pattern for singleton survival + explicit mount on atom creation.

**Pattern:**

```typescript
// packages/core/src/world/atoms.ts

// 1. Registry singleton survives HMR
const REGISTRY_KEY = Symbol.for("opencode.atom.registry")
const getRegistry = (): Registry.Registry => {
  if (!globalThis[REGISTRY_KEY]) {
    globalThis[REGISTRY_KEY] = Registry.make()
  }
  return globalThis[REGISTRY_KEY]
}

// 2. Mount atoms on creation, store cleanup in registry metadata
const createMountedAtom = <T>(factory: () => Atom.Atom<T>): Atom.Atom<T> => {
  const atom = factory()
  const registry = getRegistry()
  
  // Store mount cleanup for later disposal
  const cleanup = registry.mount(atom)
  
  // Track mounted atoms for HMR verification
  if (!globalThis[MOUNTED_ATOMS_KEY]) {
    globalThis[MOUNTED_ATOMS_KEY] = new Set()
  }
  globalThis[MOUNTED_ATOMS_KEY].add(atom)
  
  return atom
}

// 3. Verify all atoms mounted (development only)
if (process.env.NODE_ENV === "development") {
  const LEAF_ATOMS = [sessionsAtom, messagesAtom, partsAtom, statusAtom, ...]
  
  const verifyMounts = () => {
    const mounted = globalThis[MOUNTED_ATOMS_KEY] || new Set()
    const missing = LEAF_ATOMS.filter(a => !mounted.has(a))
    if (missing.length > 0) {
      console.error("[HMR] Missing atom mounts:", missing)
    }
  }
  
  // Run verification after module load
  setTimeout(verifyMounts, 0)
}
```

**Gotcha Documentation:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚠️  PATTERN: Leaf Subscription vs Derived Subscription                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Both patterns work, but have different performance characteristics:   │
│                                                                         │
│  Pattern 1: Subscribe to derived atom (simpler, less efficient)        │
│    registry.subscribe(worldStateAtom, callback)                        │
│    ✓ Callback fires when dependencies change                          │
│    ✗ Recomputes derived state on EVERY leaf change                    │
│    → Use for simple cases with few subscribers                        │
│                                                                         │
│  Pattern 2: Subscribe to leaf atoms (verbose, more efficient)          │
│    registry.subscribe(sessionsAtom, () => {                            │
│      callback(registry.get(worldStateAtom))                            │
│    })                                                                   │
│    ✓ Fine-grained control over when callbacks fire                    │
│    ✓ Can debounce/batch updates before recomputing derived            │
│    → Use for performance-critical paths (we use this)                 │
│                                                                         │
│  With 3-tier hierarchy:                                                │
│    subscribeSession(id, callback)                                       │
│    // Internally subscribes to SessionAtom's leaf atoms                │
│    // Hides the complexity from consumers                              │
│    // Only fires when THIS session changes                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Slice Subscription API

**Public API:**

```typescript
// packages/core/src/world/subscriptions.ts

/**
 * Subscribe to a specific machine (instance) by port.
 * Receives updates only when this machine's state changes.
 * idleTTL: Cleans up after 5 minutes of zero subscribers.
 */
export function subscribeMachine(
  port: number,
  callback: (machine: MachineState) => void
): Unsubscribe

/**
 * Subscribe to a specific project by directory path.
 * Receives updates when any session in this project changes.
 * idleTTL: Cleans up after 5 minutes of zero subscribers.
 */
export function subscribeProject(
  directory: string,
  callback: (project: ProjectState) => void
): Unsubscribe

/**
 * Subscribe to a specific session by ID.
 * Receives updates only when this session's messages/parts/status change.
 * idleTTL: Cleans up after 5 minutes of zero subscribers.
 * 
 * This is the PRIMARY API for session pages.
 */
export function subscribeSession(
  sessionId: string,
  callback: (session: EnrichedSession) => void
): Unsubscribe

/**
 * Subscribe to the entire world state (backward compatibility).
 * Receives updates on ANY change across all machines/projects/sessions.
 * 
 * PREFER subscribeSession() for session-specific views.
 */
export function subscribeWorld(
  callback: (world: WorldState) => void
): Unsubscribe

type Unsubscribe = () => void
```

**React Hook API:**

```typescript
// packages/react/src/hooks/use-session.ts

/**
 * Subscribe to a single session with automatic cleanup.
 * 
 * PREFER THIS over useWorld() for session pages.
 * Only re-renders when THIS session changes, not the entire world.
 */
export function useSession(sessionId: string): EnrichedSession | undefined {
  return useSyncExternalStore(
    (callback) => subscribeSession(sessionId, callback),
    () => getCachedSession(sessionId),
    () => undefined // SSR
  )
}

/**
 * Subscribe to entire world (backward compatibility).
 * 
 * Use this for dashboard views that show all sessions.
 * AVOID for session detail pages.
 */
export function useWorld(): WorldState {
  return useSyncExternalStore(
    subscribeWorld,
    getCachedWorld,
    () => emptyWorldState
  )
}
```

### Event Routing Changes

**Current:** All events route to global atoms.

**Proposed:** Events route to appropriate tier atoms first, then propagate up.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      EVENT ROUTING WITH TIERS                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SSE Event: message.part.updated                                        │
│  Properties: { sessionID: "xyz", messageID: "abc", part: {...} }        │
│                                                                         │
│  1. routeEvent() looks up sessionID → SessionAtom[xyz]                  │
│     └─> Updates SessionAtom.partsAtom with new part                     │
│     └─> SessionAtom.enrichedSessionAtom auto-invalidates                │
│                                                                         │
│  2. SessionAtom propagates to ProjectAtom                               │
│     └─> Lookup session's directory → ProjectAtom[dir]                   │
│     └─> ProjectAtom.sessionsAtom notified of change                    │
│                                                                         │
│  3. ProjectAtom propagates to worldStateAtom                            │
│     └─> Global rollup recomputes                                        │
│                                                                         │
│  Subscribers receive updates at their subscribed tier:                  │
│  - subscribeSession("xyz") → callback fires                             │
│  - subscribeProject("/path/to/project") → callback fires               │
│  - subscribeWorld() → callback fires                                    │
│                                                                         │
│  Subscribers to OTHER sessions/projects do NOT receive callback:        │
│  - subscribeSession("other-session") → NO callback                      │
│  - subscribeProject("/other/project") → NO callback                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Alternatives Considered

### Alternative 1: Zustand-Only Architecture

**Approach:** Use Zustand slices with middleware for SSE sync.

```typescript
const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  messages: {},
  parts: {},
  
  handleSSE: (event) => set((state) => sessionReducer(state, event))
}))
```

**Why Rejected:**
- No typed error handling (try/catch vs Effect errors)
- No automatic resource cleanup (Scope)
- No backpressure for SSE streams
- Manual subscription wiring
- Already migrated to effect-atom (ADR-018)

### Alternative 2: React Context Per-Session

**Approach:** Wrap each session page in its own Context provider with SSE subscription.

```typescript
<SessionProvider sessionId={id}>
  <SessionPage />
</SessionProvider>
```

**Why Rejected:**
- Context provider per-session = complex nesting
- No sharing between components on different pages
- SSE connection per-context (wasteful)
- Doesn't solve idleTTL problem

### Alternative 3: Jotai Atoms

**Approach:** Use Jotai's atom family for per-session atoms.

```typescript
const sessionAtomFamily = atomFamily((sessionId: string) => 
  atom<EnrichedSession | null>(null)
)
```

**Why Rejected:**
- Another library (already use effect-atom)
- No native Effect integration (Effect Stream, Scope, Layer)
- Would require bridging between Jotai and Effect
- effect-atom is maintained by Effect core team

### Alternative 4: effect-atom (Selected)

**Approach:** Extend current effect-atom architecture with 3-tier hierarchy.

**Why Selected:**
- Already in use (ADR-018 implementation)
- Native Effect integration (Stream, Scope, Layer)
- Maintained by Effect core team (tim-smart)
- Composable with existing services
- Supports derived atoms with auto-invalidation

---

## Migration Path

### Phase 0: Legacy Code Cleanup (PREREQUISITE)

**Scope:** Remove dead code and legacy Zustand handlers before implementing new architecture.

**Critical Finding:** Zustand store still has legacy session/message/part management structure, even though these are handled by effect-atom. This creates confusion and potential bugs.

**Dead Code to Remove:**

1. **WorldStore Effect.Service wrappers (atoms.ts:48+)**
   - `WorldStore` class - replaced by effect-atom primitives
   - `WorldStoreServiceInterface` - unused abstraction
   - `WorldStoreService` - Effect.Service wrapper
   - `WorldStoreServiceLive` - Layer implementation

2. **SSE Effect.Service pattern (sse.ts)**
   - `createWorldSSE` - replaced by direct SSE connection
   - `SSEService` - unused Effect.Service
   - `SSEServiceLive` - Layer implementation

3. **Legacy Zustand handlers (packages/react/src/store/store.ts:162-177)**
   - Delete `sessions`, `messages`, `parts` from `DirectoryState`
   - Remove `handleEvent()` cases for session/message/part events
   - Remove binary search operations on session/message/part arrays
   - **KEEP ONLY:** `ready`, `todos`, `modelLimits` (UI-local state)

4. **Internal-only exports**
   - Mark `MergedStreamHandle`, `MergedStreamConfig` as non-exported
   - These are implementation details, not public API

**Checklist:**

- [ ] Delete WorldStore class and Effect.Service wrappers (atoms.ts)
- [ ] Delete SSE Effect.Service pattern (sse.ts)
- [ ] Remove sessions/messages/parts from Zustand store (store.ts)
- [ ] Delete legacy event handlers in Zustand store
- [ ] Mark internal helpers as non-exported
- [ ] Verify no imports of deleted code (typecheck should catch)
- [ ] Update tests to remove references to deleted code
- [ ] **Bootstrap Refactor:** Convert `sse.ts:503-551` direct `registry.set()` calls to `routeEvent()` calls
- [ ] **Bootstrap Refactor:** Emit synthetic events for bootstrap data instead of direct atom mutation

**Files Affected:**
- `packages/core/src/world/atoms.ts` (delete WorldStore class)
- `packages/core/src/world/sse.ts` (delete SSE Service pattern)
- `packages/react/src/store/store.ts` (delete Zustand session/message/part state)

**Backward Compatibility:** 100% - these are dead code paths that aren't used.

**Timeline:** Complete before Phase 1 (blocking).

### Phase 0b: Event Router Unification (PREREQUISITE)

**Scope:** Merge duplicate event routing code into single canonical router.

**Problem:** Two event routing implementations exist:
1. `packages/core/src/world/event-router.ts` - Main router for SSE events
2. `packages/core/src/world/merged-stream.ts:routeEventToRegistry()` - Duplicate logic for pluggable sources

**Changes:**
1. Merge `routeEventToRegistry()` into `event-router.ts`
2. Export single `routeEvent()` function that ALL event sources use
3. Remove duplicate routing logic from `merged-stream.ts`
4. Update all callers to use unified router

**Checklist:**

- [ ] Audit `merged-stream.ts` for routing logic
- [ ] Move any unique routing to `event-router.ts`
- [ ] Delete `routeEventToRegistry()` from `merged-stream.ts`
- [ ] Update imports in all consumers
- [ ] Verify SSE and pluggable sources both use unified router

**Backward Compatibility:** 100% - internal refactor only.

**Timeline:** Can be done in parallel with Phase 0a.

### Phase 1: idleTTL Infrastructure (Non-Breaking)

**Scope:** Enable native idleTTL on tiered atoms without changing public API.

**Changes:**
1. Apply `Atom.setIdleTTL(Duration.minutes(5))` to session-tier atoms
2. Configure registry with `defaultIdleTTL` for new atoms
3. Add metrics for subscription count tracking
4. No public API changes

**Note:** Uses effect-atom's NATIVE idleTTL, not a custom wrapper.

**Backward Compatibility:** 100% - existing `subscribeWorld()` continues to work.

**Files Affected:**
- `packages/core/src/world/atoms.ts` (add `Atom.setIdleTTL()` pipes)
- `packages/core/src/world/merged-stream.ts` (pass registry config)

### Phase 2: SessionAtom Tier (Non-Breaking)

**Scope:** Add per-session atoms without removing global atoms.

**Changes:**
1. Create `SessionAtom` type in `packages/core/src/world/session-atom.ts`
2. Create `sessionAtomRegistry: Map<sessionId, SessionAtom>` (lazy creation)
3. Add `subscribeSession()` public API
4. Route session events to SessionAtom first, then propagate to global

**Backward Compatibility:** 100% - `subscribeWorld()` continues to work, `subscribeSession()` is additive.

**Files Affected:**
- `packages/core/src/world/session-atom.ts` (NEW)
- `packages/core/src/world/subscriptions.ts` (add subscribeSession)
- `packages/core/src/world/event-router.ts` (route to SessionAtom)
- `packages/react/src/hooks/use-session.ts` (add useSession)

### Phase 3: ProjectAtom and MachineAtom Tiers (Non-Breaking)

**Scope:** Complete the 3-tier hierarchy.

**Changes:**
1. Create `ProjectAtom` and `MachineAtom` types
2. Add `subscribeProject()` and `subscribeMachine()` APIs
3. Update event router to propagate through all tiers
4. Add discovery integration (MachineAtom created on server discovery)

**Backward Compatibility:** 100% - all existing APIs preserved.

**Files Affected:**
- `packages/core/src/world/project-atom.ts` (NEW)
- `packages/core/src/world/machine-atom.ts` (NEW)
- `packages/core/src/world/subscriptions.ts` (add APIs)
- `packages/core/src/world/sse.ts` (integrate with discovery)

### Phase 4: Enable idleTTL by Default (Minor Breaking)

**Scope:** Enable idleTTL cleanup with 5-minute default.

**Changes:**
1. Change `idleTTL` config default from `disabled` to `300_000ms`
2. Add deprecation warning for long-lived subscriptions without explicit keepAlive
3. Update documentation

**Breaking Changes:**
- Atoms may be cleaned up after 5 minutes of no subscribers
- Consumers that expect atoms to persist indefinitely need to add `keepAlive: true`

**Migration Guide:**

```typescript
// Before: Implicit persistence
const world = subscribeWorld(callback)

// After: Explicit persistence (if needed)
const world = subscribeWorld(callback, { keepAlive: true })

// Or: Accept cleanup (recommended for most cases)
const world = subscribeWorld(callback) // Cleans up after 5 min idle
```

### Phase 5: Deprecate Direct worldStateAtom Access (Future)

**Scope:** Guide consumers toward slice APIs.

**Changes:**
1. Add deprecation warning to `useWorld()` when used on session pages
2. Recommend `useSession()` in warning message
3. Eventually remove direct `worldStateAtom` access (major version)

**Timeline:** 4-6 months total, with justification:
- Phase 0: +2 weeks (60+ test cases affected by audit, bootstrap refactor complexity)
- Phase 1: 2 weeks (native idleTTL integration)
- Phase 2: 3 weeks (SessionAtom tier, event routing changes)
- Phase 3: +2 weeks (memory profiling before/after benchmarks required)
- Phase 4: 2 weeks (requires runtime keepAlive detection tool built first)
- Phase 5: Begin 3+ months after Phase 2 stabilizes

**Critical Path Dependencies:**
- Phase 0b (bootstrap refactor) must complete before Phase 2 (event routing)
- Phase 3 benchmarks must pass before Phase 4 (enables idleTTL by default)
- Runtime introspection tool needed before Phase 4 deprecation warnings

---

## Testing Strategy

**CRITICAL PRINCIPLE:** NO DOM TESTING. Test core subscription logic and event routing directly. `renderHook` and `render` from `@testing-library` are code smells in this codebase. If the DOM is in the mix, we already lost.

### Test Categories

1. **Core Subscription Tests** - Test subscription/event-router invariants directly
2. **idleTTL Lifecycle Tests** - Test timer behavior, cleanup ordering, race conditions
3. **Tier Routing Tests** - Test event propagation through Session → Project → Machine → World
4. **Contract Tests Only** - If React testing absolutely required, super-thin contract tests without DOM

### 1. Core Subscription Tests

```typescript
// packages/core/src/world/subscriptions.test.ts

describe("subscribeSession", () => {
  let registry: Registry.Registry
  
  beforeEach(() => {
    registry = Registry.make()
  })
  
  it("only fires callback when THIS session changes", () => {
    const callback = vi.fn()
    
    subscribeSession("s1", callback, { registry })
    
    // Emit event for DIFFERENT session
    routeEvent({ 
      type: "message.part.updated", 
      properties: { sessionID: "s2", part: mockPart } 
    }, registry)
    
    expect(callback).not.toHaveBeenCalled()
  })
  
  it("fires callback when subscribed session changes", () => {
    const callback = vi.fn()
    
    subscribeSession("s1", callback, { registry })
    
    // Emit event for THIS session
    routeEvent({ 
      type: "message.part.updated", 
      properties: { sessionID: "s1", part: mockPart } 
    }, registry)
    
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }))
  })
  
  it("unsubscribe stops callbacks", () => {
    const callback = vi.fn()
    
    const unsub = subscribeSession("s1", callback, { registry })
    unsub()
    
    routeEvent({ 
      type: "message.part.updated", 
      properties: { sessionID: "s1", part: mockPart } 
    }, registry)
    
    expect(callback).not.toHaveBeenCalled()
  })
})

describe("subscribeWorld", () => {
  it("fires on ANY session change", () => {
    const registry = Registry.make()
    const callback = vi.fn()
    
    subscribeWorld(callback, { registry })
    
    routeEvent({ 
      type: "message.part.updated", 
      properties: { sessionID: "s1", part: mockPart } 
    }, registry)
    
    routeEvent({ 
      type: "session.created", 
      properties: { session: mockSession2 } 
    }, registry)
    
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
```

### 2. idleTTL Lifecycle Tests (Using Native API)

```typescript
// packages/core/src/world/idle-ttl.test.ts

describe("idleTTL lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  
  afterEach(() => {
    vi.useRealTimers()
  })
  
  it("atom disposes after TTL with zero subscribers", () => {
    const registry = Registry.make({ defaultIdleTTL: 100 })
    const atom = Atom.make("test").pipe(Atom.setIdleTTL(Duration.millis(100)))
    
    const callback = vi.fn()
    const unsub = registry.subscribe(atom, callback)
    
    // Set value while subscribed
    registry.set(atom, "updated")
    expect(registry.get(atom)).toBe("updated")
    
    // Unsubscribe - starts TTL timer
    unsub()
    
    // Before TTL expires
    vi.advanceTimersByTime(99)
    expect(registry.get(atom)).toBe("updated")
    
    // After TTL expires - atom should reset to initial
    vi.advanceTimersByTime(2)
    expect(registry.get(atom)).toBe("test")
  })
  
  it("new subscription cancels TTL timer", () => {
    const registry = Registry.make()
    const atom = Atom.make("test").pipe(Atom.setIdleTTL(Duration.millis(100)))
    
    const unsub1 = registry.subscribe(atom, () => {})
    registry.set(atom, "updated")
    unsub1()
    
    // Start new subscription before TTL expires
    vi.advanceTimersByTime(50)
    const unsub2 = registry.subscribe(atom, () => {})
    
    // TTL should have been cancelled
    vi.advanceTimersByTime(100)
    expect(registry.get(atom)).toBe("updated")
    
    unsub2()
  })
  
  it("multiple subscribers share subscription count", () => {
    const registry = Registry.make()
    const atom = Atom.make("test").pipe(Atom.setIdleTTL(Duration.millis(100)))
    
    registry.set(atom, "updated")
    
    const unsub1 = registry.subscribe(atom, () => {})
    const unsub2 = registry.subscribe(atom, () => {})
    
    unsub1() // Still one subscriber
    
    vi.advanceTimersByTime(200)
    expect(registry.get(atom)).toBe("updated") // Not reset
    
    unsub2() // Zero subscribers, TTL starts
    
    vi.advanceTimersByTime(200)
    expect(registry.get(atom)).toBe("test") // Reset
  })
  
  it("cleanup ordering: child atoms before parent", async () => {
    const cleanupOrder: string[] = []
    const registry = Registry.make()
    
    // Create tiered atoms with cleanup tracking
    const sessionAtom = Atom.make({ id: "s1" }).pipe(
      Atom.setIdleTTL(Duration.millis(100))
    )
    const projectAtom = Atom.derived(r => {
      // Read session to establish dependency
      return { sessions: [r.get(sessionAtom)] }
    })
    
    // Subscribe to both
    const unsub1 = registry.subscribe(sessionAtom, () => {})
    const unsub2 = registry.subscribe(projectAtom, () => {})
    
    // Unsubscribe in order
    unsub1()
    unsub2()
    
    vi.advanceTimersByTime(200)
    
    // Session (leaf) should clean up before project (derived)
    // (Verify via registry state inspection)
  })
})
```

### 3. Tier Routing Tests

```typescript
// packages/core/src/world/event-router.test.ts

describe("tiered event routing", () => {
  let registry: Registry.Registry
  
  beforeEach(() => {
    registry = Registry.make()
  })
  
  it("routes session event to correct session atom", () => {
    const s1Callback = vi.fn()
    const s2Callback = vi.fn()
    
    // Create session atoms for two sessions
    const s1Atom = getOrCreateSessionAtom("s1", registry)
    const s2Atom = getOrCreateSessionAtom("s2", registry)
    
    registry.subscribe(s1Atom.enrichedAtom, s1Callback)
    registry.subscribe(s2Atom.enrichedAtom, s2Callback)
    
    routeEvent({
      type: "message.part.updated",
      properties: { sessionID: "s1", messageID: "m1", part: mockPart }
    }, registry)
    
    expect(s1Callback).toHaveBeenCalled()
    expect(s2Callback).not.toHaveBeenCalled()
  })
  
  it("propagates session change to project tier", () => {
    const projectCallback = vi.fn()
    
    const projectAtom = getOrCreateProjectAtom("/my/project", registry)
    registry.subscribe(projectAtom.sessionsAtom, projectCallback)
    
    routeEvent({
      type: "session.created",
      properties: { session: { ...mockSession, directory: "/my/project" } }
    }, registry)
    
    expect(projectCallback).toHaveBeenCalled()
  })
  
  it("propagates project change to world tier", () => {
    const worldCallback = vi.fn()
    
    registry.subscribe(worldStateAtom, worldCallback)
    
    routeEvent({
      type: "session.created",
      properties: { session: mockSession }
    }, registry)
    
    expect(worldCallback).toHaveBeenCalled()
  })
  
  it("4-layer invalidation chain fires in order", () => {
    const order: string[] = []
    
    const sessionAtom = getOrCreateSessionAtom("s1", registry)
    const projectAtom = getOrCreateProjectAtom("/proj", registry)
    const machineAtom = getOrCreateMachineAtom(3000, registry)
    
    registry.subscribe(sessionAtom.enrichedAtom, () => order.push("session"))
    registry.subscribe(projectAtom.sessionsAtom, () => order.push("project"))
    registry.subscribe(machineAtom.statusAtom, () => order.push("machine"))
    registry.subscribe(worldStateAtom, () => order.push("world"))
    
    routeEvent({
      type: "message.part.updated",
      properties: { sessionID: "s1", part: mockPart }
    }, registry)
    
    // Invalidation fires leaf-to-root
    expect(order).toEqual(["session", "project", "machine", "world"])
  })
})
```

### 4. Mount Verification Tests (HMR Safety)

```typescript
// packages/core/src/world/mount.test.ts

describe("atom mounting", () => {
  it("all leaf atoms are mounted after initialization", () => {
    const registry = Registry.make()
    initializeWorldAtoms(registry)
    
    const LEAF_ATOMS = [
      sessionsAtom, 
      messagesAtom, 
      partsAtom, 
      statusAtom,
      connectionStatusAtom,
      instancesAtom,
      projectsAtom,
      sessionToInstancePortAtom
    ]
    
    LEAF_ATOMS.forEach(atom => {
      // Verify atom is mounted by checking it survives microtask
      registry.set(atom, "test-value")
    })
    
    // Advance past microtask boundary
    return new Promise(resolve => setTimeout(resolve, 0)).then(() => {
      LEAF_ATOMS.forEach(atom => {
        // Mounted atoms retain value
        expect(registry.get(atom)).toBe("test-value")
      })
    })
  })
  
  it("Symbol.for singleton survives between calls", () => {
    const registry1 = getWorldRegistry()
    const registry2 = getWorldRegistry()
    
    expect(registry1).toBe(registry2) // Same instance
  })
  
  it("mounted atoms survive across module scope", () => {
    const registry = getWorldRegistry()
    registry.set(sessionsAtom, new Map([["s1", mockSession]]))
    
    // Simulate what HMR does: clear module state but keep globalThis
    // (Real HMR testing requires browser/E2E)
    
    const registryAgain = getWorldRegistry()
    expect(registryAgain.get(sessionsAtom).get("s1")).toBeDefined()
  })
})

// NOTE: Real HMR validation requires browser/E2E testing.
// These unit tests verify mount invariants, not actual Fast Refresh behavior.
```

### 5. Contract Tests (React, Minimal)

```typescript
// packages/react/src/hooks/use-session.contract.test.ts

/**
 * Contract tests verify the hook conforms to expected interface.
 * NO DOM testing. NO renderHook. Test the subscription contract only.
 */
describe("useSession contract", () => {
  it("exports a function that accepts sessionId", () => {
    expect(typeof useSession).toBe("function")
    expect(useSession.length).toBe(1) // One required param
  })
  
  it("subscription function matches useSyncExternalStore interface", () => {
    // The internal subscribe function must return unsubscribe
    const mockGetSnapshot = vi.fn()
    const mockSubscribe = vi.fn(() => vi.fn()) // Returns unsub
    
    // Verify hook would work with these mocks
    // (Actual hook testing is E2E via browser)
  })
})
```

### Testing Philosophy Summary

| Category | What to Test | Tool |
|----------|-------------|------|
| Core subscription logic | Filter behavior, callback firing | Vitest + Registry |
| idleTTL lifecycle | Timer behavior, cleanup ordering | Vitest + fake timers |
| Event routing | Tier propagation, isolation | Vitest + routeEvent |
| Mount safety | Atom persistence, singleton | Vitest + microtask boundaries |
| React hooks | E2E behavior only | Playwright (NOT renderHook) |

**Golden Rule:** If you need `@testing-library/react`, you're testing at the wrong layer. Test the Core.

---

## Decision

**Adopt the 3-tier hierarchical atom architecture with idleTTL cleanup.**

### Rationale

1. **Performance:** Per-session subscriptions prevent unnecessary re-renders across the app
2. **Resource Management:** idleTTL ensures atoms are cleaned up, preventing memory leaks
3. **Developer Experience:** `useSession()` is simpler than `useWorld()` + filter
4. **Backward Compatibility:** Existing `useWorld()` continues to work throughout migration
5. **Alignment with ADR-018:** Extends effect-atom architecture, doesn't replace it

### Tradeoffs Acknowledged

| Benefit | Cost |
|---------|------|
| Per-session subscriptions | More atoms in memory (one per active session) |
| idleTTL cleanup | Timer overhead, edge cases around cleanup timing |
| 3-tier hierarchy | More complex event routing |
| Explicit mounting | Developer must remember to mount new atoms |

### Risks and Weaknesses

**Risk 1: Phase 0 Blast Radius**

Phase 0 combines dead-code deletion + export boundary changes + bootstrap refactor. This increases blast radius before delivering new value.

*Mitigation:* Consider splitting Phase 0 into:
- **Phase 0a:** Dead code deletion only (safe, reduces cognitive load)
- **Phase 0b:** Bootstrap refactor (`registry.set()` → `routeEvent()`)
- **Phase 0c:** Event router unification

Ship Phase 0a first, validate with typecheck + test suite, then proceed.

**Risk 2: SSR/Runtime Timer Handling**

`Atom.setIdleTTL()` uses real timers. Server-side rendering has no `setTimeout`. Runtime timer cleanup on unmount needs careful design.

*Mitigation:* 
- Add SSR detection (`typeof window === 'undefined'`)
- Disable idleTTL on server
- Add cleanup tests with fake timers to verify no leaks
- Document timer behavior in module JSDoc

**Risk 3: 4-Layer Invalidation Chain Performance**

Session → Project → Machine → World invalidation may cause excessive recomputation on high-frequency events (e.g., streaming parts).

*Mitigation:*
- Add performance benchmarks BEFORE Phase 3 implementation
- Consider batching invalidation within 16ms frame
- Profile derived atom recomputation cost
- Add throttling option to `routeEvent()` for high-frequency event types

**Risk 4: Test Suite Migration**

Phase 0 audit may affect 60+ test cases that reference deleted code or use DOM testing patterns.

*Mitigation:*
- Budget 2 extra weeks for Phase 0 test migration
- Create test migration checklist
- Add lint rule to prevent new `renderHook` usage

**Risk 5: keepAlive Detection at Runtime**

Phase 4 requires detecting which atoms have `keepAlive` vs `idleTTL` at runtime for deprecation warnings.

*Mitigation:*
- Build runtime introspection tool before Phase 4
- Consider adding `__debug` property to atoms for metadata

### Success Criteria

1. **Session pages only re-render on their own session's changes** (measured via React DevTools)
2. **Atoms clean up after 5 minutes of zero subscribers** (measured via memory profiling)
3. **HMR works without subscription loss** (manual testing)
4. **Existing `useWorld()` consumers unaffected** (migration period)
5. **All tests pass** (CI gate)

---

## Outstanding TODOs

The following work items remain after this ADR is implemented:

### 1. SessionStatus Migration (types.ts:153, event-router.ts:168)

**Current State:** SessionStatus is a string union (`"idle" | "running" | "error"`).

**TODO:** Migrate to richer status model that captures streaming state, compaction state, and error details.

**Impact:** Better UI state representation, clearer error handling.

### 2. Unread Tracking (3 duplicate TODOs)

**Locations:**
- TODO comment in types.ts (session enrichment)
- TODO comment in event-router.ts (message handling)
- TODO comment in atoms.ts (derivation logic)

**Current State:** No unread message tracking.

**TODO:** Implement unread count per session, mark-as-read API, local storage persistence.

**Impact:** Chat UI feature parity with other chat apps.

### 3. Compaction Handling (event-router.ts:211)

**Current State:** No special handling for compaction events.

**TODO:** Track compaction state per session, show UI indicator when compaction is in progress.

**Impact:** Better user feedback during long-running compaction operations.

### 4. Diff Tracking (event-router.ts:231)

**Current State:** Messages replaced wholesale on update.

**TODO:** Track message diffs for incremental UI updates, show edit history.

**Impact:** More efficient React rendering for large messages, better UX for message edits.

### 5. Export Boundary Enforcement

**Current State:** `getWorldRegistry()` is exported, allowing external code to bypass event routing.

**TODO:** Make `getWorldRegistry()` internal-only, ensure all state mutations go through `routeEvent()`.

**Impact:** Prevents bugs from direct atom manipulation, enforces single source of truth.

### 6. Bootstrap Refactor (Phase 0b)

**Current State:** `sse.ts:503-551` uses direct `registry.set()` calls for bootstrap data.

**TODO:** Convert to emit synthetic events through `routeEvent()` instead of direct atom mutation.

**Impact:** Ensures ALL state mutations follow the same path, simplifies debugging and testing.

### 7. Event Router Unification (Phase 0c)

**Current State:** Two routing implementations exist (`event-router.ts` and `merged-stream.ts:routeEventToRegistry()`).

**TODO:** Merge into single canonical router in `event-router.ts`.

**Impact:** Single source of truth for event handling, reduces maintenance burden.

---

## References

### Codebase Files

| File | Purpose |
|------|---------|
| `packages/core/src/world/stream.ts:1-55` | Public API, delegates to merged-stream |
| `packages/core/src/world/merged-stream.ts:1-491` | Stream orchestration, subscription pattern, HMR mount fix |
| `packages/core/src/world/atoms.ts:807-1148` | effect-atom primitives, derivation logic |
| `packages/core/src/world/sse.ts:1-766` | SSE connection, discovery, bootstrap, reconnect |
| `packages/core/src/world/event-router.ts:1-253` | Event routing, atom updates, session-to-instance mapping |
| `packages/core/src/world/session-events.ts:1-136` | Synchronous session events, HMR-safe singleton |
| `packages/core/src/world/types.ts:1-257` | WorldState, Instance, EnrichedSession, EnrichedProject |
| `packages/react/src/hooks/use-world.ts:1-206` | React binding, useSyncExternalStore, HMR-safe singleton, SSR config |

### Related ADRs

- **[ADR-018](018-reactive-world-stream.md):** Reactive World Stream - established effect-atom architecture
- **[ADR-016](016-core-layer-responsibility.md):** Core Layer Responsibility - smart boundary pattern
- **[ADR-019 (SSE)](019-sse-event-flow-architecture.md):** SSE Event Flow - single source of truth

### External References

- **effect-atom:** https://github.com/tim-smart/effect-atom
- **React useSyncExternalStore:** https://react.dev/reference/react/useSyncExternalStore
- **Effect Stream:** https://effect.website/docs/stream

---

## Critical Gotchas for Implementers

### 1. effect-atom atoms reset after microtask without keepAlive or subscription

**Impact:** Atoms lose state after `await`/`Promise.resolve()` without active subscription.

**Solution:** Use `Atom.keepAlive` OR maintain subscription during assertions.

**Evidence:** `atoms.ts:811-848` - All production atoms use `.pipe(Atom.keepAlive)`

### 2. Leaf subscription pattern preferred for performance

**Clarification:** Registry.subscribe DOES fire on derived atoms when dependencies change. We subscribe to leaf atoms for performance, not correctness.

**Reasoning:** Subscribing to leaf atoms gives fine-grained control over when callbacks fire, avoiding unnecessary derived state recomputation.

**Pattern:** Subscribe to ALL leaf atoms, manually recompute derived state only when needed.

**Evidence:** 
- effect-atom source: setValue → invalidateChildren → notify() fires listeners
- `merged-stream.ts:322-345` - Current optimization pattern

### 3. Session-to-instance mapping is CRITICAL for correctness

**Impact:** POST to wrong instance = SSE events DON'T APPEAR.

**Solution:** Maintain `sessionToInstancePortAtom` map, route via session lookup.

**Evidence:** `event-router.ts:31-252` - Maps sessions to instances

### 4. Session events must emit SYNCHRONOUSLY FIRST

**Impact:** React batching delays state updates, breaks action hooks.

**Solution:** `emitSessionEvent()` fires BEFORE `registry.set(statusAtom)`.

**Evidence:** `event-router.ts` calls `emitSessionEvent()` before atom updates

### 5. HMR requires mounting ALL leaf atoms

**Impact:** Fast Refresh destroys modules, atoms lose reactivity.

**Solution:** Mount on creation, track in `globalThis[MOUNTED_ATOMS_KEY]`.

**Evidence:** `merged-stream.ts:229-239` - Current mount pattern

### 6. SSR requires initialInstances bypass

**Impact:** Client-side discovery takes ~10 seconds (lsof scan).

**Solution:** Server discovers during build, passes via `window.__OPENCODE`.

**Evidence:** `use-world.ts:75-96` - SSR config handling

---

> "Premature optimization is the root of all evil... but we should not pass up our opportunities in that critical 3%."  
> — Donald Knuth

**Per-session subscriptions are that critical 3%.** Every session page re-renders on every message across the entire app. That's not premature optimization—it's fixing an obvious performance bug.

---

**Next Actions:**

1. **Phase 0a:** Delete dead code (WorldStore, SSE Effect.Service, Zustand legacy handlers)
2. **Phase 0b:** Bootstrap refactor - convert `sse.ts:503-551` to use `routeEvent()`
3. **Phase 0c:** Unify event routers (merge `routeEventToRegistry()` into `event-router.ts`)
4. Run full test suite, migrate any tests using deleted code or DOM patterns
5. **Phase 1:** Enable native `Atom.setIdleTTL()` on session-tier atoms
6. Add metrics for subscription counts to validate design
7. **Phase 2:** Implement SessionAtom tier with feature flag
8. Benchmark performance improvement on session pages
9. Roll out to production behind feature flag
