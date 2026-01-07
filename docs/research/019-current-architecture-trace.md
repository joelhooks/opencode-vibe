# Current World Stream Architecture Trace

**Research Date:** 2026-01-06  
**Purpose:** Deep trace of existing world stream implementation for ADR-019 rewrite

---

## Architecture Overview (ASCII Diagram)

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

---

## Detailed File Traces

### 1. SSE Event Ingestion Layer

#### `packages/core/src/world/sse.ts`

**Purpose:** Manages server discovery and SSE connections. Feeds events to Registry.

**Key Methods:**

- **`connectToSSE(port: number)` (lines 141-214)**
  - Uses `fetch()` with ReadableStream for SSE connection
  - Browser: `/api/sse/{port}` proxy route
  - CLI/Server: `http://127.0.0.1:{port}/global/event`
  - Parses SSE with `eventsource-parser` library
  - Returns `Stream.Stream<SSEEvent, Error>` (Effect)

- **`WorldSSE.start()` (lines 255-291)**
  - Sets `connectionStatusAtom` to "discovering" or "connecting"
  - If `serverUrl` provided: direct connection (skip discovery)
  - If `initialInstances` provided (SSR): connect immediately, skip discovery
  - Otherwise: starts discovery loop via `Discovery` service

- **`WorldSSE.startDiscoveryLoop()` (lines 334-397)**
  - Uses `Discovery` service (injected Layer from config)
  - Browser: DiscoveryEmptyLive (returns [])
  - Node.js: DiscoveryNodeLive (lsof process scanning)
  - Converts `DiscoveredServer[]` to `Instance[]`
  - Feeds `instancesAtom` (Map<port, Instance>)
  - Connects to new servers, disconnects from dead ones

- **`WorldSSE.connectToServer(port: number)` (lines 402-493)**
  - Marks port as connected
  - Bootstraps initial data: sessions, status, project (parallel fetch)
  - Updates atoms: `sessionsAtom`, `statusAtom`, `projectsAtom`
  - Streams SSE events via `connectToSSE(port)`
  - Auto-reconnect with exponential backoff (max 10 attempts)
  - Updates `instancesAtom` status to "connected"

- **`WorldSSE.handleEvent(event: SSEEvent, sourcePort: number)` (lines 584-667)**
  - Parses event via `parseSSEEvent()` (Effect Schema)
  - Skips invalid events (Either.isLeft)
  - Calls `onEvent` callback (logging/debugging)
  - Delegates to `routeEvent()` for atom updates

**Critical Insights:**
- SSE connection is PULL-based (fetch with ReadableStream)
- Discovery is pluggable via Layer (browser vs Node.js)
- Bootstrap fetches initial state before SSE streaming
- Auto-reconnect with backoff prevents connection storms

---

#### `packages/core/src/world/event-router.ts`

**Purpose:** Routes parsed SSE events to appropriate atoms. Pure, testable, reusable.

**Key Function:**

- **`routeEvent(event: SSEEvent, registry: Registry.Registry, sourcePort: number)` (lines 31-252)**
  - Switch on `event.type` (discriminated union)
  - Updates appropriate atoms via `registry.set()`
  - Maps sessions to instances via `sessionToInstancePortAtom`
  - Emits session events via `emitSessionEvent()` (bypasses React batching)

**Event Routing Table:**

| Event Type | Atom Updated | Special Handling |
|------------|-------------|------------------|
| `session.created`, `session.updated` | `sessionsAtom` (Map) | Map session to instance port |
| `session.deleted` | Remove from `sessionsAtom` | Remove from `sessionToInstancePortAtom` |
| `message.updated` | `messagesAtom` (Map) | Mark session as "running" in `statusAtom` |
| `message.removed` | Remove from `messagesAtom` | None |
| `message.part.updated` | `partsAtom` (Map) | Mark session as "running" (STRONG SIGNAL) |
| `message.part.removed` | Remove from `partsAtom` | None |
| `session.status` | `statusAtom` (Map) | Convert backend status object to string. Emit via session-events FIRST |
| `session.idle` | `statusAtom` → "idle" | Emit via session-events FIRST (synchronous) |
| `session.error` | `statusAtom` → "error" | Emit via session-events FIRST |
| `session.compacted` | None | TODO: Implement compaction handling |
| `session.diff` | None | TODO: Implement diff tracking |

**Critical Insights:**
- Session-to-instance mapping is CRITICAL for correctness (GlobalBus is per-process)
- Session events are emitted SYNCHRONOUSLY FIRST (bypasses React batching)
- Status updates mark sessions as "running" for live activity detection
- Part events have `sessionID` directly (NO message lookup needed)

**File References:**
- `sessionsAtom`: atoms.ts:811
- `messagesAtom`: atoms.ts:816
- `partsAtom`: atoms.ts:821
- `statusAtom`: atoms.ts:826
- `sessionToInstancePortAtom`: atoms.ts:848
- `emitSessionEvent`: session-events.ts:132-135

---

#### `packages/core/src/world/session-events.ts`

**Purpose:** Browser-safe session event emitter. Synchronous, bypasses React batching.

**Architecture:**
- HMR-safe singleton via `Symbol.for("opencode.session.emitter")`
- Minimal emitter with Map<sessionId, Map<event, Set<callback>>>
- O(1) lookup for event emission

**Key Functions:**

- **`subscribeToSessionEvent(sessionId, event, callback)` (lines 116-127)**
  - Adds callback to per-session event set
  - Returns unsubscribe function
  - Example: `subscribeToSessionEvent(sessionId, "idle", () => processNextMessage())`

- **`emitSessionEvent(sessionId, event)` (lines 132-135)**
  - Fires ALL callbacks for session+event synchronously
  - Called by event-router BEFORE updating statusAtom
  - Bypasses React state batching for immediate action hooks

**Critical Insights:**
- Synchronous emission is CRITICAL for action hooks (queue processing)
- Browser-safe (no Node.js dependencies) for client components
- HMR-safe singleton survives Fast Refresh

---

### 2. State Management Layer

#### `packages/core/src/world/atoms.ts`

**Purpose:** effect-atom primitives for reactive state. Auto-invalidation on set().

**Leaf Atoms (8 total):**

| Atom | Type | Line | Purpose |
|------|------|------|---------|
| `sessionsAtom` | Map<string, Session> | 811 | Session lookup by ID |
| `messagesAtom` | Map<string, Message> | 816 | Message lookup by ID |
| `partsAtom` | Map<string, Part> | 821 | Part lookup by ID |
| `statusAtom` | Map<string, SessionStatus> | 826 | Session status by ID |
| `connectionStatusAtom` | string union | 831 | Global connection state |
| `instancesAtom` | Map<number, Instance> | 838 | Instance lookup by port |
| `projectsAtom` | Map<string, Project> | 843 | Project lookup by worktree |
| `sessionToInstancePortAtom` | Map<string, number> | 848 | Session routing map |

**Derived Atoms:**

- **`worldStateAtom` (lines 861-877)**
  - Computes enriched WorldState from leaf atoms
  - Auto-invalidates when ANY leaf atom changes
  - Delegates to `deriveWorldStateFromData()` (pure function)

**Derivation Logic (`deriveWorldStateFromData`, lines 885-1142):**

1. **Build indexes** (lines 897-936):
   - `partsByMessage`: Map<messageID, Part[]>
   - `messagesBySession`: Map<sessionID, EnrichedMessage[]>

2. **Enrich sessions** (lines 939-1022):
   - Join messages + parts
   - Compute `isStreaming` (assistant message without completed time)
   - Compute `contextUsagePercent` (input + output + reasoning + cache.read / usableContext)
   - Compute `compactionState` (detect agent="compaction" messages)
   - Compute `lastActivityAt` (max of message times, session.time.updated)

3. **Sort sessions** (lines 1024-1025):
   - By `lastActivityAt` descending (most recent first)

4. **Compute aggregates** (lines 1027-1044):
   - `activeSession`: Most recently active session
   - `activeSessionCount`: Count of "running" sessions
   - `byDirectory`: Map<directory, EnrichedSession[]>
   - `stats`: { total, active, streaming }

5. **Build instance maps** (lines 1046-1068):
   - `instanceByPort`: Map<port, Instance>
   - `instancesByDirectory`: Map<directory, Instance[]>
   - `sessionToInstance`: Map<sessionID, Instance> (from sessionToInstancePortAtom)

6. **Enrich projects** (lines 1071-1093):
   - Join instances + sessions by directory
   - Compute `activeInstanceCount`, `sessionCount`, `activeSessionCount`
   - Compute `lastActivityAt` across all project sessions

7. **Return WorldState** (lines 1095-1121):
   - All enriched data + maps for O(1) lookup

**Critical Insights:**
- ALL atoms use `Atom.keepAlive` (persist after microtask without subscription)
- Maps for O(1) lookup (NOT arrays with linear search)
- Derivation is PURE (same inputs → same output, no Date.now() in lastUpdated)
- Auto-invalidation on any leaf change (no manual notify())

---

#### Legacy: `WorldStore` class (lines 78-665)

**Status:** DEPRECATED. Preserved for backward compatibility. Will be DELETED after migration.

**Architecture:**
- Class-based with manual `notify()` calls
- Uses binary search for O(log n) updates (lines 321-345)
- Subscriptions managed via Set<callback>
- Session event subscriptions (separate from atom subscriptions)

**Critical Insight:**
- DO NOT USE. Replaced by effect-atom primitives. Only kept for migration overlap.

---

### 3. Stream Orchestration Layer

#### `packages/core/src/world/merged-stream.ts`

**Purpose:** Combines SSE + pluggable sources (swarm-db, etc.) into unified stream.

**Key Function:**

- **`createMergedWorldStream(config: MergedStreamConfig)` (lines 209-490)**

**Initialization (lines 210-262):**
1. Use injected registry OR create new one (line 222)
2. Mount ALL atoms to keep them reactive (lines 229-239)
   - CRITICAL FIX: Mount ALL leaf atoms, not just worldStateAtom
   - Without mount, subscriptions don't fire after HMR
3. Populate `instancesAtom` from `initialInstances` (SSR bypass, lines 241-246)
4. Create WorldSSE instance (line 249-257)
5. Start SSE if not injected (line 260-262)

**Stream Merging (lines 270-303):**
- Check source availability in parallel (Effect.all)
- Filter to available sources
- Merge streams with `Stream.mergeAll` (unbounded concurrency)
- Returns empty stream if no sources available

**Subscription Pattern (lines 315-350):**
- **CRITICAL FIX:** Subscribe to ALL leaf atoms, not derived worldStateAtom
- Registry.subscribe on derived atoms DOESN'T fire when dependencies change
- Must subscribe to each leaf atom and manually trigger callback with derived state
- BehaviorSubject pattern: fire immediately with current state, then on changes

**Async Iterator (lines 366-434):**
- Uses Effect `Scope` + `acquireRelease` for guaranteed cleanup
- Queue pattern for buffering states between yields
- Cleanup guaranteed even on iterator abandonment mid-stream

**Event Consumer for Additional Sources (lines 447-480):**
- Runs in background (fire and forget)
- Routes events to Registry via `routeEventToRegistry()` (lines 78-165)
- Calls `onEvent` callback for all source events (not just SSE)

**Critical Insights:**
- Mounting ALL leaf atoms is REQUIRED for HMR compatibility
- Subscribe to leaf atoms, NOT derived atoms (Registry.subscribe limitation)
- BehaviorSubject pattern ensures immediate state on subscription
- Additional sources (swarm-db) merge seamlessly with SSE

---

#### `packages/core/src/world/stream.ts`

**Purpose:** Public API for world stream. Thin wrapper around merged-stream.

**Key Function:**

- **`createWorldStream(config: WorldStreamConfig)` (lines 42-46)**
  - Delegates to `createMergedWorldStream({ ...config, sources: [] })`
  - No additional sources = SSE-only stream
  - Returns `WorldStreamHandle` (subscribe, getSnapshot, asyncIterator, dispose)

**API Surface:**
```typescript
const stream = createWorldStream({ baseUrl, initialInstances })
const unsub = stream.subscribe((world) => console.log(world))
const snapshot = await stream.getSnapshot()
for await (const world of stream) { /* ... */ }
await stream.dispose()
```

**Critical Insights:**
- Single source of truth: merged-stream.ts
- stream.ts is just a convenience wrapper
- Future extension via merged-stream with additional sources

---

### 4. React Binding Layer

#### `packages/react/src/hooks/use-world.ts`

**Purpose:** React binding to Core's World Stream. No Effect types, promise-based API.

**Singleton Pattern (lines 49-109):**
- HMR-safe singleton via `Symbol.for("opencode.world.stream")` on globalThis
- Survives Fast Refresh module reloads
- Single stream instance shared across all components

**SSR Config (lines 75-96):**
- Reads `window.__OPENCODE` config from OpencodeSSRPlugin
- Converts to `initialInstances` for immediate SSE connection
- Bypasses client-side discovery loop

**useWorld() Hook (lines 148-173):**
- Uses `useSyncExternalStore` (React 18+)
- Caches state from subscribe callback (fires immediately)
- Returns cached state for synchronous getSnapshot requirement
- SSR: returns emptyState

**External Registry Access (lines 189-194):**
- `getWorldRegistry()` for wiring multiServerSSE events
- Used by layout-client.tsx to route events from server

**Critical Insights:**
- HMR-safe singleton is CRITICAL (Fast Refresh destroys modules)
- BehaviorSubject pattern enables synchronous getSnapshot
- SSR config bypasses discovery for instant connection
- No Effect imports (promise-based API only)

---

## Current Gaps & Issues

### 1. HMR Mount Issue (FIXED)

**Problem:** Subscriptions didn't fire after Fast Refresh.

**Root Cause:** Only `worldStateAtom` was mounted. Registry.subscribe on derived atoms DOESN'T fire when dependencies change.

**Fix:** Mount ALL leaf atoms (merged-stream.ts:229-239).

**Verification:** Test with Fast Refresh during active streaming session.

---

### 2. Subscription Pattern Limitation

**Problem:** Registry.subscribe(worldStateAtom, callback) doesn't fire.

**Root Cause:** effect-atom Registry.subscribe on derived atoms doesn't propagate dependency changes.

**Current Workaround:** Subscribe to ALL leaf atoms, manually recompute worldStateAtom in callback (merged-stream.ts:322-345).

**Future Fix (ADR-019):** 3-tier hierarchy with explicit invalidation.

---

### 3. No Idle TTL Management

**Problem:** Streams stay open forever, even when idle.

**Current Behavior:** Connections persist until manual dispose or navigation.

**Future Fix (ADR-019):** MachineAtom with idleTTL auto-cleanup.

---

### 4. No Session-Level Subscriptions

**Problem:** Subscribing to single session requires full world stream subscription.

**Current Workaround:** Use `useWorld()`, filter to session in component.

**Future Fix (ADR-019):** SessionAtom tier with per-session subscribe.

---

### 5. No Durable Streaming

**Problem:** Page refresh loses SSE connection state.

**Current Behavior:** Fresh connection on every page load.

**Future Fix (ADR-019):** React.cache + preload for RSC prefetch.

---

## Recommendations for ADR-019 Rewrite

### 1. Preserve the Good

✅ **Keep:**
- effect-atom primitives (auto-invalidation, derived state)
- SSE connection management (WorldSSE class)
- Event router pattern (pure, testable)
- Session event emitter (synchronous, browser-safe)
- HMR-safe singleton pattern
- Discovery Layer abstraction

### 2. Delete the Bad

❌ **Remove:**
- WorldStore class (lines 78-665 in atoms.ts)
- Binary search updates (replaced by Map O(1) lookup)
- Manual notify() calls (replaced by Registry.set auto-invalidation)

### 3. Add the Missing

🆕 **Implement:**
- **MachineAtom tier** (one per instance/port)
  - idleTTL auto-cleanup
  - Subscription count tracking
  - Discovery integration

- **ProjectAtom tier** (one per worktree)
  - Aggregate across machines
  - Project-level subscriptions
  - Instance failover logic

- **SessionAtom tier** (one per session)
  - Per-session subscriptions
  - Message/part aggregation
  - Context usage tracking

- **Durable streaming**
  - React.cache for SSR prefetch
  - preload() for RSC mounting
  - Hydration without reconnect delay

### 4. Subscription Hierarchy

```
MachineAtom (port-level)
  └─> ProjectAtom (worktree-level)
      └─> SessionAtom (session-level)
          └─> worldStateAtom (global rollup)
```

**Key Principle:** Subscribe at the LOWEST tier needed. Don't subscribe to worldStateAtom if you only need one session.

---

## File-by-File Line References

### packages/core/src/world/

| File | Lines | Key Concepts |
|------|-------|--------------|
| **stream.ts** | 1-55 | Public API, delegates to merged-stream |
| **merged-stream.ts** | 1-491 | Stream orchestration, subscription pattern, HMR mount fix |
| **atoms.ts** | 807-1148 | effect-atom primitives, derivation logic |
| **sse.ts** | 1-766 | SSE connection, discovery, bootstrap, reconnect |
| **event-router.ts** | 1-253 | Event routing, atom updates, session-to-instance mapping |
| **session-events.ts** | 1-136 | Synchronous session events, HMR-safe singleton |
| **types.ts** | 1-257 | WorldState, Instance, EnrichedSession, EnrichedProject |

### packages/react/src/hooks/

| File | Lines | Key Concepts |
|------|-------|--------------|
| **use-world.ts** | 1-206 | React binding, useSyncExternalStore, HMR-safe singleton, SSR config |

---

## Critical Gotchas for Next Worker

1. **effect-atom atoms reset after microtask without keepAlive or subscription.**
   - ALL production atoms use `.pipe(Atom.keepAlive)` (atoms.ts:811-848)
   - Tests must call `registry.mount(atom)` for persistence

2. **Registry.subscribe on derived atoms DOESN'T fire when dependencies change.**
   - Current fix: subscribe to ALL leaf atoms (merged-stream.ts:322-345)
   - ADR-019: 3-tier hierarchy with explicit invalidation

3. **Session-to-instance mapping is CRITICAL for correctness.**
   - GlobalBus is per-process (can't broadcast across instances)
   - POST to wrong instance = SSE events DON'T APPEAR
   - event-router.ts maintains sessionToInstancePortAtom

4. **Session events must emit SYNCHRONOUSLY FIRST.**
   - Bypasses React batching for immediate action hooks
   - event-router.ts calls `emitSessionEvent()` BEFORE `registry.set(statusAtom)`

5. **HMR requires mounting ALL leaf atoms.**
   - Fast Refresh destroys modules but preserves globalThis
   - Atoms on globalThis need mount() to survive (merged-stream.ts:229-239)

6. **SSR requires initialInstances bypass.**
   - Client-side discovery takes ~10 seconds (lsof scan)
   - Server can discover during build, pass via `window.__OPENCODE`
   - Instant SSE connection on page load (use-world.ts:75-96)

---

## Next Steps for ADR-019 Worker

1. **Read this research document** to understand current architecture.
2. **Load ADR-018** (Reactive World Stream) to understand design principles.
3. **Review hierarchical refactor proposal** from coordinator.
4. **Write ADR-019** incorporating:
   - Current architecture (from this doc)
   - Gaps identified (no idle TTL, no session subscriptions, etc.)
   - 3-tier hierarchy design (Machine → Project → Session)
   - Migration path (backward-compatible, incremental)
   - Test strategy (HMR, SSR, multi-instance)

5. **Validate with coordinator** before implementation.

---

**Research complete. Ready for ADR-019 authoring.**
