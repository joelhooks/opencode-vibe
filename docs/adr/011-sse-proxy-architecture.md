# ADR 011: SSE Proxy Architecture for Same-Origin Access

**Status:** Proposed  
**Date:** 2025-12-31  
**Deciders:** Joel Hooks, Architecture Team  
**Affected Components:** `packages/core/src/sse/multi-server-sse.ts`, `apps/web/src/app/api/sse/`, Real-time sync

---

## Context

### The Problem: CORS Breaks Mobile Access

OpenCode servers run on localhost ports (e.g., `http://127.0.0.1:4056`). The `MultiServerSSE` class hardcodes this address for all SSE connections:

```typescript
// packages/core/src/sse/multi-server-sse.ts:385
const response = await fetch(`http://127.0.0.1:${port}/global/event`, {
  signal: controller.signal,
  headers: {
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
  },
})
```

**This breaks on mobile and Tailscale:**

- **Mobile phone:** `127.0.0.1` refers to the phone's localhost, not the Mac running OpenCode
- **Tailscale:** Browser origin is `http://dark-wizard.tail7af24.ts.net:8423`, but SSE tries to connect to `http://127.0.0.1:4056`
- **CORS error:** `Origin http://dark-wizard.tail7af24.ts.net:8423 is not allowed by Access-Control-Allow-Origin`

### Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Mobile/Tailscale)               │
│                   dark-wizard.tail7af24.ts.net               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ fetch('http://127.0.0.1:4056/global/event')
                         │ ❌ CORS FAILS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              OpenCode Server (localhost:4056)                │
│                    /global/event (SSE)                       │
└─────────────────────────────────────────────────────────────┘
```

**Why this happens:**

1. Browser enforces same-origin policy for SSE connections
2. `127.0.0.1:4056` is a different origin than `dark-wizard.tail7af24.ts.net:8423`
3. OpenCode server doesn't set CORS headers (and shouldn't - it's not a web server)
4. SSE connections fail silently, no real-time updates reach the client

### Discovery Already Works

The `/api/opencode-servers` discovery endpoint (`apps/web/src/app/api/opencode-servers/route.ts`) already solves the hard part:

- Discovers running servers via `lsof`
- Verifies each candidate by hitting `/project/current`
- Returns `{ port, pid, directory }` for all active servers
- **This proves we can reach localhost servers from the Next.js server**

The missing piece: **proxy SSE through the same origin.**

---

## Decision

**We will proxy SSE connections through Next.js API routes to solve the same-origin problem.**

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Browser (Mobile/Tailscale)                    │
│                   dark-wizard.tail7af24.ts.net                    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ fetch('/api/sse/4056')
                         │ ✅ Same origin
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js Server (same origin)                     │
│              /api/sse/[port]/route.ts (proxy)                     │
│                                                                   │
│  1. Receives request from browser                                │
│  2. Fetches from http://127.0.0.1:[port]/global/event            │
│  3. Pipes response back to browser                               │
│  4. Browser sees same-origin SSE stream ✅                        │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ fetch('http://127.0.0.1:4056/global/event')
                         │ ✅ Server-to-server (no CORS)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              OpenCode Server (localhost:4056)                     │
│                    /global/event (SSE)                            │
└──────────────────────────────────────────────────────────────────┘
```

### Key Benefits

1. **Same-origin SSE** - Browser sees `/api/sse/[port]` as same origin
2. **No CORS issues** - Server-to-server fetch has no CORS restrictions
3. **Transparent to clients** - `MultiServerSSE` just changes the base URL
4. **Works everywhere** - Mobile, Tailscale, localhost, all the same
5. **Minimal changes** - Only `MultiServerSSE.getBaseUrl*()` methods need updates

---

## Implementation Details

### 1. SSE Proxy Route Handler

**File:** `apps/web/src/app/api/sse/[port]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"

/**
 * SSE Proxy Route
 *
 * Proxies Server-Sent Events from OpenCode servers through Next.js
 * to solve same-origin policy issues on mobile and Tailscale.
 *
 * Flow:
 * 1. Browser requests /api/sse/[port]
 * 2. This route fetches from http://127.0.0.1:[port]/global/event
 * 3. Pipes the response back to browser with proper SSE headers
 *
 * Why this works:
 * - Browser sees /api/sse/[port] as same origin (no CORS)
 * - Server-to-server fetch has no CORS restrictions
 * - SSE stream is transparently piped through
 */

export async function GET(
  request: NextRequest,
  { params }: { params: { port: string } }
) {
  const port = params.port

  // Validate port is a number
  if (!port || !/^\d+$/.test(port)) {
    return NextResponse.json(
      { error: "Invalid port number" },
      { status: 400 }
    )
  }

  const portNum = parseInt(port, 10)

  // Validate port is in reasonable range
  if (portNum < 1024 || portNum > 65535) {
    return NextResponse.json(
      { error: "Port out of valid range" },
      { status: 400 }
    )
  }

  try {
    // Fetch from local OpenCode server
    // Server-to-server fetch has no CORS restrictions
    const response = await fetch(`http://127.0.0.1:${portNum}/global/event`, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Server returned ${response.status}` },
        { status: response.status }
      )
    }

    if (!response.body) {
      return NextResponse.json(
        { error: "No response body" },
        { status: 500 }
      )
    }

    // Return SSE response with proper headers
    // Browser will see this as same-origin SSE stream
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        // Allow browser to keep connection open
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    console.error(`[SSE Proxy] Failed to connect to port ${port}:`, error)

    return NextResponse.json(
      {
        error: "Failed to connect to OpenCode server",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    )
  }
}
```

### 2. Update MultiServerSSE Base URL Methods

**File:** `packages/core/src/sse/multi-server-sse.ts`

Replace the hardcoded `http://127.0.0.1:${port}` with proxy URLs:

```typescript
/**
 * Get the base URL for a session's server (preferred) or directory's server (fallback)
 * 
 * CHANGED: Now returns proxy URL instead of direct localhost
 * - Old: http://127.0.0.1:${port}
 * - New: /api/sse/${port}
 * 
 * This solves same-origin policy issues on mobile and Tailscale.
 */
getBaseUrlForSession(sessionId: string, directory: string): string | undefined {
  // First, check if we know which server owns this session
  const sessionPort = this.sessionToPort.get(sessionId)
  if (sessionPort) {
    return `/api/sse/${sessionPort}`  // ← CHANGED
  }

  // Fallback to first port for directory
  const ports = this.directoryToPorts.get(directory)
  return ports?.[0] ? `/api/sse/${ports[0]}` : undefined  // ← CHANGED
}

/**
 * Get the base URL for a directory's server (first one if multiple)
 * Returns undefined if no server found for this directory
 * 
 * CHANGED: Now returns proxy URL instead of direct localhost
 */
getBaseUrlForDirectory(directory: string): string | undefined {
  const ports = this.directoryToPorts.get(directory)
  return ports?.[0] ? `/api/sse/${ports[0]}` : undefined  // ← CHANGED
}
```

### 3. Update SSE Connection in connectToServer()

**File:** `packages/core/src/sse/multi-server-sse.ts:385`

```typescript
private async connectToServer(port: number) {
  const controller = new AbortController()
  this.connections.set(port, controller)
  this.setConnectionState(port, "connecting")

  // Initialize backoff counter if not present
  if (!this.backoffAttempts.has(port)) {
    this.backoffAttempts.set(port, 0)
  }

  while (!controller.signal.aborted && this.started) {
    try {
      // CHANGED: Use proxy URL instead of direct localhost
      // Old: const response = await fetch(`http://127.0.0.1:${port}/global/event`, ...)
      // New: const response = await fetch(`/api/sse/${port}`, ...)
      const response = await fetch(`/api/sse/${port}`, {
        signal: controller.signal,
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      })

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect: ${response.status}`)
      }

      // ... rest of connection logic unchanged
    } catch (error) {
      // ... error handling unchanged
    }
  }
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  MultiServerSSE (packages/core/src/sse/multi-server-sse.ts)         │
│  ├─ discover() → /api/opencode-servers                              │
│  │  └─ Returns: [{ port: 4056, directory: "/path" }, ...]          │
│  │                                                                   │
│  └─ connectToServer(port) → /api/sse/[port]  ← NEW PROXY            │
│     └─ Receives SSE stream from proxy                               │
│                                                                      │
│  OpencodeProvider (packages/react/src/providers/)                   │
│  └─ useMultiServerSSE({ onEvent: handleEvent })                     │
│     └─ Wires SSE events to Zustand store                            │
│                                                                      │
└────────────────────────┬──────────────────────────────────────────────┘
                         │
                         │ HTTP/1.1 (same origin)
                         │
┌────────────────────────▼──────────────────────────────────────────────┐
│                      NEXT.JS SERVER LAYER                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  /api/opencode-servers/route.ts (existing)                          │
│  └─ Discovers running servers via lsof                              │
│     └─ Returns: [{ port, pid, directory }, ...]                     │
│                                                                      │
│  /api/sse/[port]/route.ts (NEW)                                     │
│  ├─ Validates port number                                           │
│  ├─ Fetches from http://127.0.0.1:[port]/global/event               │
│  └─ Pipes response back to browser with SSE headers                 │
│                                                                      │
└────────────────────────┬──────────────────────────────────────────────┘
                         │
                         │ HTTP/1.1 (server-to-server, no CORS)
                         │
┌────────────────────────▼──────────────────────────────────────────────┐
│                    OPENCODE SERVER LAYER                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  /global/event (SSE endpoint)                                        │
│  ├─ Sends heartbeats every 30s                                       │
│  ├─ Sends session.status events                                      │
│  ├─ Sends message.created events                                     │
│  ├─ Sends message.part.created events                                │
│  └─ Sends message.part.updated events                                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Connection Lifecycle

### Startup Sequence

```
1. Browser loads Next.js app
   ↓
2. OpencodeProvider mounts
   ↓
3. useMultiServerSSE() hook initializes
   ↓
4. MultiServerSSE.start() called
   ↓
5. discover() fetches /api/opencode-servers
   ├─ Returns: [{ port: 4056, directory: "/path" }, ...]
   ↓
6. For each discovered port, connectToServer(port)
   ├─ Fetches /api/sse/4056
   ├─ Next.js proxy fetches http://127.0.0.1:4056/global/event
   ├─ SSE stream established
   ↓
7. EventSourceParserStream parses incoming events
   ↓
8. handleEvent() dispatches to store.handleSSEEvent()
   ↓
9. Zustand store updates via Immer
   ↓
10. Components re-render via selectors
```

### Heartbeat & Health Monitoring

```
Every 30s from OpenCode server:
  heartbeat event → /api/sse/[port] → browser
  ↓
MultiServerSSE.recordEventReceived(port)
  ↓
lastEventTimes.set(port, Date.now())

Every 10s, checkConnectionHealth():
  if (now - lastEventTime > 60s) {
    Force reconnect with backoff
  }
```

### Reconnection with Exponential Backoff

```
Connection fails:
  ↓
Calculate backoff: min(1000 * 2^attempt, 30000) + jitter
  ↓
Wait delay milliseconds
  ↓
Retry connectToServer(port)
  ↓
Max backoff: 30 seconds
Jitter: ±20% to prevent thundering herd
```

---

## Migration Path for MultiServerSSE

### Phase 1: Implement Proxy Route (Week 1)

1. Create `/api/sse/[port]/route.ts` with validation and error handling
2. Add comprehensive logging for debugging
3. Test locally with `http://localhost:3000/api/sse/4056`

### Phase 2: Update MultiServerSSE (Week 1)

1. Change `getBaseUrlForSession()` to return `/api/sse/${port}`
2. Change `getBaseUrlForDirectory()` to return `/api/sse/${port}`
3. Change `connectToServer()` to fetch from `/api/sse/${port}`
4. No changes to event parsing or store wiring needed

### Phase 3: Testing (Week 2)

1. **Unit tests:** Validate port parsing and error cases
2. **Integration tests:** Verify SSE events flow through proxy
3. **Mobile testing:** Test on actual phone via Tailscale
4. **Stress testing:** Verify backoff and reconnection under load

### Phase 4: Rollout (Week 2)

1. Deploy to staging
2. Monitor error rates and connection health
3. Deploy to production
4. Remove old hardcoded `http://127.0.0.1` references

---

## Consequences

### Positive

✅ **Solves CORS issues** - SSE works on mobile and Tailscale  
✅ **Transparent to clients** - No changes to `useMultiServerSSE()` hook  
✅ **Minimal code changes** - Only 3 methods in `MultiServerSSE` need updates  
✅ **Leverages existing discovery** - Reuses `/api/opencode-servers` pattern  
✅ **Server-to-server fetch** - No CORS restrictions, more reliable  
✅ **Works everywhere** - Localhost, mobile, Tailscale, all the same  
✅ **Debugging friendly** - Proxy route can log all events for troubleshooting  

### Negative

❌ **Extra network hop** - Browser → Next.js → OpenCode server (vs direct)  
❌ **Proxy latency** - ~10-50ms added per event (acceptable for SSE)  
❌ **Memory usage** - Next.js server holds open connections for each browser client  
❌ **Scaling concern** - Many concurrent SSE connections could stress Node.js  

### Mitigations

- **Latency:** SSE is designed for high-latency scenarios (heartbeats every 30s)
- **Memory:** Use connection pooling if needed (future optimization)
- **Scaling:** Monitor connection count, implement limits if necessary

---

## Alternatives Considered

### 1. CORS Headers on OpenCode Server

**Rejected:** OpenCode server is not a web server. Adding CORS headers is wrong:
- Exposes internal API to arbitrary origins
- Security risk if server is exposed to internet
- Violates separation of concerns

### 2. Direct Localhost Connection from Mobile

**Rejected:** Impossible on mobile:
- `127.0.0.1` on phone refers to phone's localhost, not Mac
- No way to reach Mac's localhost from phone without proxy

### 3. WebSocket Instead of SSE

**Rejected:** SSE is already working:
- Simpler protocol than WebSocket
- Better browser support
- Easier to debug (plain HTTP)
- No need to rewrite event handling

### 4. Reverse Proxy (nginx/caddy)

**Rejected:** Adds deployment complexity:
- Requires separate reverse proxy process
- More configuration to manage
- Next.js can handle this natively

### 5. Service Worker Interception

**Rejected:** Overly complex:
- Service workers can't intercept EventSource
- Would need to rewrite SSE as fetch polling
- Defeats purpose of SSE

---

## Testing Strategy

### Unit Tests

```typescript
// apps/web/src/app/api/sse/[port]/route.test.ts

describe("SSE Proxy Route", () => {
  it("rejects invalid port numbers", async () => {
    const response = await GET(mockRequest, { params: { port: "abc" } })
    expect(response.status).toBe(400)
  })

  it("rejects ports outside valid range", async () => {
    const response = await GET(mockRequest, { params: { port: "99999" } })
    expect(response.status).toBe(400)
  })

  it("returns 503 when server is unreachable", async () => {
    // Mock fetch to fail
    const response = await GET(mockRequest, { params: { port: "9999" } })
    expect(response.status).toBe(503)
  })

  it("proxies successful SSE response", async () => {
    // Mock fetch to return SSE stream
    const response = await GET(mockRequest, { params: { port: "4056" } })
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/event-stream")
  })
})
```

### Integration Tests

```typescript
// packages/core/src/sse/multi-server-sse.test.ts

describe("MultiServerSSE with Proxy", () => {
  it("discovers servers via /api/opencode-servers", async () => {
    const manager = new MultiServerSSE()
    manager.start()
    
    await waitFor(() => {
      expect(manager.getPortsForDirectory("/path")).toContain(4056)
    })
  })

  it("connects to servers via /api/sse/[port]", async () => {
    const manager = new MultiServerSSE()
    const events: SSEEvent[] = []
    
    manager.onEvent((event) => events.push(event))
    manager.start()
    
    await waitFor(() => {
      expect(events.length).toBeGreaterThan(0)
    })
  })

  it("reconnects on connection failure", async () => {
    // Simulate server crash and restart
    // Verify reconnection with backoff
  })
})
```

### Mobile Testing

```
1. Start OpenCode server on Mac
2. Connect phone to Tailscale
3. Open browser on phone: http://dark-wizard.tail7af24.ts.net:3000
4. Verify SSE connections in Network tab
5. Verify real-time updates (messages, status changes)
6. Verify reconnection after network interruption
```

---

## Monitoring & Observability

### Logging

```typescript
// In proxy route
console.log(`[SSE Proxy] Request to /api/sse/${port}`)
console.log(`[SSE Proxy] Connecting to http://127.0.0.1:${port}/global/event`)
console.log(`[SSE Proxy] Connected, streaming to browser`)
console.error(`[SSE Proxy] Connection failed: ${error.message}`)

// In MultiServerSSE
console.debug(`[MultiServerSSE] Connecting to /api/sse/${port}`)
console.debug(`[MultiServerSSE] Port ${port}: disconnected → connecting`)
console.debug(`[MultiServerSSE] Heartbeat received from port ${port}`)
```

### Metrics to Track

- Connection success rate per port
- Average event latency (browser → proxy → server)
- Reconnection frequency and backoff distribution
- Concurrent SSE connections
- Proxy route error rates

### Debug Panel

Add to debug panel in web app:

```typescript
{
  "sse": {
    "connections": {
      "4056": {
        "state": "connected",
        "lastEvent": "2025-12-31T12:34:56Z",
        "eventCount": 1234,
        "latency": "45ms"
      }
    },
    "totalEvents": 5678,
    "reconnections": 2
  }
}
```

---

## Future Optimizations

### 1. Connection Pooling

If many browser clients connect, pool connections to reduce server load:

```typescript
// Reuse single connection for multiple clients
const connectionPool = new Map<number, ReadableStream>()

// Multiple browsers → single upstream connection
```

### 2. Event Filtering

Filter events at proxy to reduce bandwidth:

```typescript
// Only send events for directories the browser cares about
if (event.directory === requestedDirectory) {
  controller.enqueue(encoded)
}
```

### 3. Compression

Compress SSE stream if client supports it:

```typescript
// Add gzip compression for large event payloads
headers: {
  "Content-Encoding": "gzip",
}
```

### 4. Rate Limiting

Prevent proxy from being overwhelmed:

```typescript
// Limit concurrent connections per IP
// Limit events per second
```

---

## References

- **Next.js Streaming:** https://nextjs.org/docs/app/building-your-application/routing/route-handlers#streaming
- **EventSourceParserStream:** https://github.com/EventSource/eventsource-parser
- **Server-Sent Events:** https://html.spec.whatwg.org/multipage/server-sent-events.html
- **Same-Origin Policy:** https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- **Current MultiServerSSE:** `packages/core/src/sse/multi-server-sse.ts`
- **Discovery Pattern:** `apps/web/src/app/api/opencode-servers/route.ts`

---

## Sign-Off

This ADR proposes a minimal, non-breaking change to solve a critical mobile/Tailscale issue. The proxy pattern is proven (discovery already uses it), requires only 3 method changes, and maintains full backward compatibility with existing SSE wiring.

**Next Steps:**
1. Implement `/api/sse/[port]/route.ts`
2. Update `MultiServerSSE` base URL methods
3. Test on mobile and Tailscale
4. Deploy to production
