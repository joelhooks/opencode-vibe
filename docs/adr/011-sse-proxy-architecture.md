# ADR 011: SSE Proxy Architecture for Same-Origin Access

**Status:** Accepted (Partial Implementation)  
**Date:** 2025-12-31  
**Deciders:** Joel Hooks, Architecture Team  
**Affected Components:** `packages/core/src/sse/multi-server-sse.ts`, `apps/web/src/app/api/sse/`, Real-time sync  
**Related ADRs:** [ADR-012](./012-provider-removal-ssr.md) (Provider Elimination), [ADR-013](./013-unified-same-origin-architecture.md) (Unified Architecture)

---

## Implementation Status

### ✅ Completed
- SSE proxy route: `/api/sse/[port]/route.ts`
- MultiServerSSE updated to use `/api/sse/${port}` for SSE connections
- SSE connections now work on mobile/Tailscale

### ⏳ Remaining Work
- **Full API proxy** - SDK client still hits `localhost:4056` directly for non-SSE calls
- See: **Continuation Prompt** at end of this document

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

### 1. SSE Proxy Route Handler (✅ DONE)

**File:** `apps/web/src/app/api/sse/[port]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ port: string }> }
) {
  const { port } = await params

  // Validate port is a number
  if (!port || !/^\d+$/.test(port)) {
    return NextResponse.json({ error: "Invalid port number" }, { status: 400 })
  }

  const portNum = parseInt(port, 10)

  // Validate port is in reasonable range
  if (portNum < 1024 || portNum > 65535) {
    return NextResponse.json({ error: "Port out of valid range" }, { status: 400 })
  }

  try {
    const response = await fetch(`http://127.0.0.1:${portNum}/global/event`, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: `Server returned ${response.status}` }, { status: response.status })
    }

    if (!response.body) {
      return NextResponse.json({ error: "No response body" }, { status: 500 })
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    console.error(`[SSE Proxy] Failed to connect to port ${port}:`, error)
    return NextResponse.json({
      error: "Failed to connect to OpenCode server",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503 })
  }
}
```

### 2. Update MultiServerSSE Base URL Methods (✅ DONE)

**File:** `packages/core/src/sse/multi-server-sse.ts`

Changed to use `/api/sse/${port}` instead of `http://127.0.0.1:${port}`.

### 3. Full API Proxy (⏳ Phase 2)

The SDK client (`createClient`) still uses `http://localhost:4056` for non-SSE API calls. Need to proxy ALL API calls through Next.js.

#### Phase 2 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Browser (Mobile/Tailscale)                    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ API: /api/opencode/4056/session/list
                         │ SSE: /api/sse/4056
                         │ ✅ Both same-origin
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js Server (Proxy Layer)                     │
│                                                                   │
│  /api/opencode/[port]/[[...path]]/route.ts  →  Proxy ALL API     │
│  /api/sse/[port]/route.ts                   →  Proxy SSE (done)  │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ Server-to-server (no CORS)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              OpenCode Server (localhost:4056)                     │
└──────────────────────────────────────────────────────────────────┘
```

#### Implementation: Catch-All API Proxy Route

**File:** `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"

type RouteParams = { params: Promise<{ port: string; path?: string[] }> }

async function proxyRequest(
  request: NextRequest,
  { params }: RouteParams,
  method: string
) {
  const { port, path = [] } = await params

  // Validate port
  if (!port || !/^\d+$/.test(port)) {
    return NextResponse.json({ error: "Invalid port" }, { status: 400 })
  }

  const portNum = parseInt(port, 10)
  if (portNum < 1024 || portNum > 65535) {
    return NextResponse.json({ error: "Port out of range" }, { status: 400 })
  }

  // Build target URL
  const targetPath = path.join("/")
  const targetUrl = new URL(`http://127.0.0.1:${portNum}/${targetPath}`)
  
  // Forward query params
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value)
  })

  try {
    // Forward request with body (for POST/PUT/PATCH)
    const body = ["POST", "PUT", "PATCH"].includes(method)
      ? await request.text()
      : undefined

    const response = await fetch(targetUrl.toString(), {
      method,
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "application/json",
        "Accept": request.headers.get("Accept") || "application/json",
        // Forward x-opencode-directory header
        ...(request.headers.get("x-opencode-directory") && {
          "x-opencode-directory": request.headers.get("x-opencode-directory")!,
        }),
      },
      body,
    })

    // Check for SSE response (redirect to SSE proxy)
    if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
      return new NextResponse(response.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      })
    }

    // Return JSON response
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error(`[API Proxy] Failed to proxy to port ${port}:`, error)
    return NextResponse.json({
      error: "Failed to connect to OpenCode server",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503 })
  }
}

export async function GET(request: NextRequest, params: RouteParams) {
  return proxyRequest(request, params, "GET")
}

export async function POST(request: NextRequest, params: RouteParams) {
  return proxyRequest(request, params, "POST")
}

export async function PUT(request: NextRequest, params: RouteParams) {
  return proxyRequest(request, params, "PUT")
}

export async function PATCH(request: NextRequest, params: RouteParams) {
  return proxyRequest(request, params, "PATCH")
}

export async function DELETE(request: NextRequest, params: RouteParams) {
  return proxyRequest(request, params, "DELETE")
}
```

#### SDK Client Updates

**File:** `packages/core/src/client/client.ts`

Update URL generation to use proxy:

```typescript
// Before (direct localhost)
function getBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

// After (proxy through Next.js)
function getBaseUrl(port: number): string {
  // In browser, use same-origin proxy
  if (typeof window !== "undefined") {
    return `/api/opencode/${port}`
  }
  // On server, direct access is fine
  return `http://127.0.0.1:${port}`
}
```

#### Phase 2 Success Criteria

- [ ] `/api/opencode/[port]/[[...path]]` route created
- [ ] All HTTP methods proxied (GET, POST, PUT, PATCH, DELETE)
- [ ] Query params forwarded
- [ ] Request body forwarded for POST/PUT/PATCH
- [ ] `x-opencode-directory` header forwarded
- [ ] SDK client uses proxy in browser, direct on server
- [ ] Mobile/Tailscale can load sessions, messages, providers
- [ ] Tests pass, typecheck passes

> **See also:** [ADR-013: Unified Same-Origin Architecture](./013-unified-same-origin-architecture.md) for the complete picture of how this integrates with provider elimination.

---

## Continuation Prompt

The following prompt can be used to continue this work in a fresh context:

---

```markdown
# Task: Implement Full API Proxy for OpenCode (ADR-011 Phase 2)

## Context

ADR-011 Phase 1 is complete - SSE connections now proxy through `/api/sse/[port]`. But the SDK client still hits `localhost:4056` directly for API calls (sessions, messages, providers), causing CORS errors on mobile/Tailscale.

## Current State

- ✅ SSE proxy works: `/api/sse/[port]/route.ts`
- ✅ MultiServerSSE uses proxy for SSE
- ❌ SDK client (`createClient`) still uses `http://localhost:4056` for API calls
- ❌ CORS errors on mobile for: `/session`, `/provider`, `/session/status`, etc.

## Goal

Proxy ALL OpenCode API calls through Next.js, following the uploadthing pattern.

## Architecture Reference

The codebase already has a router system inspired by uploadthing:

```
packages/core/src/router/
├── adapters/
│   ├── next.ts          # createNextHandler, createAction
│   └── direct.ts        # createCaller for direct invocation
├── builder.ts           # Route builder with Zod validation
├── routes.ts            # Route definitions
├── executor.ts          # Effect-based execution
└── stream.ts            # SSE streaming support
```

Key patterns from `adapters/next.ts`:
- `createNextHandler()` - Creates API route handler from router
- `createAction()` - Creates Server Action from route
- Routes resolve via `?path=session.list` query param
- Streaming routes return SSE format

## Implementation Plan

### Option A: Extend Existing Router (Recommended)

1. **Create catch-all proxy route** at `/api/opencode/[port]/[[...path]]/route.ts`
   - Proxies any request to `http://127.0.0.1:${port}/${path}`
   - Preserves headers, body, method
   - Returns proxied response

2. **Update `createClient()`** in `packages/core/src/client/client.ts`
   - Change `getBaseUrlForSession()` to return `/api/opencode/${port}` (not `/api/sse/${port}`)
   - Change `getBaseUrlForDirectory()` similarly
   - SSE-specific calls can still use `/api/sse/${port}`

3. **Or: Use the router pattern**
   - Route all SDK calls through `createNextHandler()`
   - Single endpoint: `/api/opencode/route.ts`
   - Routes resolve via `?path=session.list&port=4056`

### Option B: Separate SSE and API Proxies

Keep `/api/sse/[port]` for SSE, add `/api/opencode/[port]/[...path]` for API.

## Files to Modify

1. `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts` - NEW proxy
2. `packages/core/src/client/client.ts` - Update URL generation
3. `packages/core/src/sse/multi-server-sse.ts` - Separate SSE vs API URLs

## Success Criteria

- [ ] All API calls proxy through Next.js (no direct localhost)
- [ ] Mobile/Tailscale can load sessions, messages, providers
- [ ] SSE still works via `/api/sse/[port]`
- [ ] Tests pass
- [ ] Typecheck passes

## Related

- ADR-011: `docs/adr/011-sse-proxy-architecture.md`
- Bug cell: `opencode-next--xts0a-mjtfdahejym`
- Router code: `packages/core/src/router/`
- uploadthing pattern: https://github.com/pingdotgg/uploadthing
```

---

## References

- **Next.js Streaming:** https://nextjs.org/docs/app/building-your-application/routing/route-handlers#streaming
- **EventSourceParserStream:** https://github.com/EventSource/eventsource-parser
- **Server-Sent Events:** https://html.spec.whatwg.org/multipage/server-sent-events.html
- **Same-Origin Policy:** https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- **Current MultiServerSSE:** `packages/core/src/sse/multi-server-sse.ts`
- **Discovery Pattern:** `apps/web/src/app/api/opencode-servers/route.ts`
- **uploadthing:** https://github.com/pingdotgg/uploadthing

---

## Sign-Off

This ADR proposes a minimal, non-breaking change to solve a critical mobile/Tailscale issue. The proxy pattern is proven (discovery already uses it), requires only 3 method changes, and maintains full backward compatibility with existing SSE wiring.

**Phase 1 Complete:**
1. ✅ Implemented `/api/sse/[port]/route.ts`
2. ✅ Updated `MultiServerSSE` base URL methods
3. ✅ SSE works on mobile/Tailscale

**Phase 2 TODO:**
4. ⏳ Implement full API proxy
5. ⏳ Update SDK client to use proxy
6. ⏳ Test on mobile and Tailscale
