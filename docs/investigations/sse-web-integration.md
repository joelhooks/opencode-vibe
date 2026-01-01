# SSE Web Integration Investigation

**Agent**: BrightMoon  
**Cell**: opencode-next--xts0a-mjusjggryli  
**Date**: 2025-12-31

## Summary

The web app (`apps/web`) integrates SSE through a multi-layer architecture:
1. **Next.js API Proxy** - `/api/sse/[port]/route.ts` proxies SSE streams from backend servers
2. **Core MultiServerSSE** - Singleton that discovers servers, manages connections, aggregates events
3. **React Factory Hook** - `useSSESync()` subscribes to events and routes to Zustand store
4. **UI Components** - Status indicators and debug panel consume store state

**Key Pattern**: Server discovery → SSE proxy → Multi-server aggregation → Store routing → React subscriptions

---

## 1. SSE API Route Implementation

### Location
`apps/web/src/app/api/sse/[port]/route.ts`

### Purpose
Proxies SSE streams from OpenCode backend servers to the browser. Next.js API route acts as a bridge between localhost backend servers and the frontend.

### Why Proxy?
- **Same-origin requirement**: Browser SSE connections must be same-origin (CORS limitations)
- **Port discovery**: Frontend doesn't know backend ports in advance
- **Multiple servers**: Web app needs to subscribe to multiple OpenCode instances (different directories)

### Implementation Details

```typescript
// Route handler
export async function GET(request: NextRequest, { params }: { params: Promise<{ port: string }> }) {
  const { port } = await params // Next.js 16 async params
  
  // Validation: numeric, range 1024-65535
  if (!port || !/^\d+$/.test(port)) {
    return NextResponse.json({ error: "Invalid port number" }, { status: 400 })
  }
  
  // Proxy to backend
  const response = await fetch(`http://127.0.0.1:${portNum}/global/event`, {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
  
  // Stream response with SSE headers
  return new NextResponse(response.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  })
}
```

### Key Features
- **Port validation**: Rejects non-numeric, <1024, >65535 ports (400 error)
- **Error handling**: Returns 503 if backend unreachable, 500 if no body
- **Pass-through streaming**: Streams backend SSE directly to browser
- **Proper headers**: Sets SSE-specific headers for event streaming

### Test Coverage
File: `apps/web/src/app/api/sse/[port]/route.test.ts` (174 lines)

- ✅ Port validation (non-numeric, out of range, empty)
- ✅ Connection errors (unreachable server, no body, 404)
- ✅ Successful SSE proxying with headers
- ✅ Verifies upstream URL (`http://127.0.0.1:{port}/global/event`)

---

## 2. MultiServerSSE Core (`@opencode-vibe/core/sse`)

### Location
`packages/core/src/sse/multi-server-sse.ts` (573 lines)

### Purpose
**Singleton service that manages SSE connections to multiple OpenCode backend servers.**

Responsibilities:
1. **Server discovery** - Polls `/api/opencode/servers` every 5s
2. **Connection management** - Maintains SSE connections per discovered port
3. **Reconnection logic** - Exponential backoff with jitter (1s → 30s max)
4. **Health monitoring** - Force reconnect if no events for 60s
5. **Event aggregation** - Broadcasts events from all servers to subscribers
6. **Session routing** - Tracks which server owns which session

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    MultiServerSSE                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Discovery Loop (every 5s)                                   │
│    ↓                                                         │
│  GET /api/opencode/servers                                   │
│    → [{ port: 4056, directory: "/proj-a" }]                  │
│    → [{ port: 4057, directory: "/proj-b" }]                  │
│                                                              │
│  Connection Map:                                             │
│    4056 → AbortController (SSE to /api/sse/4056)             │
│    4057 → AbortController (SSE to /api/sse/4057)             │
│                                                              │
│  Event Routing:                                              │
│    Port 4056: {directory: "/proj-a", payload: {...}}         │
│    Port 4057: {directory: "/proj-b", payload: {...}}         │
│         ↓                                                    │
│    onEvent() subscribers (e.g., useSSESync)                  │
│                                                              │
│  Health Check (every 10s):                                   │
│    If no events for 60s → force reconnect                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `start()` | Begin discovery + health monitoring (idempotent) |
| `stop()` | Abort all connections, clear intervals |
| `onEvent(callback)` | Subscribe to ALL events from all servers |
| `onStatus(callback)` | Subscribe to session.status events only (legacy) |
| `getBaseUrlForSession(sessionId, directory)` | Get API URL for a session (session-specific routing) |
| `getBaseUrlForDirectory(directory)` | Get API URL for a directory (fallback) |
| `getDiscoveredServers()` | Get list of servers with connection state |
| `isConnected()` | True if any connection is healthy |
| `isDiscoveryComplete()` | True if at least one server discovered |

### Connection States
- **connecting** - Initial connection attempt or reconnecting
- **connected** - Active SSE stream, receiving events
- **disconnected** - Connection failed or closed

### Reconnection Logic

```typescript
// Exponential backoff with jitter
const BASE_BACKOFF_MS = 1000  // 1s
const MAX_BACKOFF_MS = 30000  // 30s
const JITTER_FACTOR = 0.2     // ±20% randomness

function calculateBackoff(attempt: number): number {
  const baseDelay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS)
  const jitter = baseDelay * Math.random() * JITTER_FACTOR
  return baseDelay + jitter
}

// Attempt 0: 1s + jitter
// Attempt 1: 2s + jitter
// Attempt 2: 4s + jitter
// Attempt 3: 8s + jitter
// Attempt 4: 16s + jitter
// Attempt 5+: 30s + jitter
```

**Why jitter?** Prevents thundering herd when multiple connections fail simultaneously.

### Health Monitoring

```typescript
// Every 10s, check each connection
const HEALTH_TIMEOUT_MS = 60000 // 60s

for (const [port, lastEventTime] of this.lastEventTimes) {
  if (Date.now() - lastEventTime > HEALTH_TIMEOUT_MS) {
    // No events for 60s → connection might be stale
    controller.abort()
    this.backoffAttempts.set(port, 0) // Reset backoff
    this.connectToServer(port) // Immediate reconnect
  }
}
```

**Why 60s?** Mobile Safari (WKWebView) has a 60s idle timeout. Backend sends heartbeats every 30s to keep connections alive, so 60s without events = dead connection.

### Session-to-Port Routing

**Problem**: Web app needs to know which backend server owns a session for API requests.

**Solution**: Track session ownership from SSE events + discovery response.

```typescript
// Pre-populate from discovery (fixes page load routing)
for (const server of servers) {
  if (server.sessions) {
    for (const sessionId of server.sessions) {
      this.sessionToPort.set(sessionId, server.port)
    }
  }
}

// Update from SSE events (tracks ownership as sessions move)
if (sessionID) {
  this.sessionToPort.set(sessionID, port)
}
```

**Why two sources?**
1. **Discovery**: Fixes web→TUI routing on page load (before SSE events arrive)
2. **SSE events**: Tracks session ownership dynamically as messages flow

### Tab Visibility Optimization

```typescript
document.addEventListener("visibilitychange", () => {
  this.paused = document.hidden
  
  // Discover immediately when tab becomes visible
  if (!document.hidden && this.started) {
    this.discover()
  }
})
```

**Why?** Pauses discovery polling when tab hidden, resumes + immediate discovery when visible. Saves CPU/battery on mobile.

---

## 3. session-status.tsx - Status Display Component

### Location
`apps/web/src/app/session/[id]/session-status.tsx` (33 lines)

### Purpose
Displays running/idle badge for a session. Dead simple component - uses `useSessionStatus` hook to subscribe to store.

### Implementation

```tsx
export function SessionStatus({ sessionId }: SessionStatusProps) {
  const status = useSessionStatus(sessionId)
  const running = status === "running"
  
  return (
    <Badge variant={running ? "default" : "secondary"}>
      {running ? "Running" : "Idle"}
    </Badge>
  )
}
```

### How It Works

```
SSE Event
  ↓
multiServerSSE.onEvent()
  ↓
useSSESync() (subscribes to multiServerSSE)
  ↓
store.handleSSEEvent({ directory, payload })
  ↓
store.sessions[i].status = payload.properties.status
  ↓
useSessionStatus(sessionId) (Zustand selector)
  ↓
SessionStatus renders badge
```

### Key Pattern
**No directory prop needed.** Component doesn't care which directory the session belongs to. The store handles cross-directory routing via `ensureDirectory()` logic.

---

## 4. SSE Debug Panel

### Location
`apps/web/src/components/sse-debug-panel.tsx` (203 lines)

### Purpose
Modal panel showing live SSE connection status, discovered servers, and recent events. Opens when clicking SSE health indicator.

### Features

1. **Server List**
   - Shows all discovered servers with connection state (connected/connecting/disconnected)
   - Displays port, directory, connection state, last event time
   - Color-coded status: green (connected), yellow (connecting), red (disconnected)

2. **Recent Events**
   - Shows last 10 SSE events received
   - Displays timestamp, event type, directory
   - Helps debug event flow

3. **Connection Info**
   - Discovery status (in progress / complete)
   - Connected server count

4. **Manual Controls**
   - Reconnect button - calls `multiServerSSE.stop()` then `multiServerSSE.start()`
   - Close button

### Implementation Details

```tsx
// Poll server status every 1s
useEffect(() => {
  const updateStatus = () => {
    const discoveredServers = multiServerSSE.getDiscoveredServers()
    setServers(discoveredServers)
    setDiscovering(!multiServerSSE.isDiscoveryComplete())
  }
  
  updateStatus()
  const interval = setInterval(updateStatus, 1000)
  return () => clearInterval(interval)
}, [])

// Subscribe to SSE events (last 10)
useEffect(() => {
  const unsubscribe = multiServerSSE.onEvent((event) => {
    const newEvent = {
      timestamp: Date.now(),
      directory: event.directory,
      type: event.payload.type,
    }
    setRecentEvents((prev) => [newEvent, ...prev].slice(0, 10))
  })
  return unsubscribe
}, [])
```

### UI States

| Discovery | Connections | UI Display |
|-----------|-------------|------------|
| In progress | 0 | "Discovering..." badge, "No servers discovered yet" |
| Complete | 0 | No badge, "No servers discovered yet" |
| Complete | 1+ | Shows server list with states |

---

## 5. Provider Setup (DEPRECATED)

### Location
`apps/web/src/app/providers.tsx` (39 lines)

### Status
**DEPRECATED** - Shows warning on mount.

### Current Pattern
- **OLD**: `<Providers><App /></Providers>` with context providers
- **NEW**: `OpencodeSSRPlugin` in layout.tsx + factory hooks from `@/app/hooks`

### Migration Complete
All OpenCode-specific providers removed. App uses:
1. **Global SSE init** - `layout-client.tsx` calls `multiServerSSE.start()`
2. **Factory hooks** - `apps/web/src/app/hooks.ts` exports `generateOpencodeHelpers()`
3. **Per-page SSE sync** - `useSSESync()` called in session layout

---

## 6. Layout Integration (SSE Initialization)

### layout.tsx (Server Component)
`apps/web/src/app/layout.tsx`

Root server component. No OpenCode logic. Wraps children in `<LayoutClient>`.

### layout-client.tsx (Client Component)
`apps/web/src/app/layout-client.tsx` (57 lines)

**Global SSE initialization point.**

```tsx
export function LayoutClient({ children }: LayoutClientProps) {
  // Start multiServerSSE globally (idempotent, safe to call multiple times)
  useEffect(() => {
    console.log("[LayoutClient] Starting multiServerSSE")
    multiServerSSE.start()
  }, [])
  
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Suspense fallback={<div>Loading...</div>}>
        {children}
      </Suspense>
      <Toaster />
    </ThemeProvider>
  )
}
```

**Why here?** Root layout client component ensures:
- ✅ SSE starts on all pages (not just session pages)
- ✅ Server discovery happens immediately
- ✅ No cleanup function (layout never unmounts)
- ✅ Idempotent - safe if called multiple times

---

## 7. Factory Hooks Pattern

### Location
- `apps/web/src/app/hooks.ts` - App-specific hook exports
- `packages/react/src/factory.ts` - `generateOpencodeHelpers()` implementation

### Pattern
**Uploadthing-inspired factory hooks.** No context providers needed.

```tsx
// apps/web/src/app/hooks.ts
export const {
  useSession,
  useMessages,
  useSSE,
  useSSESync,
  useSessionStatus,
  // ... 20+ hooks
} = generateOpencodeHelpers()

// components/session.tsx
import { useSessionStatus } from "@/app/hooks"
const status = useSessionStatus(sessionId) // Just works, no provider
```

### useSSESync Implementation

**Location**: `packages/react/src/factory.ts:970-1015`

```typescript
function useSSESync(): void {
  // Start MultiServerSSE singleton (idempotent)
  useEffect(() => {
    console.log("[useSSESync] Starting multiServerSSE")
    multiServerSSE.start()
  }, [])
  
  // Subscribe to ALL events from multiServerSSE
  useEffect(() => {
    console.log("[useSSESync] Subscribing to SSE events (all directories)")
    
    const unsubscribe = multiServerSSE.onEvent((event) => {
      console.log("[useSSESync] Received event for", event.directory, ":", event.payload.type)
      
      // Route to store (getState() for stable reference)
      useOpencodeStore.getState().handleSSEEvent({
        directory: event.directory,
        payload: event.payload,
      })
    })
    
    return () => {
      console.log("[useSSESync] Unsubscribing from SSE events")
      unsubscribe()
    }
  }, [])
}
```

### Key Pattern: No Directory Filtering

**CRITICAL**: `useSSESync` subscribes to ALL events, not filtered by directory.

**Why?** Enables cross-directory updates:
- Project list showing status for multiple OpenCode instances
- Web app monitoring TUI sessions
- Multi-directory dashboards

**How store handles it**: `store.handleSSEEvent()` calls `ensureDirectory()` which auto-creates directory state if needed.

### Zustand Gotcha: getState() vs Hook

```typescript
// ❌ BAD - store reference changes every render → infinite re-subscriptions
const store = useOpencodeStore()
useEffect(() => {
  store.handleSSEEvent(event)
}, [store]) // store is new reference every render

// ✅ GOOD - stable reference
useEffect(() => {
  useOpencodeStore.getState().handleSSEEvent(event)
}, []) // Empty deps, getState() always stable
```

**Reference**: See `docs/investigations/ssr-usessesync-error-2025-12-31.md` for related SSR gotcha.

---

## 8. Full Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND (OpenCode Server)                   │
│                                                                     │
│  Port 4056 (/proj-a)    Port 4057 (/proj-b)                         │
│      ↓                       ↓                                      │
│  /global/event          /global/event                               │
│      ↓                       ↓                                      │
└─────────────────────────────────────────────────────────────────────┘
         ↓                       ↓
         │                       │
┌────────┴───────────────────────┴────────────────────────────────────┐
│                    NEXT.JS API ROUTES (Proxy)                       │
│                                                                     │
│  /api/sse/4056          /api/sse/4057                               │
│      ↓                       ↓                                      │
│  (proxies SSE streams to browser)                                   │
│      ↓                       ↓                                      │
└─────────────────────────────────────────────────────────────────────┘
         ↓                       ↓
         │                       │
┌────────┴───────────────────────┴────────────────────────────────────┐
│              MULTISERVER SSE (Core Singleton)                       │
│                                                                     │
│  Discovery:   /api/opencode/servers → list of ports                 │
│  Connections: Map<port, AbortController>                            │
│  Aggregation: onEvent() → all events from all servers               │
│      ↓                                                              │
│  Event: { directory: "/proj-a", payload: {...} }                    │
│  Event: { directory: "/proj-b", payload: {...} }                    │
│      ↓                                                              │
└─────────────────────────────────────────────────────────────────────┘
         ↓
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                    REACT HOOKS (Factory)                            │
│                                                                     │
│  useSSESync() - subscribes to multiServerSSE.onEvent()              │
│      ↓                                                              │
│  Calls: useOpencodeStore.getState().handleSSEEvent(event)           │
│      ↓                                                              │
└─────────────────────────────────────────────────────────────────────┘
         ↓
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                    ZUSTAND STORE                                    │
│                                                                     │
│  handleSSEEvent({ directory, payload })                             │
│      ↓                                                              │
│  ensureDirectory(directory) - auto-create state if needed           │
│      ↓                                                              │
│  handleEvent(directory, payload) - routes to specific handler       │
│      ↓                                                              │
│  handleSessionStatus / handleMessageCreated / etc.                  │
│      ↓                                                              │
│  Update state: sessions[i].status = { ... }                         │
│      ↓                                                              │
└─────────────────────────────────────────────────────────────────────┘
         ↓
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                    REACT COMPONENTS                                 │
│                                                                     │
│  useSessionStatus(sessionId) - Zustand selector                     │
│      ↓                                                              │
│  <SessionStatus /> - renders badge                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. Duplication & Improvement Opportunities

### 1. SSE Initialization Duplication

**Problem**: SSE initialized in TWO places:
- `layout-client.tsx:30` - `multiServerSSE.start()`
- `useSSESync():975` - `multiServerSSE.start()`

**Why it works**: `start()` is idempotent - safe to call multiple times.

**Should we consolidate?**
- **Option A**: Remove from `layout-client.tsx`, rely on `useSSESync()` only
  - ❌ Requires every page to call `useSSESync()`
  - ❌ Discovery delayed until page mounts
  
- **Option B**: Remove from `useSSESync()`, rely on `layout-client.tsx` only
  - ✅ Single source of truth
  - ✅ Discovery starts immediately
  - ⚠️ `useSSESync()` still needs to subscribe to events
  
- **Option C**: Keep both (current)
  - ✅ Works today, idempotent
  - ⚠️ Confusing - two call sites

**Recommendation**: **Option B** - Remove `multiServerSSE.start()` from `useSSESync()`. Rename hook to `useSSESubscription()` to clarify it's only subscribing, not starting.

### 2. Session Status Hook Sprawl

**Current implementation**: `useSessionStatus` is a Zustand selector.

```typescript
function useSessionStatus(sessionId: string): SessionStatus {
  return useOpencodeStore((state) => {
    const session = state.sessions.find(s => s.id === sessionId)
    return session?.status ?? { type: "idle" }
  })
}
```

**Problem**: Linear search on every render for every session.

**Optimization opportunity**: Add indexed lookup to store.

```typescript
// Store structure
interface OpencodeStore {
  sessions: Session[]
  sessionIndex: Map<string, Session> // NEW
}

// Update on mutations
handleSessionStatus(directory, payload) {
  const session = this.sessionIndex.get(payload.sessionID)
  if (session) {
    session.status = payload.status
  }
}

// Hook becomes O(1)
function useSessionStatus(sessionId: string): SessionStatus {
  return useOpencodeStore((state) => 
    state.sessionIndex.get(sessionId)?.status ?? { type: "idle" }
  )
}
```

**Impact**: Current implementation is fine for <100 sessions. Premature optimization?

### 3. Debug Panel Polling

**Current**: SSE debug panel polls `multiServerSSE.getDiscoveredServers()` every 1s.

```typescript
const interval = setInterval(updateStatus, 1000)
```

**Improvement**: Make `multiServerSSE` observable. Emit events when server list changes.

```typescript
// Core: multiServerSSE
onServerListChange(callback: (servers) => void): () => void

// Debug panel
useEffect(() => {
  const unsubscribe = multiServerSSE.onServerListChange(setServers)
  return unsubscribe
}, [])
```

**Impact**: Reduces unnecessary re-renders, cleaner reactive pattern.

### 4. SSE Event Logging Volume

**Current**: `useSSESync` logs EVERY event.

```typescript
console.log("[useSSESync] Received event for", event.directory, ":", event.payload.type)
```

**Problem**: Console spam during AI streaming (100+ events/sec).

**Improvement**: Log at debug level or add sampling.

```typescript
if (import.meta.env.DEV) {
  console.debug("[useSSESync]", event.directory, event.payload.type)
}
```

---

## 10. Key Learnings (for Hivemind)

### 1. Multi-Server SSE Pattern
Session-to-port routing requires TWO data sources (discovery + events) to handle page load + dynamic updates. Discovery pre-populates cache, SSE events update it.

### 2. Idempotent Start Pattern
Making `multiServerSSE.start()` idempotent allows calling from multiple places without coordination. Prevents "who's responsible for starting SSE?" confusion.

### 3. No Directory Filtering in Subscription Layer
Don't filter SSE events by directory at subscription time. Let the store handle routing. Enables cross-directory features without refactoring.

### 4. Zustand getState() Gotcha
Using `useOpencodeStore()` return value in dependency arrays causes infinite loops. Always use `getState()` for actions inside effects.

### 5. Health Monitoring is Critical
Without health checks, stale connections can sit idle for hours. 60s timeout + 10s checks catch WKWebView timeouts and dead connections.

### 6. Exponential Backoff + Jitter
Prevents thundering herd when multiple connections fail. Jitter is critical - without it, all connections retry at same time.

### 7. Tab Visibility Optimization
Pausing discovery polling when tab hidden saves CPU/battery. Immediate re-discovery on tab visible prevents stale state.

---

## 11. Related Investigations

- **Multi-directory SSE bug**: `mem-094a40c11c842c1f` - useSSESync had directory filter that broke cross-directory updates
- **React.memo metadata.summary**: `mem-fad762b3d05bb643` - Task components need content comparison, not just ID
- **Route priority**: `mem-e5e33a081514fa40` - Dynamic catch-all routes can shadow static routes in Next.js 16
- **SSR useSSESync error**: `docs/investigations/ssr-usessesync-error-2025-12-31.md` - useSSESync called during SSR throws error

---

## 12. Testing Recommendations

### Current Coverage
- ✅ SSE API route (174 lines of tests)
- ✅ MultiServerSSE core (integration tested via factory tests)
- ❌ session-status.tsx (no tests)
- ❌ sse-debug-panel.tsx (no tests)
- ❌ useSSESync (no isolated tests)

### Gaps to Fill

1. **session-status.tsx**
   - Test badge variant (running vs idle)
   - Test with undefined session (should show "Idle")

2. **sse-debug-panel.tsx**
   - Test server list rendering
   - Test reconnect button
   - Test event list updates
   - Test discovery status badge

3. **useSSESync**
   - Test subscription lifecycle (mount → subscribe → unmount → unsubscribe)
   - Test event routing to store
   - Test getState() usage (no re-subscription on store updates)

4. **Integration**
   - Test full flow: Backend event → Proxy → MultiServerSSE → useSSESync → Store → Component
   - Test cross-directory updates
   - Test session-to-port routing (discovery + events)

---

## 13. Unified DRY Solution Opportunities

### Current Duplication Patterns

1. **SSE Initialization**
   - `layout-client.tsx` + `useSSESync()`
   - **Fix**: Single source (layout-client), rename hook to `useSSESubscription()`

2. **Server Discovery Logic**
   - MultiServerSSE polls `/api/opencode/servers`
   - Debug panel uses same endpoint for manual refresh
   - **Fix**: Consolidate in MultiServerSSE, expose `refreshDiscovery()` method

3. **Connection State Display**
   - `sse-debug-panel.tsx` - Full modal with server list
   - `server-status.tsx` - Compact indicator (uses `useServersEffect`)
   - **Fix**: Extract shared `<ServerList>` component

4. **Event Subscription Boilerplate**
   - Every component: `useEffect(() => { const unsub = multiServerSSE.onEvent(...); return unsub }, [])`
   - **Fix**: Create `useSSEEvent(filter, handler)` hook

### Proposed: Unified SSE Debug System

**Goal**: Single source of truth for SSE debugging, observable state, no polling.

```typescript
// packages/core/src/sse/observable-sse.ts
class ObservableMultiServerSSE extends MultiServerSSE {
  private stateChangeCallbacks: ((state: SSEState) => void)[] = []
  
  onStateChange(callback): () => void {
    this.stateChangeCallbacks.push(callback)
    return () => { /* unsubscribe */ }
  }
  
  private emitStateChange() {
    const state = {
      servers: this.getDiscoveredServers(),
      discovering: !this.isDiscoveryComplete(),
      connected: this.isConnected(),
    }
    for (const cb of this.stateChangeCallbacks) cb(state)
  }
}

// packages/react/src/hooks/use-sse-state.ts
export function useSSEState() {
  const [state, setState] = useState(multiServerSSE.getCurrentState())
  
  useEffect(() => {
    return multiServerSSE.onStateChange(setState)
  }, [])
  
  return state
}

// apps/web/src/components/sse-debug-panel.tsx
export function SSEDebugPanel() {
  const { servers, discovering, connected } = useSSEState()
  // No polling! State updates pushed from core.
}
```

**Benefits**:
- ✅ No 1s polling interval
- ✅ Reactive updates
- ✅ Single source of truth
- ✅ Easier testing (mock state changes)

---

## Conclusion

The web app SSE integration is well-architected with clear separation of concerns:
- **Proxy layer** handles same-origin requirements
- **Core layer** manages discovery, connections, health
- **React layer** subscribes and routes to store
- **UI layer** consumes store state

**Strengths**:
- Idempotent patterns prevent coordination issues
- Health monitoring catches stale connections
- Cross-directory support enables multi-instance UX
- Comprehensive test coverage for API route

**Improvement opportunities**:
- Consolidate SSE start logic (remove duplication)
- Make MultiServerSSE observable (eliminate polling)
- Add tests for React components
- Consider session index for O(1) lookups

**Next steps** (for unified solution proposal):
1. Review TUI integration (separate cell)
2. Compare web vs TUI patterns
3. Propose shared abstractions
4. Document migration path
