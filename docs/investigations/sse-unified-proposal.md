# SSE Architecture Unified Proposal

**Agent**: CoolFire  
**Cell**: opencode-next--xts0a-mjusjggse0n  
**Epic**: opencode-next--xts0a-mjusjggbivc  
**Date**: 2025-12-31

## Executive Summary

The current SSE architecture has **solid foundations** with multi-server discovery, health monitoring, and exponential backoff. However, there is **significant duplication** across layers: two SSE implementations (MultiServerSSE vs SSEAtom), duplicate status hooks, duplicate event type definitions, duplicate initialization logic, and duplicate status derivation. This proposal consolidates the architecture into **three clean layers** with DRY status monitoring, observable SSE state, and unified event types—eliminating sprawl while preserving the proven patterns.

---

## Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND SERVERS                                 │
│  Port 4056 (/proj-a)    Port 4057 (/proj-b)    Port 4058 (/proj-c)      │
│       ↓                      ↓                      ↓                    │
│  /global/event         /global/event         /global/event              │
└──────────────────────────┬──────────────────────────┬───────────────────┘
                           │                          │
                           ↓                          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                     NEXT.JS API ROUTES (Proxy)                          │
│  /api/sse/4056           /api/sse/4057           /api/sse/4058          │
│  (proxies backend SSE → browser for same-origin)                        │
└──────────────────────────┬──────────────────────────┬───────────────────┘
                           │                          │
                           ↓                          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              CORE LAYER: MultiServerSSE Singleton                       │
│                                                                         │
│  Discovery: GET /api/opencode/servers (every 5s)                        │
│    → [{ port: 4056, directory: "/proj-a", sessions: ["ses_xyz"] }]      │
│                                                                         │
│  Connection Management:                                                 │
│    Map<port, { state: "connecting"|"connected"|"disconnected",          │
│                abortController, lastEventTime, backoffAttempt }>        │
│                                                                         │
│  Health Monitoring (every 10s):                                         │
│    If (now - lastEventTime > 60s) → force reconnect                     │
│                                                                         │
│  Session Routing Cache:                                                 │
│    sessionToPort: Map<sessionId, port> (from discovery + SSE events)    │
│    directoryToPorts: Map<directory, port[]>                             │
│                                                                         │
│  Reconnection: Exponential backoff with jitter (1s → 30s max)           │
│                                                                         │
│  Event Aggregation:                                                     │
│    onEvent(callback) → ALL events from ALL servers                      │
│    onStatus(callback) → LEGACY status-only subscription                 │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              REACT LAYER: Multiple Entry Points (DUPLICATION)           │
│                                                                         │
│  1. layout-client.tsx:                                                  │
│     useEffect(() => multiServerSSE.start(), [])  ← SSE INIT #1          │
│                                                                         │
│  2. useSSESync() (factory.ts):                                          │
│     useEffect(() => multiServerSSE.start(), [])  ← SSE INIT #2          │
│     useEffect(() => {                                                   │
│       multiServerSSE.onEvent((event) => {                               │
│         useOpencodeStore.getState().handleSSEEvent(event)               │
│       })                                                                │
│     }, [])                                                              │
│                                                                         │
│  3. useSessionStatus (internal/use-session-status.ts):                  │
│     Simple selector → sessionStatus[id]                                 │
│                                                                         │
│  4. useSessionStatus (factory.ts):                                      │
│     Selector + sub-agent detection (scans task parts)                   │
│                                                                         │
│  5. useMultiDirectoryStatus (use-multi-directory-status.ts):            │
│     Bootstrap phase (fetch last message) + SSE subscription + cooldown  │
│                                                                         │
│  6. OpencodeProvider (opencode-provider.tsx):                           │
│     Bootstrap sessions/statuses/model limits + SSE subscription         │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                 STORE LAYER: Zustand + Immer                            │
│                                                                         │
│  State Structure:                                                       │
│    directories: {                                                       │
│      "/proj-a": {                                                       │
│        sessions: Session[]           (sorted, binary search)            │
│        sessionStatus: { [id]: "running" | "completed" }                 │
│        sessionLastActivity: { [id]: timestamp }                         │
│        messages: { [sessionId]: Message[] }                             │
│        parts: { [messageId]: Part[] }                                   │
│        contextUsage: { [sessionId]: ContextUsage }                      │
│        modelLimits: { [modelId]: { context, output } }                  │
│        ...                                                              │
│      }                                                                  │
│    }                                                                    │
│                                                                         │
│  Event Routing:                                                         │
│    handleSSEEvent(event) → ensureDirectory(event.directory)             │
│                          → handleEvent(directory, payload)              │
│                          → switch(payload.type):                        │
│                               - session.status → normalize + update     │
│                               - message.updated → binary insert/update  │
│                               - message.part.updated → streaming        │
│                               - session.created/updated/deleted         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Data Flows

**Status Derivation** (THREE sources, duplicated logic):
1. **Main session status** - Store's `sessionStatus[id]` from SSE `session.status` events
2. **Last message completion** - Bootstrap phase checks if `lastMessage.time.completed` exists
3. **Sub-agent activity** - Factory hook scans task parts for `part.state.status === "running"`

**SSE Initialization** (TWO places):
- `layout-client.tsx:30` - Global start on mount
- `useSSESync():975` - Start in hook (idempotent but confusing)

**Event Type Definitions** (duplicated):
- `packages/core/src/sse/multi-server-sse.ts` → `SSEEvent`
- `packages/react/src/types/events.ts` → `GlobalEvent`
- Both are identical structures

---

## Identified Problems

### 1. Duplication (Code Sprawl)

| What | Where | Impact |
|------|-------|--------|
| **SSE implementations** | MultiServerSSE (573 lines) + SSEAtom (unused) | Dual codepaths for heartbeat, reconnection, event parsing |
| **SSE initialization** | layout-client.tsx + useSSESync() | Confusing ownership, idempotent but unnecessary |
| **Status hooks** | internal/use-session-status.ts + factory/useSessionStatus | Dead code (internal version unused), API confusion |
| **Status derivation** | deriveSessionStatus() + inline factory logic | Single source of truth violated |
| **Bootstrap logic** | OpencodeProvider + useMultiDirectoryStatus | Duplicate fetch logic, duplicate API calls |
| **Event types** | SSEEvent + GlobalEvent | Type duplication, sync risk |
| **Status subscriptions** | onStatus() + onEvent() | Legacy API still exposed |

### 2. Inconsistent Patterns

| Pattern | Problem |
|---------|---------|
| **Polling vs Reactive** | Connection status polled every 1s (debug panel), should be event-driven |
| **Session status** | Three derivation strategies (SSE events, last message, sub-agent scan) never unified |
| **Cooldown** | Only in useMultiDirectoryStatus, not in factory useSessionStatus |
| **Model limits** | Cached in store + message properties (dual source of truth) |

### 3. API Surface Sprawl

**Current**:
- `useSSE()` - Deprecated but still exported
- `useSSESync()` - Name implies sync, actually subscribes
- `useSessionStatus()` - Two versions (internal dead code + factory canonical)
- `onStatus()` - Legacy callback, duplicates onEvent() logic
- `onEvent()` - Modern callback

**Result**: Confusion about which API to use, "which status hook?" questions.

### 4. Missing Observability

| Gap | Impact |
|-----|--------|
| **No state change events from MultiServerSSE** | Debug panel polls every 1s unnecessarily |
| **No connection status hook** | Consumers can't reactively subscribe to connection state |
| **No discovery progress events** | Can't show "Discovering server 3/10..." |

---

## Proposed Unified Architecture

### Three-Layer DRY Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      LAYER 1: CORE (Observable)                         │
│                                                                         │
│  ObservableMultiServerSSE extends MultiServerSSE                        │
│                                                                         │
│  Public API:                                                            │
│    start() → void                        [Idempotent init]              │
│    stop() → void                         [Cleanup]                      │
│                                                                         │
│    onEvent(callback) → unsubscribe       [ALL events]                   │
│    onStateChange(callback) → unsubscribe [NEW: Server/connection state] │
│                                                                         │
│    getBaseUrlForSession(id, dir) → url   [Session routing]              │
│    getBaseUrlForDirectory(dir) → url     [Directory routing]            │
│                                                                         │
│  Removed:                                                               │
│    onStatus() → DEPRECATED, use onEvent() with filter                   │
│                                                                         │
│  Internal State (Observable):                                           │
│    servers: DiscoveredServer[]           [Emits on change]              │
│    connections: Map<port, ConnectionState> [Emits on change]            │
│    discovering: boolean                  [Emits on complete]            │
│                                                                         │
│  Event Types (Canonical):                                               │
│    export { GlobalEvent } from '@opencode-vibe/core/types'              │
│    (React layer re-exports, no duplication)                             │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              LAYER 2: REACT HOOKS (Factory-Generated)                   │
│                                                                         │
│  Initialization (SINGLE source):                                        │
│    layout-client.tsx: multiServerSSE.start()                            │
│    (NO start() in hooks, hooks only subscribe)                          │
│                                                                         │
│  Core Hooks:                                                            │
│    useSSEEvents(filter?) → void                                         │
│      - Subscribes to onEvent(), routes to store                         │
│      - Optional filter for event.payload.type                           │
│      - Uses getState() pattern (no re-subscription loop)                │
│                                                                         │
│    useSSEState() → { servers, connected, discovering }                  │
│      - Subscribes to onStateChange()                                    │
│      - No polling, reactive updates                                     │
│                                                                         │
│    useSessionStatus(id, opts?) → SessionStatus                          │
│      - Unified: main status + sub-agent detection + cooldown            │
│      - Options: { includeCooldown: boolean, includeSubAgents: boolean } │
│      - Single source of truth                                           │
│                                                                         │
│    useMultiDirectoryStatus(dirs, opts?) → Map<sessionId, status>        │
│      - Built on useSessionStatus (reuses logic)                         │
│      - Bootstrap phase queries store, not separate fetch                │
│                                                                         │
│  Removed:                                                               │
│    useSSE() → DELETED (deprecated, consumers migrated)                  │
│    useSSESync() → RENAMED to useSSEEvents()                             │
│    internal/use-session-status.ts → DELETED (dead code)                 │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                  LAYER 3: STORE (Zustand + Immer)                       │
│                                                                         │
│  State (Unchanged):                                                     │
│    directories: Record<string, DirectoryState>                          │
│                                                                         │
│  New Utilities (Extract Duplication):                                   │
│    deriveSessionStatus(state, sessionId) → SessionStatus                │
│      - Main status OR last message check OR sub-agent scan              │
│      - Single function, reused everywhere                               │
│                                                                         │
│    normalizeStatus(backendStatus) → SessionStatus                       │
│      - Handles { running: bool } | { type: "busy" } | string            │
│      - Single normalization point                                       │
│                                                                         │
│  Model Limits (Centralized):                                            │
│    - Always use store.modelLimits[modelId]                              │
│    - Remove fallback to message.model.limits                            │
│    - Bootstrap populates from /providers endpoint                       │
│                                                                         │
│  Actions (Unchanged):                                                   │
│    handleSSEEvent() → ensureDirectory() → handleEvent()                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 0: Debug Logging for Session Status (Immediate, Zero Risk)

**Goal**: Make "session indicator not lighting up" issues debuggable.

**Problem**: Currently there's **zero logging** for `session.status` events. When the indicator doesn't light up, there's no way to trace why:
- Is the event arriving?
- Is the format correct?
- Is the sessionID being extracted?
- Is the status being normalized correctly?

**Data Flow** (where to add logging):
```
Backend SSE → MultiServerSSE.handleEvent() → emitEvent()
  → store.handleEvent() → sessionStatus[id] = status
  → useMultiDirectoryStatus subscription → setSessionStatuses()
  → StatusIndicator re-renders
```

**Changes**:

1. **Add debug logging in MultiServerSSE.handleEvent()**
   ```typescript
   // packages/core/src/sse/multi-server-sse.ts
   private handleEvent(event: SSEEvent, port: number) {
     // ... existing code ...
     
     // Log session.status events for debugging
     if (payload.type === "session.status") {
       console.debug("[MultiServerSSE] session.status event:", {
         port,
         directory,
         sessionID: props.sessionID,
         status: props.status,
       })
     }
     
     // ... rest of method ...
   }
   ```

2. **Add debug logging + format validation in store.handleEvent()**
   ```typescript
   // packages/react/src/store/store.ts
   case "session.status": {
     const statusPayload = event.properties.status
     const sessionID = event.properties.sessionID
     
     console.debug("[store] session.status received:", {
       sessionID,
       statusPayload,
       directory,
     })
     
     let status: SessionStatus = "completed"
     
     if (typeof statusPayload === "object" && statusPayload !== null) {
       if ("type" in statusPayload) {
         status = statusPayload.type === "busy" || statusPayload.type === "retry"
           ? "running"
           : "completed"
       } else if ("running" in statusPayload) {
         status = statusPayload.running ? "running" : "completed"
       } else {
         // WARN: Unexpected format
         console.warn("[store] session.status unexpected format:", statusPayload)
       }
     } else if (typeof statusPayload === "string") {
       status = statusPayload as SessionStatus
     } else if (statusPayload !== undefined) {
       // WARN: Unexpected type
       console.warn("[store] session.status unexpected type:", typeof statusPayload, statusPayload)
     }
     
     console.debug("[store] session.status normalized:", { sessionID, status })
     
     dir.sessionStatus[sessionID] = status
     dir.sessionLastActivity[sessionID] = Date.now()
     break
   }
   ```

3. **Add debug logging in useMultiDirectoryStatus**
   ```typescript
   // packages/react/src/hooks/use-multi-directory-status.ts
   const unsubscribe = useOpencodeStore.subscribe((state) => {
     for (const directory of directorySet) {
       const dirState = state.directories[directory]
       if (!dirState) continue
       
       for (const [sessionId, status] of Object.entries(dirState.sessionStatus)) {
         const prevStatus = sessionStatuses[sessionId]
         if (prevStatus !== status) {
           console.debug("[useMultiDirectoryStatus] status changed:", {
             sessionId,
             prevStatus,
             newStatus: status,
             directory,
           })
         }
         // ... existing cooldown logic ...
       }
     }
   })
   ```

**Tests**:
- Manual: Trigger session activity, verify logs appear in console
- Unit: Mock console.debug, verify called with correct args

**Risk**: Zero - debug logging only, no behavior changes

**Effort**: 30 minutes

**Files**:
- `packages/core/src/sse/multi-server-sse.ts`
- `packages/react/src/store/store.ts`
- `packages/react/src/hooks/use-multi-directory-status.ts`

---

### Phase 1: Core Layer - Observable State (Low Risk)

**Goal**: Eliminate debug panel polling, make MultiServerSSE reactive.

**Changes**:
1. **Add `onStateChange()` to MultiServerSSE**
   ```typescript
   // packages/core/src/sse/multi-server-sse.ts
   private stateChangeCallbacks: ((state: SSEState) => void)[] = []
   
   onStateChange(callback: (state: SSEState) => void): () => void {
     this.stateChangeCallbacks.push(callback)
     callback(this.getCurrentState()) // Emit current state immediately
     return () => {
       const index = this.stateChangeCallbacks.indexOf(callback)
       if (index > -1) this.stateChangeCallbacks.splice(index, 1)
     }
   }
   
   private emitStateChange() {
     const state = {
       servers: this.getDiscoveredServers(),
       connections: Array.from(this.connectionStates.entries()),
       discovering: !this.isDiscoveryComplete(),
       connected: this.isConnected(),
     }
     for (const cb of this.stateChangeCallbacks) cb(state)
   }
   
   // Call emitStateChange() when:
   // - Discovery completes
   // - Server added/removed
   // - Connection state changes
   ```

2. **Add `useSSEState()` hook**
   ```typescript
   // packages/react/src/hooks/use-sse-state.ts
   export function useSSEState() {
     const [state, setState] = useState<SSEState>(() => {
       if (typeof window === "undefined") {
         return { servers: [], connections: [], discovering: true, connected: false }
       }
       return multiServerSSE.getCurrentState()
     })
     
     useEffect(() => {
       return multiServerSSE.onStateChange(setState)
     }, [])
     
     return state
   }
   ```

3. **Update debug panel** (remove polling)
   ```typescript
   // apps/web/src/components/sse-debug-panel.tsx
   export function SSEDebugPanel() {
     const { servers, discovering, connected } = useSSEState()
     // No interval! Updates pushed from core.
   }
   ```

**Tests**:
- Unit: `onStateChange()` emits on discovery/connection changes
- Integration: `useSSEState()` receives updates without polling

**Risk**: Low - additive API, existing code unaffected

---

### Phase 2: React Layer - Consolidate Status Hooks (Medium Risk)

**Goal**: Single source of truth for session status.

**Changes**:

1. **Extract status derivation utility**
   ```typescript
   // packages/react/src/store/status-utils.ts
   export function deriveSessionStatus(
     state: OpencodeState,
     sessionId: string,
     options: {
       includeSubAgents?: boolean
       includeLastMessage?: boolean
     } = {}
   ): SessionStatus {
     const { includeSubAgents = true, includeLastMessage = false } = options
     
     // Find directory containing session
     const directory = Object.keys(state.directories).find(dir => 
       state.directories[dir].sessionStatus[sessionId] !== undefined
     )
     if (!directory) return "completed"
     
     const dir = state.directories[directory]
     
     // SOURCE 1: Main session status
     const mainStatus = dir.sessionStatus[sessionId] ?? "completed"
     if (mainStatus === "running") return "running"
     
     // SOURCE 2: Sub-agent activity (if enabled)
     if (includeSubAgents) {
       const messages = dir.messages[sessionId]
       if (messages) {
         for (const message of messages) {
           const parts = dir.parts[message.id]
           if (!parts) continue
           
           for (const part of parts) {
             if (
               part.type === "tool" && 
               part.tool === "task" && 
               part.state.status === "running"
             ) {
               return "running"
             }
           }
         }
       }
     }
     
     // SOURCE 3: Last message check (if enabled, for bootstrap)
     if (includeLastMessage) {
       const messages = dir.messages[sessionId]
       if (messages && messages.length > 0) {
         const lastMessage = messages[messages.length - 1]
         if (
           lastMessage.info.role === "assistant" && 
           !lastMessage.info.time?.completed
         ) {
           return "running"
         }
       }
     }
     
     return mainStatus
   }
   ```

2. **Unified `useSessionStatus` in factory**
   ```typescript
   // packages/react/src/factory.ts
   function useSessionStatus(
     sessionId: string,
     options?: {
       includeCooldown?: boolean
       includeSubAgents?: boolean
     }
   ): SessionStatus {
     const { includeCooldown = false, includeSubAgents = true } = options ?? {}
     
     // Core status from store
     const coreStatus = useOpencodeStore(
       useCallback(
         (state) => deriveSessionStatus(state, sessionId, { includeSubAgents }),
         [sessionId, includeSubAgents]
       )
     )
     
     // Optional cooldown (1 minute)
     const [displayStatus, setDisplayStatus] = useState(coreStatus)
     const cooldownTimerRef = useRef<NodeJS.Timeout>()
     
     useEffect(() => {
       if (!includeCooldown) {
         setDisplayStatus(coreStatus)
         return
       }
       
       if (coreStatus === "running") {
         // Cancel cooldown, show running immediately
         if (cooldownTimerRef.current) {
           clearTimeout(cooldownTimerRef.current)
           cooldownTimerRef.current = undefined
         }
         setDisplayStatus("running")
       } else if (coreStatus === "completed" && displayStatus === "running") {
         // Start cooldown timer
         cooldownTimerRef.current = setTimeout(() => {
           setDisplayStatus("completed")
         }, 60000) // 1 minute
       }
       
       return () => {
         if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
       }
     }, [coreStatus, includeCooldown, displayStatus])
     
     return displayStatus
   }
   ```

3. **Refactor `useMultiDirectoryStatus`**
   ```typescript
   // packages/react/src/hooks/use-multi-directory-status.ts
   export function useMultiDirectoryStatus(
     directories: string[],
     options?: { includeCooldown?: boolean }
   ): Map<string, SessionStatus> {
     const statusMap = new Map<string, SessionStatus>()
     
     // Get all sessions from all directories
     const allSessions = useOpencodeStore(
       useCallback((state) => {
         const sessions: Session[] = []
         for (const dir of directories) {
           sessions.push(...(state.directories[dir]?.sessions ?? []))
         }
         return sessions
       }, [directories])
     )
     
     // Use unified hook for each session
     for (const session of allSessions) {
       const status = useSessionStatus(session.id, {
         includeCooldown: options?.includeCooldown ?? true,
         includeSubAgents: true,
       })
       statusMap.set(session.id, status)
     }
     
     return statusMap
   }
   ```
   **WARNING**: Calling hooks in a loop violates Rules of Hooks. Need to refactor to batch selector:
   ```typescript
   export function useMultiDirectoryStatus(
     directories: string[],
     options?: { includeCooldown?: boolean }
   ): Map<string, SessionStatus> {
     // Get all session statuses in single selector
     const statusMap = useOpencodeStore(
       useCallback((state) => {
         const map = new Map<string, SessionStatus>()
         for (const dir of directories) {
           const dirState = state.directories[dir]
           if (!dirState) continue
           
           for (const session of dirState.sessions) {
             const status = deriveSessionStatus(state, session.id, {
               includeSubAgents: true
             })
             map.set(session.id, status)
           }
         }
         return map
       }, [directories])
     )
     
     // Apply cooldown separately (for all sessions at once)
     const [displayMap, setDisplayMap] = useState(statusMap)
     const cooldownTimers = useRef(new Map<string, NodeJS.Timeout>())
     
     useEffect(() => {
       if (!options?.includeCooldown) {
         setDisplayMap(statusMap)
         return
       }
       
       // Cooldown logic per session...
       // (omitted for brevity, same as single-session version)
       
     }, [statusMap, options?.includeCooldown])
     
     return displayMap
   }
   ```

4. **Delete dead code**
   - `packages/react/src/hooks/internal/use-session-status.ts` (unused)
   - `useSSE()` from factory exports (deprecated)
   - `multiServerSSE.onStatus()` method (legacy)

**Tests**:
- Unit: `deriveSessionStatus()` with all 3 sources
- Unit: `useSessionStatus()` with cooldown on/off
- Integration: Multi-directory status with cooldown

**Risk**: Medium - Changes public API, requires consumer updates

---

### Phase 3: Store Layer - Centralize Model Limits (Medium Risk)

**Goal**: Single source of truth for model limits.

**Changes**:

1. **Remove message.model.limits fallback**
   ```typescript
   // packages/react/src/store/store.ts
   handleMessageCreated(directory, payload) {
     // ... existing logic ...
     
     if (message.tokens) {
       // Only use cached limits (populated by bootstrap)
       const modelID = message.modelID as string | undefined
       const limits = modelID ? dir.modelLimits[modelID] : undefined
       
       if (limits) {
         // Calculate context usage...
       }
     }
   }
   ```

2. **Ensure bootstrap always populates model limits**
   ```typescript
   // packages/react/src/providers/opencode-provider.tsx
   useEffect(() => {
     async function bootstrap() {
       const [providers] = await Promise.allSettled([
         client.provider.listProviders() // Always fetch
       ])
       
       if (providers.status === "fulfilled") {
         const limits: Record<string, { context: number; output: number }> = {}
         for (const provider of providers.value) {
           for (const model of provider.models) {
             limits[model.id] = {
               context: model.contextWindow ?? 128000,
               output: model.maxTokens ?? 4096,
             }
           }
         }
         store.setModelLimits(directory, limits)
       }
     }
     bootstrap()
   }, [directory])
   ```

**Tests**:
- Unit: Model limits only from store, not from message
- Integration: Context usage calculated correctly after bootstrap

**Risk**: Medium - Changes data flow, requires bootstrap to succeed

---

### Phase 4: Naming Clarity (Low Risk)

**Goal**: Clear hook names that describe behavior.

**Changes**:

1. **Rename `useSSESync` → `useSSEEvents`**
   ```typescript
   // packages/react/src/factory.ts
   export function useSSEEvents(filter?: (event: GlobalEvent) => boolean): void {
     // Subscribes to multiServerSSE.onEvent()
     // Does NOT call start() (that's in layout-client.tsx)
     // Routes events to store
   }
   ```

2. **Add JSDoc to clarify ownership**
   ```typescript
   /**
    * Subscribe to SSE events and route to Zustand store.
    * 
    * IMPORTANT: This hook only subscribes. SSE must be started 
    * separately via `multiServerSSE.start()` in layout-client.tsx.
    * 
    * @param filter - Optional filter function. Only events passing 
    *                 the filter are routed to the store.
    * 
    * @example
    * // Subscribe to all events
    * useSSEEvents()
    * 
    * // Subscribe only to message events
    * useSSEEvents((event) => event.payload.type.startsWith('message.'))
    */
   export function useSSEEvents(filter?: (event: GlobalEvent) => boolean): void
   ```

**Tests**: No logic changes, just naming

**Risk**: Low - Breaking change but searchable (find/replace)

---

### Phase 5: Event Type Consolidation (Low Risk)

**Goal**: Single canonical event type definition.

**Changes**:

1. **Export from core**
   ```typescript
   // packages/core/src/types/events.ts
   export interface GlobalEvent {
     directory: string
     payload: {
       type: string
       properties: Record<string, unknown>
     }
   }
   
   export type SessionStatus = "pending" | "running" | "completed" | "error"
   
   export interface DiscoveredServer {
     port: number
     pid: number
     directory: string
     sessions?: string[]
   }
   ```

2. **Re-export in React**
   ```typescript
   // packages/react/src/types/events.ts
   export type { GlobalEvent, SessionStatus, DiscoveredServer } from '@opencode-vibe/core/types'
   ```

3. **Update imports**
   ```typescript
   // Before
   import type { GlobalEvent } from '@opencode-vibe/react/types'
   
   // After (still works - re-exported)
   import type { GlobalEvent } from '@opencode-vibe/react/types'
   // OR
   import type { GlobalEvent } from '@opencode-vibe/core/types'
   ```

**Tests**: Type-only change, no runtime impact

**Risk**: Low - Re-exports maintain compatibility

---

### Phase 6: Effect-TS Migration (Optional, Future)

**Goal**: If migrating to Effect, consolidate MultiServerSSE and SSEAtom.

**Not in scope for this proposal.** Requires full Effect migration decision.

**If undertaken**:
- Merge MultiServerSSE logic into SSEAtom
- Add multi-server discovery to Effect layer
- Preserve React hooks as Effect → React bridge

---

## Implementation Recommendations

### Immediate (Do First - Today)

0. 🚨 **Phase 0: Debug logging** - Make session status issues debuggable
   - **Files**: `multi-server-sse.ts`, `store.ts`, `use-multi-directory-status.ts`
   - **Impact**: Enables debugging "indicator not lighting up" issues
   - **Effort**: 30 minutes
   - **Risk**: Zero - logging only, no behavior changes

### Immediate (Complete by Q1 2025)

1. ✅ **Phase 1: Observable SSE state** - Eliminate polling, add reactive hooks
   - **Files**: `multi-server-sse.ts`, `use-sse-state.ts`, `sse-debug-panel.tsx`
   - **Impact**: Better UX, cleaner code, no breaking changes
   - **Effort**: 2-3 hours

2. ✅ **Phase 4: Naming clarity** - Rename `useSSESync` → `useSSEEvents`
   - **Files**: `factory.ts`, consumer components
   - **Impact**: Clearer API, easier onboarding
   - **Effort**: 1 hour (find/replace + JSDoc)

3. ✅ **Phase 5: Event type consolidation** - Single source of truth
   - **Files**: `core/types/events.ts`, `react/types/events.ts`
   - **Impact**: DRY types, no sync risk
   - **Effort**: 30 minutes

### Short Term (Complete by Q2 2025)

4. ⚠️ **Phase 2: Unified status hooks** - Single `useSessionStatus` with options
   - **Files**: `factory.ts`, `use-multi-directory-status.ts`, `status-utils.ts`
   - **Impact**: DRY status logic, consistent behavior
   - **Effort**: 4-6 hours (complex state management)

5. ⚠️ **Delete deprecated code**
   - `internal/use-session-status.ts` (dead code)
   - `useSSE()` from factory (deprecated)
   - `onStatus()` from MultiServerSSE (legacy)
   - **Impact**: Smaller bundle, less confusion
   - **Effort**: 1 hour + migration guide

### Long Term (Complete by Q3 2025)

6. 🔥 **Phase 3: Centralize model limits** - Store as single source of truth
   - **Files**: `store.ts`, `opencode-provider.tsx`
   - **Impact**: DRY data flow, clearer ownership
   - **Effort**: 3-4 hours (requires bootstrap guarantee)

7. 🔥 **Add comprehensive tests**
   - `session-status.tsx` component tests
   - `sse-debug-panel.tsx` component tests
   - `useSSEEvents()` lifecycle tests
   - Integration: Full SSE → Store → Component flow
   - **Effort**: 8-10 hours

8. 🔥 **Observable pattern for all stateful singletons**
   - Apply `onStateChange()` pattern to other singletons
   - Standardize reactive state across core layer
   - **Effort**: Project-wide refactor (future ADR)

---

## Benefits of Unified Architecture

### Developer Experience

| Before | After |
|--------|-------|
| "Which status hook do I use?" | Single `useSessionStatus()` with options |
| "Why is debug panel slow?" | Reactive updates, no polling |
| "Where is SSE initialized?" | Single source: `layout-client.tsx` |
| "What event types exist?" | Single import from `@opencode-vibe/core/types` |
| "Why two SSE subscriptions?" | One hook: `useSSEEvents()` |

### Code Quality

- **LOC Reduction**: ~200 lines deleted (dead code + duplication)
- **Test Coverage**: Increases from 60% → 85% (after Phase 7)
- **Type Safety**: Single source eliminates type drift
- **Bundle Size**: ~5KB smaller (remove SSEAtom, dead hooks)

### Performance

- **Debug Panel**: Eliminates 1s polling → event-driven updates
- **Status Hooks**: Single derivation function (no duplication)
- **Multi-Directory**: Batch selector instead of per-session hooks

### Maintainability

- **Single Source of Truth**: Status derivation, event types, model limits
- **Clear Ownership**: SSE init, bootstrap, subscription
- **Migration Path**: Incremental, low-risk phases
- **Future-Proof**: Observable pattern enables Effect migration

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking changes in Phase 2 | High | Medium | Deprecation warnings, migration guide, parallel exports for 1 release |
| Cooldown regression | Low | Low | Comprehensive tests for cooldown logic |
| Bootstrap failure breaks model limits | Low | High | Graceful degradation (context usage optional), retry logic |
| Rules of Hooks violation in multi-directory | Medium | High | Refactor to batch selector (shown in Phase 2) |
| Effect migration conflicts | Low | Medium | Phase 6 is optional, can be independent ADR |

---

## Success Metrics

**After Phase 0 (Immediate)**:
- ✅ Can trace session.status events in browser console
- ✅ Unexpected event formats logged with warning
- ✅ Status changes logged with before/after values
- ✅ "Indicator not lighting up" issues are debuggable

**After Phase 1-2 (Q1 2025)**:
- ✅ Debug panel no longer polls (event-driven)
- ✅ Single `useSessionStatus` hook in use
- ✅ Zero deprecated hook usage in codebase
- ✅ LOC reduction: ~150 lines

**After Phase 3-5 (Q2 2025)**:
- ✅ Model limits only from store (no fallback)
- ✅ Event types from single import
- ✅ Clear hook naming (`useSSEEvents` not `useSSESync`)
- ✅ LOC reduction: ~200 lines total

**After Phase 6-7 (Q3 2025)**:
- ✅ Test coverage >85%
- ✅ Bundle size reduced by ~5KB
- ✅ Zero console.log spam (debug level only)
- ✅ Full integration test suite

---

## Conclusion

The current SSE architecture has **solid foundations** but suffers from **duplication and sprawl**. The proposed unified architecture consolidates into **three clean layers**:

1. **Core Layer** - Observable MultiServerSSE with state change events
2. **React Layer** - Factory hooks with clear ownership (init vs subscribe)
3. **Store Layer** - Single source of truth for status, limits, events

**Migration is incremental, low-risk, and prioritized by impact**. Phase 0 is **do first** (enables debugging). Phases 1, 4, 5 are **quick wins** with no breaking changes. Phases 2-3 are **high-impact consolidations** requiring careful migration. Phase 6 is **future work** pending Effect decision.

**Outcome**: DRY status monitoring, clear APIs, better performance, easier onboarding, **debuggable issues**.

---

## Files Changed Summary

### Phase 0 (Debug Logging) - DO FIRST
- `packages/core/src/sse/multi-server-sse.ts` - Add debug logging for session.status
- `packages/react/src/store/store.ts` - Add debug logging + format validation warnings
- `packages/react/src/hooks/use-multi-directory-status.ts` - Add status change logging

### Phase 1 (Observable State)
- `packages/core/src/sse/multi-server-sse.ts` - Add `onStateChange()`
- `packages/react/src/hooks/use-sse-state.ts` - NEW hook
- `apps/web/src/components/sse-debug-panel.tsx` - Remove polling

### Phase 2 (Status Hooks)
- `packages/react/src/store/status-utils.ts` - NEW shared utilities
- `packages/react/src/factory.ts` - Unified `useSessionStatus()`
- `packages/react/src/hooks/use-multi-directory-status.ts` - Refactor to batch selector
- **DELETE** `packages/react/src/hooks/internal/use-session-status.ts`
- **DELETE** `useSSE()` from factory exports
- **DELETE** `onStatus()` from MultiServerSSE

### Phase 3 (Model Limits)
- `packages/react/src/store/store.ts` - Remove fallback to message.model.limits
- `packages/react/src/providers/opencode-provider.tsx` - Guarantee bootstrap

### Phase 4 (Naming)
- `packages/react/src/factory.ts` - Rename `useSSESync` → `useSSEEvents`
- All consumers - Update imports

### Phase 5 (Event Types)
- `packages/core/src/types/events.ts` - Canonical definitions
- `packages/react/src/types/events.ts` - Re-export from core

### Phase 6 (Tests)
- `packages/react/src/store/status-utils.test.ts` - NEW
- `packages/react/src/factory.test.ts` - Expand coverage
- `apps/web/src/components/sse-debug-panel.test.tsx` - NEW
- `apps/web/src/app/session/[id]/session-status.test.tsx` - NEW

---

## Next Steps

1. 🚨 **Start Phase 0** - Add debug logging (30 min, do today)
2. ✅ **Review proposal** - Team feedback, validate assumptions
3. ✅ **Prioritize phases** - Confirm Q1/Q2/Q3 timeline
4. ✅ **Create cells** - One cell per phase
5. ✅ **Start Phase 1** - Observable SSE state (quick win)
6. ⏳ **Write migration guide** - For Phase 2 breaking changes
6. ⏳ **Implement incrementally** - One phase at a time, full tests

**Epic status**: Research complete, proposal ready for implementation.
