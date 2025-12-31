# ADR 012: Provider-Free Architecture with SSR Hydration

**Status:** Proposed  
**Date:** 2025-12-31  
**Deciders:** Joel Hooks, Architecture Team  
**Affected Components:** React package, web app, Next.js integration  
**Related ADRs:** ADR-009 (DX Overhaul), ADR-010 (Store Architecture)

---

## Executive Summary

Eliminate the `<OpenCodeProvider>` ceremony by adopting uploadthing's factory + SSR plugin pattern:

- **Factory Pattern:** `generateOpencodeHelpers()` creates hooks without provider context
- **SSR Plugin:** `<OpencodeSSRPlugin>` hydrates `globalThis` for zero-latency client access
- **Zero Runtime Overhead:** No React context, no client-side config fetches

---

## Context

### Current Provider Ceremony

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <OpenCodeProvider baseUrl="http://localhost:3100" directory="/path/to/project">
      {children}
    </OpenCodeProvider>
  )
}

// app/session/[id]/page.tsx
export default function SessionPage({ params }) {
  const session = useSession(params.id) // Reads from context
}
```

**Problems:**

1. **Boilerplate:** Every app needs provider wrapper
2. **Server/Client Split:** Config duplication between server and client
3. **Hydration Loading State:** Client doesn't know config until React hydrates
4. **No Type Safety:** `baseUrl` and `directory` are runtime strings, not compile-time checked

### The uploadthing Solution

uploadthing eliminates providers entirely:

```tsx
// server/uploadthing.ts
const f = createUploadthing()
export const uploadRouter = { imageUploader: f({ image: { maxFileSize: "4MB" } }).onUploadComplete(async ({ file }) => { return { url: file.url } }) }

// app/layout.tsx
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin"
import { extractRouterConfig } from "uploadthing/server"

export default function RootLayout({ children }) {
  return (
    <>
      <NextSSRPlugin routerConfig={extractRouterConfig(uploadRouter)} />
      {children}
    </>
  )
}

// components/uploader.tsx
import { generateReactHelpers } from "@uploadthing/react"
const { useUploadThing } = generateReactHelpers<typeof uploadRouter>()

export function Uploader() {
  const { startUpload } = useUploadThing("imageUploader") // NO PROVIDER
}
```

**How it works:**

1. **Server:** `extractRouterConfig()` serializes router metadata to JSON
2. **SSR Plugin:** Uses `useServerInsertedHTML` to inject `<script>window.__UPLOADTHING = {...}</script>`
3. **Client:** Script runs before React hydrates, populating `globalThis`
4. **Hooks:** Factory-generated hooks check `globalThis.__UPLOADTHING` first, fallback to API fetch

---

## Decision

Adopt uploadthing's architecture with OpenCode-specific adaptations.

### 1. Factory Pattern (No Provider Context)

**Create `generateOpencodeHelpers()` factory:**

```tsx
// packages/react/src/factory.ts
import { createOpencodeClient } from "@opencode-vibe/core"

export function generateOpencodeHelpers<TRouter = any>(config?: {
  baseUrl?: string
  directory?: string
}) {
  // Resolve config from globalThis or fallback to provided config
  const getConfig = () => {
    if (typeof window !== "undefined" && (window as any).__OPENCODE) {
      return (window as any).__OPENCODE as { baseUrl: string; directory: string }
    }
    if (!config?.baseUrl) {
      throw new Error("OpenCode: No config found. Did you forget <OpencodeSSRPlugin>?")
    }
    return config
  }

  return {
    useSession(sessionId: string) {
      const { baseUrl, directory } = getConfig()
      const client = useMemo(() => createOpencodeClient({ baseUrl, directory }), [baseUrl, directory])
      // ... rest of hook implementation using Zustand store
    },
    
    useSendMessage(options: { sessionId: string }) {
      const { baseUrl, directory } = getConfig()
      // ... implementation
    },
    
    // ... other hooks
  }
}
```

**Usage (no provider):**

```tsx
// app/hooks.ts (create once)
import { generateOpencodeHelpers } from "@opencode-vibe/react"
export const { useSession, useSendMessage } = generateOpencodeHelpers()

// components/session.tsx (use everywhere)
import { useSession } from "@/app/hooks"
export function SessionView({ id }) {
  const session = useSession(id) // Just works, no provider
}
```

### 2. SSR Plugin (globalThis Hydration)

**Create `<OpencodeSSRPlugin>` for Next.js:**

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

**Usage in layout:**

```tsx
// app/layout.tsx
import { OpencodeSSRPlugin } from "@opencode-vibe/react/next-ssr-plugin"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <OpencodeSSRPlugin config={{ baseUrl: "http://localhost:3100", directory: process.cwd() }} />
        {children}
      </body>
    </html>
  )
}
```

### 3. Keep DirectoryState Pattern (Already Optimal)

**No changes needed to Zustand store.** The current `DirectoryState` pattern is already optimal for SSR:

- No persist middleware (no hydration issues)
- SSE wired at provider level via `useMultiServerSSE({ onEvent })`
- Hooks are pure selectors (no local state)
- `getState()` pattern prevents infinite loops

**The factory hooks will use the same Zustand store internally:**

```tsx
export function generateOpencodeHelpers() {
  return {
    useSession(id: string) {
      const { baseUrl, directory } = getConfig()
      
      // Use existing Zustand store pattern
      const session = useOpencodeStore(state => 
        state.sessions.find(s => s.id === id)
      )
      
      return session
    }
  }
}
```

---

## Implementation Plan

### Phase 1: Create OpencodeSSRPlugin (1 hour)

**Files:**
- `packages/react/src/next-ssr-plugin.tsx`
- `packages/react/src/next-ssr-plugin.test.tsx` (render test, check script injection)

**Success criteria:**
- Plugin injects `<script>window.__OPENCODE = {...}</script>`
- Script runs before React hydration
- `globalThis.__OPENCODE` accessible in client components

### Phase 2: Create generateOpencodeHelpers Factory (2 hours)

**Files:**
- `packages/react/src/factory.ts`
- `packages/react/src/factory.test.ts`

**Implementation:**
- Factory creates hooks without React context
- Hooks check `globalThis.__OPENCODE` first, fallback to config parameter
- Reuse existing Zustand store pattern internally
- Support optional config override for testing

**Success criteria:**
- Factory exports all public hooks (useSession, useSendMessage, etc.)
- Hooks work without provider
- Tests pass with mocked `globalThis.__OPENCODE`

### Phase 3: Migrate Web App to Factory Pattern (1 hour)

**Files:**
- `apps/web/src/app/hooks.ts` (new - single source of hooks)
- `apps/web/src/app/layout.tsx` (replace provider with plugin)
- All component files (update imports)

**Changes:**

```diff
- import { useSession } from "@opencode-vibe/react"
+ import { useSession } from "@/app/hooks"

// app/layout.tsx
- <OpenCodeProvider baseUrl="..." directory="...">
-   {children}
- </OpenCodeProvider>
+ <OpencodeSSRPlugin config={{ baseUrl: "...", directory: "..." }} />
+ {children}
```

**Success criteria:**
- Zero provider wrappers in app
- All hooks imported from `@/app/hooks`
- SSR hydration works with no loading state
- Tests pass, app runs in browser

### Phase 4: Deprecate OpenCodeProvider (30 min)

**Files:**
- `packages/react/src/providers/opencode-provider.tsx`

**Changes:**
- Add `@deprecated` JSDoc comment
- Add console warning when used
- Update docs to recommend factory pattern

**Success criteria:**
- Provider still works (backward compat)
- Deprecation warning shows in console
- Docs updated

---

## Future Work (Not in Scope)

### 1. Builder API (Fluent Chainable Config)

Uploadthing-style fluent API for advanced configuration:

```tsx
import { createOpencode } from "@opencode-vibe/core"

const opencode = createOpencode({
  baseUrl: process.env.OPENCODE_URL,
})
  .middleware((req) => {
    // Auth, logging, etc.
    return { userId: req.headers.get("x-user-id") }
  })
  .onMessage((message) => {
    console.log("New message:", message)
  })

export const { useSession } = opencode.react()
```

### 2. Framework Adapters

**Package entry points for framework-specific optimizations:**

```tsx
// @opencode-vibe/react/next
export { OpencodeSSRPlugin } from "./next-ssr-plugin"
export { generateOpencodeHelpers } from "./factory"

// @opencode-vibe/react/remix
export { OpencodeRemixLoader } from "./remix-loader"

// @opencode-vibe/react/vite
export { OpencodeVitePlugin } from "./vite-plugin"
```

### 3. TypeScript Router Type Inference

Uploadthing-style type inference from server router:

```tsx
// server/router.ts
export const opencodeRouter = createRouter({
  session: {
    messages: { maxLength: 1000 },
  },
})

// client/hooks.ts
const { useSession } = generateOpencodeHelpers<typeof opencodeRouter>()
//      ^? Infers session schema, message constraints, etc.
```

---

## Success Metrics

| Metric | Before | After Phase 4 | Target |
|--------|--------|---------------|--------|
| Provider wrappers needed | 1 | 0 | 0 |
| Lines to setup hooks | ~10 | ~3 | 3 |
| SSR hydration latency | ~50ms | 0ms | 0ms |
| Type safety | Runtime config | Compile-time | Compile-time |
| Client config fetches | 1 API call | 0 (globalThis) | 0 |

---

## Alternatives Considered

### 1. Keep Provider Pattern

**Rejected:** Uploadthing proved providers are unnecessary. Factory + SSR plugin is superior DX.

### 2. Jotai Provider (for SSR)

**Rejected:** Still requires provider wrapper. Worse DX than current approach.

### 3. TanStack Query HydrationBoundary

**Considered:** Similar to `hydrateMessages()` pattern we already use. Not applicable to config hydration (TanStack Query is for data, not config).

### 4. Zustand Persist Middleware

**Rejected:** Current `DirectoryState` pattern is already optimal. Adding persist would require:
- `skipHydration: true` flag
- Manual `rehydrate()` calls
- More complexity for zero benefit (we don't need localStorage persistence)

---

## References

- **uploadthing patterns:** `mem-696bf63e9d9eb7bc` (Hivemind)
- **SSR hydration patterns:** Zustand, Jotai, TanStack Query research
- **Past agent patterns:** ADR-009 provider elimination, SSE proxy architecture
- **ADR-010:** Store Architecture (Zustand + Immer patterns)
- **uploadthing source:** https://github.com/pingdotgg/uploadthing
