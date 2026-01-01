# SSE Core Layer Investigation

**Cell**: opencode-next--xts0a-mjusjgghi6j  
**Agent**: QuickDusk  
**Date**: 2025-12-31

## Executive Summary

The SSE core layer (`packages/core/src/sse/`) provides multi-server connection management with automatic discovery, health monitoring, and exponential backoff. It manages SSE connections to multiple OpenCode backend servers (different ports/directories) and aggregates events into a unified stream.

**Key Discovery**: The core layer does NOT filter events by directory - it forwards ALL events from ALL servers. Directory routing happens at the consumer layer (Zustand store via `ensureDirectory()`).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    MULTI-SERVER SSE LAYER                   │
│                                                             │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │  Discovery   │ ───5s──>│ /api/opencode│                 │
│  │  Poller      │         │  /servers    │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                                                   │
│         v                                                   │
│  ┌────────────────────────────────────┐                    │
│  │  Active Servers Map                │                    │
│  │  directoryToPorts: {               │                    │
│  │    "/proj/a": [3000],              │                    │
│  │    "/proj/b": [3001]               │                    │
│  │  }                                 │                    │
│  │  sessionToPort: {                  │                    │
│  │    "ses_abc": 3000,                │                    │
│  │    "ses_xyz": 3001                 │                    │
│  │  }                                 │                    │
│  └────────────────────────────────────┘                    │
│         │                                                   │
│         v                                                   │
│  ┌────────────┬────────────┬────────────┐                  │
│  │  SSE:3000  │  SSE:3001  │  SSE:3002  │                  │
│  │ (connected)│(connecting)│(disconnected)                 │
│  └────────────┴────────────┴────────────┘                  │
│         │           │           │                           │
│         v           v           v                           │
│  ┌──────────────────────────────────────┐                  │
│  │    Event Aggregation + Callbacks     │                  │
│  │  - onEvent(event)  [ALL events]      │                  │
│  │  - onStatus(update) [status only]    │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
         │
         v
   Consumer (React/store)
   handles directory routing
```

---

## 1. SSE Event Types (from store handlers)

The core layer forwards raw `GlobalEvent` objects. Event types discovered in the wild:

### Session Events
- `session.created` - New session created
- `session.updated` - Session metadata changed (title, time)
- `session.status` - Session status update (running, idle, error)
- `session.diff` - Session diff available
- `session.deleted` - Session removed
- `session.compacted` - Compaction completed

### Message Events
- `message.updated` - Message created/modified
- `message.removed` - Message deleted

### Part Events (Streaming Content)
- `message.part.updated` - Streaming part update (AI response chunks)
- `message.part.removed` - Part deleted

### Health Events
- `heartbeat` - 30s keepalive (logged at debug level)

---

## 2. Connection Management

### Discovery Flow

1. **Poll `/api/opencode/servers`** (every 5 seconds)
2. **Response**: Array of `DiscoveredServer`
   ```typescript
   {
     port: number,
     pid: number,
     directory: string,
     sessions?: string[] // NEW: session ownership pre-population
   }
   ```
3. **Session Cache Pre-population**: Discovery response now includes `sessions` array, which pre-populates `sessionToPort` cache BEFORE SSE events arrive. This fixes web→TUI routing on page load.

4. **Connection Lifecycle**:
   - New servers → `connectToServer(port)`
   - Dead servers → abort + cleanup
   - Session cache cleanup → remove entries for dead servers

### Connection States

Three states tracked per port:

| State | Meaning |
|-------|---------|
| `connecting` | Fetch in progress, waiting for stream |
| `connected` | Stream open, events flowing |
| `disconnected` | Connection failed or stopped |

**Observability**: `getConnectionStatus()` returns `Map<port, ConnectionState>` for debugging.

---

## 3. Multi-Server Architecture

### Directory-to-Port Mapping

```typescript
// Multiple servers can run for same directory (unlikely but supported)
directoryToPorts: Map<string, number[]>

// Example:
{
  "/proj/a": [3000],
  "/proj/b": [3001, 3002] // Two servers for same dir
}
```

### Session-to-Port Cache

**Purpose**: Route API requests to the correct backend server.

**Population**:
1. **Discovery pre-population** (NEW): `sessions` field in discovery response
2. **Event-based tracking**: When events arrive, extract `sessionID` from properties and cache the port

**Cleanup**: Stale entries removed when servers die during next discovery.

**Lookup Strategy**:
```typescript
getBaseUrlForSession(sessionId, directory):
  1. Check sessionToPort cache (preferred - knows exact server)
  2. Fallback to directoryToPorts[directory][0] (first server for dir)
  3. Return undefined if directory unknown
```

**Why this matters**: Web UI sending messages needs to know which backend port owns a session. Before this cache, all requests went to the first discovered server, breaking multi-TUI setups.

---

## 4. Health Monitoring

### Heartbeat Timeout

- **Timeout**: 60 seconds without events → force reconnect
- **Check interval**: Every 10 seconds
- **Rationale**: Backend sends heartbeat every 30s. 60s = 2x safety margin.
- **Action**: Abort connection, reset backoff, reconnect immediately

### Connection Activity Tracking

```typescript
lastEventTimes: Map<port, timestamp>

// Updated on:
// - Connection established
// - Any SSE event received (including heartbeat)
```

**Health check loop**:
```typescript
for (port, lastEventTime) in lastEventTimes:
  if (Date.now() - lastEventTime > 60000):
    abort connection
    reset backoff to 0
    reconnect immediately
```

---

## 5. Reconnection Strategy

### Exponential Backoff

```typescript
BASE_BACKOFF_MS = 1000   // 1 second
MAX_BACKOFF_MS = 30000   // 30 seconds
JITTER_FACTOR = 0.2      // Add 0-20% jitter

calculateBackoff(attempt):
  baseDelay = min(1000 * 2^attempt, 30000)
  jitter = baseDelay * random() * 0.2
  return baseDelay + jitter

// Sequence:
// attempt 0: 1s + jitter (1-1.2s)
// attempt 1: 2s + jitter (2-2.4s)
// attempt 2: 4s + jitter (4-4.8s)
// attempt 3: 8s + jitter (8-9.6s)
// attempt 4: 16s + jitter (16-19.2s)
// attempt 5+: 30s + jitter (30-36s) [CAPPED]
```

### Backoff Reset Conditions

Backoff counter reset to 0 when:
1. **Successful connection** - stream opens, events start flowing
2. **Health-triggered reconnect** - stale connection detected by health monitor

### Why Jitter?

Prevents thundering herd when multiple connections fail simultaneously (e.g., backend restart).

---

## 6. Visibility-Based Pausing

**Optimization**: Pause discovery/health checks when browser tab is hidden.

```typescript
document.addEventListener("visibilitychange", () => {
  this.paused = document.hidden
  if (!document.hidden && this.started) {
    this.discover() // Immediate discovery on tab visible
  }
})
```

**Benefits**:
- Reduces battery drain on mobile
- Stops unnecessary network requests when tab backgrounded
- Immediate refresh on tab focus (good UX)

---

## 7. Event Routing (Consumer Layer)

**CRITICAL INSIGHT**: The core layer does NOT filter events by directory. It forwards ALL events from ALL servers.

**Filtering happens at consumption**:

```typescript
// BAD (causes bug - filters too early)
useEffect(() => {
  const unsubscribe = multiServerSSE.onEvent((event) => {
    if (event.directory !== currentDirectory) return // ❌ WRONG
    store.handleSSEEvent(event)
  })
}, [currentDirectory])

// GOOD (let store handle routing)
useEffect(() => {
  const unsubscribe = multiServerSSE.onEvent((event) => {
    store.handleSSEEvent(event) // ✅ Store routes via ensureDirectory()
  })
}, [])
```

**Store-level routing** (`handleSSEEvent`):
```typescript
handleSSEEvent(event: GlobalEvent):
  const dir = ensureDirectory(event.directory) // Auto-create if missing
  handleEvent(dir, event.payload)
```

**Why this works**:
- Multi-directory project lists show status for ALL projects
- Cross-directory updates work seamlessly
- No race conditions with directory switching

**Past bug**: `useSSESync` had `if (event.directory !== cfg.directory) return` which broke multi-directory updates. Removing this filter fixed the issue.

---

## 8. API Routing (`/api/opencode` vs `/api/sse`)

**Discovery**: `GET /api/opencode/servers` → list of running servers  
**SSE connection**: `GET /api/sse/{port}` → event stream for specific server  
**REST API calls**: `POST /api/opencode/{port}/send-message` → routed to specific backend

**Session-based routing**:
```typescript
const url = multiServerSSE.getBaseUrlForSession("ses_abc", "/proj/a")
// Returns: "/api/opencode/3000" (for REST calls, not SSE)

await fetch(`${url}/send-message`, { ... })
```

**Directory-based routing**:
```typescript
const url = multiServerSSE.getBaseUrlForDirectory("/proj/a")
// Returns: "/api/opencode/3000"
```

**Prefix convention**:
- `/api/opencode/{port}` → REST API calls (send message, create session, etc.)
- `/api/sse/{port}` → SSE event stream

---

## 9. Effect-TS SSE Atom (Alternative Layer)

**Location**: `packages/core/src/atoms/sse.ts`

**Purpose**: Pure Effect programs for SSE connection management (no React dependencies).

**API**:
```typescript
SSEAtom.connect(config: SSEConfig): Stream.Stream<GlobalEvent, Error>
SSEAtom.connectOnce(config: SSEConfig): Stream.Stream<GlobalEvent, Error>
```

**Features**:
- EventSource wrapper → Effect.Stream
- Heartbeat monitoring (60s timeout)
- Factory pattern for testability (`createEventSource` injection)
- Retry logic at consumption level (not stream creation)

**Usage pattern**:
```typescript
const stream = SSEAtom.connect({ url: "http://localhost:4056" })

await Effect.runPromise(
  Stream.runForEach(stream, (event) =>
    Effect.sync(() => console.log("Event:", event))
  ).pipe(Effect.retry(Schedule.exponential(Duration.seconds(3))))
)
```

**Key difference from MultiServerSSE**:
- SSEAtom: Single-server, Effect-based, generic (no OpenCode-specific logic)
- MultiServerSSE: Multi-server, browser EventSource, OpenCode-aware (discovery, session cache, status filtering)

**Current usage**: Not used in web app. Web app uses `MultiServerSSE` directly. SSEAtom is a foundation layer if/when Effect migration happens.

---

## 10. Duplication & Improvement Opportunities

### Duplication

1. **Two SSE implementations**:
   - `MultiServerSSE` (browser, multi-server, production)
   - `SSEAtom` (Effect, single-server, unused)

   **Impact**: Code duplication for heartbeat, reconnection, event parsing.

2. **Event type definitions**:
   - `packages/core/src/sse/multi-server-sse.ts` has `SSEEvent`
   - `packages/react/src/types/events.ts` has `GlobalEvent`
   - Both are identical structures

   **Fix**: Re-export single canonical type from core.

### Status-Specific Subscriptions (Legacy Pattern)

**Current**:
```typescript
onStatus(callback: StatusCallback) // Only session.status events
onEvent(callback: EventCallback)   // ALL events
```

**Problem**: Dual subscription APIs for same data. `onStatus` is legacy - kept for backward compatibility.

**Fix**: Deprecate `onStatus`, migrate consumers to `onEvent` with client-side filtering.

### Session Cache Pre-Population (NEW, GOOD)

**Before**: Session-to-port mapping built lazily as SSE events arrived. First request to a session might route to wrong server.

**After**: Discovery response includes `sessions` array, pre-populating cache before SSE events. Fixes web→TUI routing on page load.

**Status**: Already implemented, working well. No action needed.

---

## 11. Status Monitoring Gap (EPIC CONTEXT)

**Epic goal**: Understand SSE session status monitoring to propose unified solution.

**Current state**:
- `session.status` events exist and flow through SSE
- `MultiServerSSE.onStatus()` provides legacy status-only subscription
- Store handles `session.status` events via `handleEvent` dispatcher
- No dedicated "status monitoring" layer - status is just another event type

**Status event structure**:
```typescript
{
  directory: "/proj/a",
  payload: {
    type: "session.status",
    properties: {
      sessionID: "ses_abc",
      status: { type: "running", ... } // Status object structure unknown from core layer
    }
  }
}
```

**Gaps in core layer**:
- No status-specific retry logic
- No status buffering/deduplication
- No status query API (can't ask "what's the current status?")
- Status is ephemeral (only available via SSE stream, not queryable)

**Opportunities**:
- Unify status events with REST API (`GET /session/{id}/status`)
- Add status caching at core layer (not just at React store layer)
- Status change detection (only emit if status actually changed)

---

## Key Learnings for Hivemind

1. **Multi-server SSE filtering bug pattern**: Don't filter events at subscription layer - let store handle routing via `ensureDirectory()`.

2. **Session cache pre-population**: Discovery response with `sessions` field fixes routing before SSE events arrive. Critical for multi-TUI setups.

3. **Health-triggered reconnection**: 60s timeout = 2x server heartbeat (30s). Reset backoff on health-triggered reconnect for faster recovery.

4. **Exponential backoff with jitter**: Prevents thundering herd. Base 1s, max 30s, 20% jitter.

5. **Visibility-based pausing**: Pause discovery when tab hidden, immediate refresh on focus. Battery savings + good UX.

6. **No directory filtering at core layer**: Core forwards ALL events. Directory routing at consumer (store) layer. Enables cross-directory updates.

7. **Dual SSE implementations**: `MultiServerSSE` (production) and `SSEAtom` (Effect, unused). Duplication opportunity if Effect migration happens.

8. **Status is just another event**: No special status monitoring layer at core. `session.status` is handled by generic event dispatcher.

---

## Recommendations for Epic

1. **Status Query API**: Add `GET /session/{id}/status` to backend, cache at core layer. Enables "current status" queries without waiting for SSE events.

2. **Deprecate `onStatus()`**: Migrate consumers to `onEvent()` with filtering. Reduces API surface.

3. **Unify event types**: Re-export single `GlobalEvent` type from core, eliminate duplication.

4. **Status deduplication**: At core layer, track last status per session, only emit if changed. Reduces noise.

5. **Effect migration (future)**: If migrating to Effect, consolidate `MultiServerSSE` and `SSEAtom`. Keep multi-server logic, use Effect streams.

---

## Files Analyzed

- `packages/core/src/sse/index.ts` - Public exports
- `packages/core/src/sse/multi-server-sse.ts` - Main implementation (573 lines)
- `packages/core/src/sse/multi-server-sse.test.ts` - Comprehensive test coverage
- `packages/core/src/api/sse.ts` - API wrapper (thin, re-exports SSEAtom)
- `packages/core/src/atoms/sse.ts` - Effect-based SSE atom (unused in web app)
- `packages/react/src/types/events.ts` - Event type definitions (duplication)
- `packages/react/src/store/store.ts` - Event handler dispatcher (consumer layer)

---

## Conclusion

The SSE core layer is **solid, well-tested, and production-ready**. Multi-server discovery, health monitoring, and exponential backoff are robust. Session cache pre-population fixed a critical routing bug.

**Main gap**: Status monitoring is NOT a dedicated layer - it's just another event type. If the epic goal is "unified status monitoring", that would need to be built on TOP of the core layer (e.g., status cache, query API, deduplication).

**Next steps** (for epic coordinator):
- Investigate React layer status hooks (how do they consume `session.status` events?)
- Check if status querying (not just streaming) is needed
- Decide if status should be first-class or remain event-driven
