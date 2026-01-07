# ADR-019: Hierarchical Event Subscriptions

**Status:** Proposed  
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

### Gap 3: Registry.subscribe on Derived Atoms

**Problem:** `Registry.subscribe(worldStateAtom, callback)` does NOT fire when leaf atoms change.

**Root Cause:** effect-atom's `Registry.subscribe` only fires when the atom itself is set, not when its dependencies change.

**Current Workaround (merged-stream.ts:322-345):**

```typescript
// Subscribe to ALL leaf atoms, manually recompute worldStateAtom
const unsub1 = registry.subscribe(sessionsAtom, () => {
  callback(registry.get(worldStateAtom)) // Recompute derived state
})
const unsub2 = registry.subscribe(messagesAtom, () => {
  callback(registry.get(worldStateAtom)) // Recompute derived state
})
// ... repeat for all 8 leaf atoms
```

**Impact:**
- Verbose, error-prone subscription code
- Must manually wire every leaf atom
- Easy to miss a leaf atom during refactoring

**Evidence:**
- `merged-stream.ts:315-350` - Explicit subscription to all 8 atoms

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

### 3-Tier Atom Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            TIER HIERARCHY                               │
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
│              │ aggregates by directory                                  │
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
│              │ per-session slices                                       │
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
│              │ global rollup                                            │
│              ▼                                                          │
│  GLOBAL: worldStateAtom (backward compatibility)                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  worldStateAtom: Derived from all ProjectAtoms                  │   │
│  │  └── Preserves current API for existing consumers              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### idleTTL Design

**Concept:** Each tier tracks subscription count. When count reaches 0, start a cleanup timer. Cancel timer if new subscription arrives. Dispose atom after TTL expires.

```typescript
interface IdleTTLConfig {
  ttlMs: number           // Default: 5 minutes (300_000ms)
  onIdle?: () => void     // Callback before cleanup
  onResume?: () => void   // Callback when subscription resumes
}

interface AtomWithIdleTTL<T> {
  atom: Atom.Atom<T>
  subscriptionCount: Atom.Atom<number>
  idleTimer: ReturnType<typeof setTimeout> | null
  
  subscribe(callback: (value: T) => void): () => void
  dispose(): void
}
```

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

**Implementation Sketch:**

```typescript
function createAtomWithIdleTTL<T>(
  atomFactory: () => Atom.Atom<T>,
  config: IdleTTLConfig = { ttlMs: 300_000 }
): AtomWithIdleTTL<T> {
  let atom: Atom.Atom<T> | null = null
  let subscriptionCount = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  
  const getOrCreateAtom = () => {
    if (!atom) {
      atom = atomFactory()
    }
    return atom
  }
  
  const subscribe = (callback: (value: T) => void): (() => void) => {
    // Cancel pending cleanup
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
      config.onResume?.()
    }
    
    subscriptionCount++
    const unsub = registry.subscribe(getOrCreateAtom(), callback)
    
    return () => {
      unsub()
      subscriptionCount--
      
      if (subscriptionCount === 0) {
        // Start cleanup timer
        config.onIdle?.()
        idleTimer = setTimeout(() => {
          dispose()
        }, config.ttlMs)
      }
    }
  }
  
  const dispose = () => {
    if (atom) {
      registry.unmount(atom)
      atom = null
    }
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }
  
  return { get atom() { return getOrCreateAtom() }, subscriptionCount, idleTimer, subscribe, dispose }
}
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
│  ⚠️  CRITICAL GOTCHA: Registry.subscribe on Derived Atoms              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  This DOESN'T work:                                                    │
│    registry.subscribe(worldStateAtom, callback)                        │
│    // callback NEVER fires when leaf atoms change!                     │
│                                                                         │
│  Because:                                                               │
│    Registry.subscribe only fires when the atom ITSELF is set().        │
│    Derived atoms are computed, never set directly.                     │
│    Leaf atom changes invalidate derived atoms but don't trigger        │
│    subscribe callbacks.                                                 │
│                                                                         │
│  This DOES work:                                                        │
│    registry.subscribe(sessionsAtom, () => {                            │
│      callback(registry.get(worldStateAtom))                            │
│    })                                                                   │
│    // Subscribe to leaf, manually get derived                          │
│                                                                         │
│  With 3-tier hierarchy:                                                │
│    subscribeSession(id, callback)                                       │
│    // Internally subscribes to SessionAtom's leaf atoms                │
│    // Hides the complexity from consumers                              │
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

### Phase 1: idleTTL Infrastructure (Non-Breaking)

**Scope:** Add idleTTL wrapper without changing public API.

**Changes:**
1. Create `createAtomWithIdleTTL()` utility in `packages/core/src/world/idle-ttl.ts`
2. Wrap existing leaf atoms with idleTTL (configurable, default disabled)
3. Add metrics for subscription count tracking
4. No public API changes

**Backward Compatibility:** 100% - existing `subscribeWorld()` continues to work.

**Files Affected:**
- `packages/core/src/world/idle-ttl.ts` (NEW)
- `packages/core/src/world/atoms.ts` (wrap atoms)
- `packages/core/src/world/merged-stream.ts` (pass config)

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

**Timeline:** 3+ months after Phase 2 stabilizes.

---

## Testing Strategy

### 1. idleTTL Cleanup Tests

```typescript
// packages/core/src/world/idle-ttl.test.ts

describe("idleTTL cleanup", () => {
  it("starts cleanup timer when subscription count reaches 0", async () => {
    const atom = createAtomWithIdleTTL(() => Atom.make("test"), { ttlMs: 100 })
    
    const unsub = atom.subscribe(() => {})
    expect(atom.idleTimer).toBeNull()
    
    unsub()
    expect(atom.idleTimer).not.toBeNull()
  })
  
  it("cancels cleanup timer on new subscription", async () => {
    const atom = createAtomWithIdleTTL(() => Atom.make("test"), { ttlMs: 100 })
    
    const unsub1 = atom.subscribe(() => {})
    unsub1() // Start timer
    
    const unsub2 = atom.subscribe(() => {}) // Cancel timer
    expect(atom.idleTimer).toBeNull()
    
    unsub2()
  })
  
  it("disposes atom after TTL expires", async () => {
    vi.useFakeTimers()
    const atom = createAtomWithIdleTTL(() => Atom.make("test"), { ttlMs: 100 })
    
    const unsub = atom.subscribe(() => {})
    unsub()
    
    vi.advanceTimersByTime(99)
    expect(atom.atom).not.toBeNull()
    
    vi.advanceTimersByTime(2)
    expect(atom.atom).toBeNull()
    
    vi.useRealTimers()
  })
  
  it("calls onIdle callback when entering idle state", async () => {
    const onIdle = vi.fn()
    const atom = createAtomWithIdleTTL(() => Atom.make("test"), { 
      ttlMs: 100,
      onIdle 
    })
    
    const unsub = atom.subscribe(() => {})
    unsub()
    
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
```

### 2. HMR Survival Tests

```typescript
// packages/core/src/world/hmr.test.ts

describe("HMR survival", () => {
  it("atoms survive module reload via Symbol.for singleton", () => {
    // Simulate module reload
    const registry1 = getRegistry()
    registry1.set(sessionsAtom, new Map([["s1", mockSession]]))
    
    // Clear module cache (simulates Fast Refresh)
    delete globalThis[REGISTRY_KEY]
    
    // Re-import module
    const registry2 = getRegistry()
    
    // Registry is re-created (Symbol.for returns same key)
    expect(registry2).not.toBe(registry1)
    
    // BUT: atoms were mounted, so state should persist
    // (This test documents expected behavior, actual HMR requires browser testing)
  })
  
  it("all leaf atoms are mounted (verification)", () => {
    const mounted = globalThis[MOUNTED_ATOMS_KEY] || new Set()
    const LEAF_ATOMS = [sessionsAtom, messagesAtom, partsAtom, statusAtom, ...]
    
    LEAF_ATOMS.forEach(atom => {
      expect(mounted.has(atom)).toBe(true)
    })
  })
})
```

### 3. Subscription Cascade Tests

```typescript
// packages/core/src/world/subscriptions.test.ts

describe("subscription cascade", () => {
  it("session change triggers session subscriber only", async () => {
    const sessionCallback = vi.fn()
    const worldCallback = vi.fn()
    
    subscribeSession("s1", sessionCallback)
    subscribeSession("s2", vi.fn())
    subscribeWorld(worldCallback)
    
    // Emit event for s1
    routeEvent({
      type: "message.part.updated",
      properties: { sessionID: "s1", part: mockPart }
    })
    
    expect(sessionCallback).toHaveBeenCalledTimes(1)
    expect(worldCallback).toHaveBeenCalledTimes(1)
  })
  
  it("session change does NOT trigger other session subscribers", async () => {
    const s1Callback = vi.fn()
    const s2Callback = vi.fn()
    
    subscribeSession("s1", s1Callback)
    subscribeSession("s2", s2Callback)
    
    routeEvent({
      type: "message.part.updated",
      properties: { sessionID: "s1", part: mockPart }
    })
    
    expect(s1Callback).toHaveBeenCalledTimes(1)
    expect(s2Callback).toHaveBeenCalledTimes(0) // NOT called
  })
  
  it("project change propagates to world subscriber", async () => {
    const projectCallback = vi.fn()
    const worldCallback = vi.fn()
    
    subscribeProject("/path/to/project", projectCallback)
    subscribeWorld(worldCallback)
    
    routeEvent({
      type: "session.created",
      properties: { session: { ...mockSession, directory: "/path/to/project" } }
    })
    
    expect(projectCallback).toHaveBeenCalledTimes(1)
    expect(worldCallback).toHaveBeenCalledTimes(1)
  })
})
```

### 4. React Hook Tests

```typescript
// packages/react/src/hooks/use-session.test.tsx

describe("useSession", () => {
  it("returns undefined for unknown session", () => {
    const { result } = renderHook(() => useSession("unknown"))
    expect(result.current).toBeUndefined()
  })
  
  it("updates when session changes", async () => {
    const { result } = renderHook(() => useSession("s1"))
    
    // Initial state
    expect(result.current).toBeUndefined()
    
    // Emit session creation
    act(() => {
      routeEvent({
        type: "session.created",
        properties: { session: mockSession }
      })
    })
    
    await waitFor(() => {
      expect(result.current).toBeDefined()
      expect(result.current?.id).toBe("s1")
    })
  })
  
  it("does NOT re-render when other session changes", async () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useSession("s1")
    })
    
    // Emit change to different session
    act(() => {
      routeEvent({
        type: "message.updated",
        properties: { sessionID: "s2", message: mockMessage }
      })
    })
    
    // Should NOT cause re-render
    expect(renderCount).toBe(1)
  })
})
```

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

### Success Criteria

1. **Session pages only re-render on their own session's changes** (measured via React DevTools)
2. **Atoms clean up after 5 minutes of zero subscribers** (measured via memory profiling)
3. **HMR works without subscription loss** (manual testing)
4. **Existing `useWorld()` consumers unaffected** (migration period)
5. **All tests pass** (CI gate)

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

### 2. Registry.subscribe on derived atoms DOESN'T fire when dependencies change

**Impact:** `registry.subscribe(worldStateAtom, callback)` never fires.

**Solution:** Subscribe to ALL leaf atoms, manually recompute derived state.

**Evidence:** `merged-stream.ts:322-345` - Current workaround

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

1. Implement Phase 1 (idleTTL infrastructure) as non-breaking change
2. Add metrics for subscription counts to validate design
3. Implement Phase 2 (SessionAtom) with feature flag
4. Benchmark performance improvement on session pages
5. Roll out to production behind feature flag
