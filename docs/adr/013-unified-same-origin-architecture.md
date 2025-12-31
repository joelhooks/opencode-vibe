# ADR 013: Unified Same-Origin Architecture

**Status:** Proposed  
**Date:** 2025-12-31  
**Deciders:** Joel Hooks, Architecture Team  
**Affected Components:** Full stack - Core, React, Web App, API Routes  
**Related ADRs:** ADR-011 (SSE Proxy), ADR-012 (Provider Elimination), ADR-009 (DX Overhaul), ADR-010 (Store Architecture)

---

## Executive Summary

This ADR unifies two critical architectural improvements into a cohesive "Same-Origin Architecture":

1. **API Proxy Pattern** (ADR-011) - Route all OpenCode server communication through Next.js to eliminate CORS
2. **Provider-Free Pattern** (ADR-012) - Use factory + SSR plugin to eliminate React provider ceremony

Together, these create a **zero-configuration, same-origin, provider-free architecture** that "just works" on mobile, desktop, and Tailscale.

---

## Context: The Root Problem

### Mobile/Tailscale CORS Hell

OpenCode servers run on `localhost:4056`. The React app tries to connect from external devices:

```
┌─────────────────────────────────────────────────────────────┐
│                    iPhone Safari                             │
│        Origin: http://dark-wizard.tail7af24.ts.net:8423      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ fetch('http://127.0.0.1:4056/session/list')
                         │ ❌ CORS ERROR
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              OpenCode Server (localhost:4056)                │
│            Origin: http://127.0.0.1:4056                     │
└─────────────────────────────────────────────────────────────┘

Error: Origin http://dark-wizard.tail7af24.ts.net:8423 is not 
       allowed by Access-Control-Allow-Origin
```

**Why this breaks:**

1. **Different origins** - Browser enforces same-origin policy
2. **No CORS headers** - OpenCode server doesn't know about CORS (and shouldn't)
3. **Mobile localhost** - `127.0.0.1` on iPhone refers to the phone, not the Mac
4. **Tailscale quirk** - WKWebView SSE connections timeout after 60s without heartbeat

### Provider Ceremony Tax

Every app using OpenCode pays a boilerplate tax:

```tsx
// app/layout.tsx - REQUIRED wrapper
<OpenCodeProvider baseUrl="http://localhost:3100" directory="/path/to/project">
  {children}
</OpenCodeProvider>

// Every component - REQUIRED context
const session = useSession(id) // Reads from React context
```

**Problems:**

- **Boilerplate** - Wrapper needed in every root layout
- **Hydration delay** - Client doesn't know config until React hydrates (~50ms)
- **Server/Client split** - Config duplicated between server and client
- **No type safety** - Runtime strings, not compile-time types

---

## The Unified Solution

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    Browser (Mobile/Tailscale)                    │
│                   dark-wizard.tail7af24.ts.net                    │
│                                                                   │
│  1. Page loads with <OpencodeSSRPlugin>                          │
│  2. Script injects: window.__OPENCODE = { baseUrl, directory }   │
│  3. React hydrates, hooks use globalThis (no provider)           │
│  4. All API calls go to SAME ORIGIN: /api/opencode/4056/...      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ fetch('/api/opencode/4056/session/list')
                         │ fetch('/api/sse/4056')
                         │ ✅ Same origin - no CORS
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js Server (same origin)                     │
│                 dark-wizard.tail7af24.ts.net                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  API Routes (Proxy Layer)                                  │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │  /api/opencode/[port]/[[...path]]  →  Proxy all API calls │  │
│  │  /api/sse/[port]                   →  Proxy SSE streams   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SSR Layer (Configuration Injection)                       │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │  <OpencodeSSRPlugin config={{ baseUrl, directory }}>      │  │
│  │    → Injects window.__OPENCODE before React hydrates      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ Server-to-server (no CORS)
                         │ fetch('http://127.0.0.1:4056/session/list')
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              OpenCode Server (localhost:4056)                     │
│                    /session/list (API)                            │
│                    /global/event (SSE)                            │
└──────────────────────────────────────────────────────────────────┘
```

### Key Innovations

| Layer | Component | Purpose | Benefit |
|-------|-----------|---------|---------|
| **Proxy** | `/api/opencode/[port]/[[...path]]` | Route ALL API calls through Next.js | Same-origin access, no CORS |
| **Proxy** | `/api/sse/[port]` | Route SSE streams through Next.js | Same-origin SSE, mobile works |
| **SSR** | `<OpencodeSSRPlugin>` | Inject config via `useServerInsertedHTML` | Zero hydration delay |
| **Client** | `generateOpencodeHelpers()` | Factory creates hooks without provider | Zero ceremony, type-safe |
| **State** | Zustand DirectoryState (no changes) | Already optimal for SSR | No persist middleware needed |

---

## Decision

We will implement a **unified same-origin architecture** that combines:

1. **Full API proxy through Next.js** (not just SSE)
2. **uploadthing-style factory + SSR plugin** (no provider wrappers)
3. **Single source of truth** for configuration (server → SSR → globalThis → hooks)

### 1. API Proxy Layer (extends ADR-011)

**Current (ADR-011 Phase 1):**
- ✅ `/api/sse/[port]/route.ts` proxies SSE streams
- ✅ `MultiServerSSE` uses `/api/sse/${port}` instead of `http://127.0.0.1:${port}`

**New (ADR-011 Phase 2):**
- ⏳ `/api/opencode/[port]/[[...path]]/route.ts` proxies ALL API calls
- ⏳ SDK client uses `/api/opencode/${port}` for base URL
- ⏳ SSE-specific calls continue using `/api/sse/${port}`

**Result:** Browser sees all traffic as same-origin, CORS eliminated.

### 2. Provider-Free Layer (implements ADR-012)

**Factory Pattern:**

```tsx
// packages/react/src/factory.ts
export function generateOpencodeHelpers<TRouter = any>(config?: {
  baseUrl?: string
  directory?: string
}) {
  const getConfig = () => {
    // 1. Check globalThis (from SSR plugin)
    if (typeof window !== "undefined" && (window as any).__OPENCODE) {
      return (window as any).__OPENCODE
    }
    
    // 2. Fallback to provided config (for tests)
    if (!config?.baseUrl) {
      throw new Error("OpenCode: No config found. Did you forget <OpencodeSSRPlugin>?")
    }
    return config
  }

  return {
    useSession(sessionId: string) {
      const { baseUrl, directory } = getConfig()
      // ... implementation using Zustand store
    },
    useSendMessage(options: { sessionId: string }) {
      const { baseUrl, directory } = getConfig()
      // ... implementation
    },
    // ... all other hooks
  }
}
```

**SSR Plugin:**

```tsx
// packages/react/src/next-ssr-plugin.tsx
"use client"

import { useServerInsertedHTML } from "next/navigation"

export function OpencodeSSRPlugin({ config }: { 
  config: { baseUrl: string; directory: string } 
}) {
  useServerInsertedHTML(() => {
    return (
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__OPENCODE = ${JSON.stringify(config)};`,
        }}
      />
    )
  })

  return null
}
```

**Usage (zero ceremony):**

```tsx
// app/hooks.ts (create once)
import { generateOpencodeHelpers } from "@opencode-vibe/react"
export const { useSession, useSendMessage } = generateOpencodeHelpers()

// app/layout.tsx (add plugin, no provider)
import { OpencodeSSRPlugin } from "@opencode-vibe/react/next-ssr-plugin"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <OpencodeSSRPlugin config={{ baseUrl: "/api/opencode/4056", directory: process.cwd() }} />
        {children}
      </body>
    </html>
  )
}

// components/session.tsx (just use hooks)
import { useSession } from "@/app/hooks"

export function SessionView({ id }) {
  const session = useSession(id) // Works immediately, no provider
}
```

### 3. Configuration Flow (Single Source of Truth)

```
┌─────────────────────────────────────────────────────────────┐
│                    CONFIGURATION FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. SERVER (build time)                                     │
│     app/layout.tsx defines:                                 │
│     { baseUrl: "/api/opencode/4056", directory: "/path" }   │
│                                                             │
│  2. SSR (render time)                                       │
│     <OpencodeSSRPlugin> injects:                            │
│     <script>window.__OPENCODE = {...}</script>              │
│     ↓                                                        │
│     Runs BEFORE React hydrates                              │
│                                                             │
│  3. CLIENT (hydration)                                      │
│     globalThis.__OPENCODE populated                         │
│     ↓                                                        │
│     Factory hooks check globalThis first                    │
│     ↓                                                        │
│     Zero latency, no API fetch needed                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Diagrams

### Request Flow: API Calls

```
Browser                    Next.js API Route            OpenCode Server
┌─────────┐               ┌────────────────┐           ┌──────────────┐
│         │               │                │           │              │
│  Hook   │──────────────▶│ /api/opencode/ │──────────▶│ localhost:   │
│  call   │  Same-origin  │ [port]/[path]  │  Server-  │ 4056         │
│         │  fetch()      │                │  to-server│              │
│         │               │  Proxy layer   │  fetch()  │  Hono server │
│         │◀──────────────│                │◀──────────│              │
│         │  Response     │                │  Response │              │
└─────────┘               └────────────────┘           └──────────────┘

Example:
  fetch('/api/opencode/4056/session/list')
    → Next.js proxies to http://127.0.0.1:4056/session/list
    → Returns response to browser (same-origin)
```

### Request Flow: SSE Streams

```
Browser                    Next.js API Route            OpenCode Server
┌─────────┐               ┌────────────────┐           ┌──────────────┐
│         │               │                │           │              │
│  SSE    │──────────────▶│ /api/sse/      │──────────▶│ localhost:   │
│  hook   │  EventSource  │ [port]         │  Server-  │ 4056         │
│         │  connection   │                │  to-server│              │
│         │               │  Pipe stream   │  fetch()  │  /global/    │
│         │◀──────────────│                │◀──────────│  event       │
│         │  SSE events   │                │  SSE      │              │
└─────────┘               └────────────────┘           └──────────────┘

Example:
  new EventSource('/api/sse/4056')
    → Next.js fetches http://127.0.0.1:4056/global/event
    → Pipes ReadableStream back to browser (same-origin)
```

### Component Hierarchy (Provider-Free)

```
┌────────────────────────────────────────────────────────────┐
│                      app/layout.tsx                        │
│  <html>                                                    │
│    <body>                                                  │
│      <OpencodeSSRPlugin config={{ ... }} />  ← SSR inject │
│      {children}                                            │
│    </body>                                                 │
│  </html>                                                   │
└────────────────────────────────────────────────────────────┘
                              │
                              │ No provider wrapper needed
                              ▼
┌────────────────────────────────────────────────────────────┐
│                    app/page.tsx                            │
│  const { useSession } = generateOpencodeHelpers()          │
│  export function HomePage() {                              │
│    const session = useSession(id) ← Reads globalThis      │
│    return <SessionView session={session} />                │
│  }                                                         │
└────────────────────────────────────────────────────────────┘
```

### Configuration Injection Timeline

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER TIMELINE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HTML arrives                                               │
│  ↓                                                           │
│  <script>window.__OPENCODE = {...}</script>                 │
│  ↓ Executes immediately (no React needed)                   │
│  globalThis.__OPENCODE = { baseUrl, directory }             │
│  ↓                                                           │
│  React hydrates                                             │
│  ↓                                                           │
│  Hooks call getConfig()                                     │
│  ↓                                                           │
│  globalThis.__OPENCODE found ✅ (zero latency)              │
│  ↓                                                           │
│  fetch('/api/opencode/4056/session/list')                   │
│  ↓                                                           │
│  Same-origin ✅ (no CORS)                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Full API Proxy (extends ADR-011 Phase 2)

**Files:**
- `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts` - NEW
- `packages/core/src/client/client.ts` - Update URL generation

**Work:**
1. Create catch-all proxy route at `/api/opencode/[port]/[[...path]]`
2. Proxy all methods (GET, POST, PUT, DELETE, PATCH)
3. Preserve headers, body, method
4. Return proxied response with same-origin headers
5. Update `createClient()` to use `/api/opencode/${port}` for base URL
6. Keep SSE-specific calls using `/api/sse/${port}`

**Success criteria:**
- All API calls proxy through Next.js
- Mobile/Tailscale can load sessions, messages, providers
- SSE still works via `/api/sse/[port]`
- Tests pass, typecheck passes

**Details:** See ADR-011 "Continuation Prompt" section

### Phase 2: Provider-Free Architecture (implements ADR-012)

**2.1: Create OpencodeSSRPlugin (1 hour)**

Files:
- `packages/react/src/next-ssr-plugin.tsx`
- `packages/react/src/next-ssr-plugin.test.tsx`

**2.2: Create generateOpencodeHelpers Factory (2 hours)**

Files:
- `packages/react/src/factory.ts`
- `packages/react/src/factory.test.ts`

**2.3: Migrate Web App (1 hour)**

Files:
- `apps/web/src/app/hooks.ts` - NEW (single source of hooks)
- `apps/web/src/app/layout.tsx` - Replace provider with plugin
- All component files - Update imports

**2.4: Deprecate OpenCodeProvider (30 min)**

Files:
- `packages/react/src/providers/opencode-provider.tsx` - Add deprecation warning

**Details:** See ADR-012 "Implementation Plan" section

### Phase 3: Integration & Testing (1 hour)

**Work:**
1. Update `app/hooks.ts` to use `/api/opencode/4056` as baseUrl
2. Verify SSR plugin injects config correctly
3. Test on mobile device via Tailscale
4. Test SSE reconnection on network change
5. Run full test suite (Vitest)
6. Run typecheck (Turbo)
7. Run UBS scan

**Success criteria:**
- Zero CORS errors on mobile/Tailscale
- Zero provider wrappers in app
- SSR hydration works with no loading state
- All tests pass
- App runs in browser with no console errors

---

## Cross-References

### Related ADRs

- **ADR-011:** SSE Proxy Architecture (Phase 1 complete, Phase 2 in this ADR)
- **ADR-012:** Provider-Free Architecture (fully implemented in this ADR)
- **ADR-009:** DX Overhaul (motivates zero-ceremony goal)
- **ADR-010:** Store Architecture (Zustand patterns reused here)

### Hivemind Learnings

- **SSE Proxy Implementation:** `docs/investigations/sse-infinite-loop-2025-12-30.md`
- **uploadthing patterns:** Factory + SSR plugin inspiration
- **Provider Wiring Patterns:** `getStoreActions()` helper for action calls
- **Anti-Patterns:** Zustand selector infinite loops, multiple SSE subscriptions

### Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/app/api/sse/[port]/route.ts` | SSE proxy (✅ done) |
| `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts` | API proxy (⏳ todo) |
| `packages/react/src/next-ssr-plugin.tsx` | SSR config injection (⏳ todo) |
| `packages/react/src/factory.ts` | Provider-free hooks (⏳ todo) |
| `packages/core/src/sse/multi-server-sse.ts` | SSE client (✅ updated) |
| `packages/core/src/client/client.ts` | SDK client (⏳ needs update) |

---

## Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| **Mobile CORS errors** | Yes (blocking) | None | 0 |
| **Provider wrappers needed** | 1 | 0 | 0 |
| **SSR hydration latency** | ~50ms | 0ms | 0ms |
| **Lines to setup** | ~15 (provider + imports) | ~5 (plugin + factory) | <5 |
| **Same-origin traffic** | 0% (all localhost) | 100% (all proxied) | 100% |
| **Type safety** | Runtime config | Compile-time | Compile-time |

---

## Alternatives Considered

### 1. Add CORS Headers to OpenCode Server

**Rejected:** Would require maintaining CORS config, handling preflight requests, and doesn't solve the fundamental `127.0.0.1` vs Tailscale hostname issue.

### 2. Use Tailscale Funnel

**Rejected:** Requires exposing OpenCode server to public internet. Security risk, adds network latency, doesn't work for offline mobile.

### 3. Keep Provider Pattern, Just Proxy API

**Rejected:** Solves CORS but doesn't eliminate ceremony. Uploadthing proved factory + SSR plugin is superior DX.

### 4. Use Jotai Provider for SSR

**Rejected:** Still requires provider wrapper. Worse DX than factory pattern.

### 5. Proxy Only SSE, Keep Direct API Calls

**Current state after ADR-011 Phase 1.** Rejected because:
- Partial solution (SSE works, API calls don't)
- Inconsistent - some traffic proxied, some direct
- Mobile still broken for session/provider/message endpoints

---

## References

### Documentation
- **Next.js API Routes:** https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- **Next.js SSR Plugins:** https://nextjs.org/docs/app/building-your-application/rendering/server-components#useserverinsertedhtml
- **Server-Sent Events:** https://html.spec.whatwg.org/multipage/server-sent-events.html
- **Same-Origin Policy:** https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- **uploadthing source:** https://github.com/pingdotgg/uploadthing

### Internal References
- **Current MultiServerSSE:** `packages/core/src/sse/multi-server-sse.ts`
- **Discovery Pattern:** `apps/web/src/app/api/opencode-servers/route.ts`
- **Router System:** `packages/core/src/router/` (builder pattern for type-safe routes)
- **Zustand Store:** `packages/react/src/store/store.ts` (DirectoryState pattern)

### Past Agent Work
- **SSE Proxy Investigation:** `docs/investigations/sse-infinite-loop-2025-12-30.md`
- **Provider Elimination Research:** `docs/audits/08-SESSION-HOOK-SPRAWL-AUDIT.md`
- **Hivemind learnings:** Search for "SSE proxy", "uploadthing", "provider ceremony"

---

## Sign-Off

This ADR unifies two critical improvements into a **single coherent architecture**:

1. **Same-Origin Access** - All traffic proxied through Next.js, eliminating CORS
2. **Zero Ceremony** - Factory + SSR plugin eliminates provider wrappers

The result: **Mobile works. Tailscale works. Zero configuration. Zero providers. Just works.**

**Implementation Status:**

- ✅ **ADR-011 Phase 1** - SSE proxy complete
- ⏳ **ADR-011 Phase 2** - Full API proxy (this ADR)
- ⏳ **ADR-012 Full** - Provider-free architecture (this ADR)
- ⏳ **Integration** - Unified testing and deployment

**Next Steps:**

1. Implement `/api/opencode/[port]/[[...path]]` proxy route
2. Update SDK client URL generation
3. Create `<OpencodeSSRPlugin>` and `generateOpencodeHelpers()`
4. Migrate web app to factory pattern
5. Test on mobile and Tailscale
6. Ship it. 🚀
