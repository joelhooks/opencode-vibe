# Continuation Prompt: Full API Proxy + Provider-Free Architecture

**Use this prompt to continue ADR-011/012 implementation in a fresh context.**

---

## Context

### What's Done (ADR-011 Phase 1)
- ✅ SSE proxy: `/api/sse/[port]/route.ts` - proxies SSE streams
- ✅ `MultiServerSSE` uses `/api/sse/${port}` for SSE connections
- ✅ SSE works on mobile/Tailscale

### What's Broken
- ❌ SDK client still hits `http://localhost:4056` directly for API calls
- ❌ CORS errors on mobile for: `/session`, `/provider`, `/session/status`, `/session/messages`
- ❌ Provider ceremony still required

### What's Needed
1. **Full API proxy** - Route ALL SDK calls through Next.js (not just SSE)
2. **Provider elimination** - uploadthing-style factory + SSR plugin pattern

---

## Task: Implement Full API Proxy Following uploadthing Pattern

### Architecture Reference

The codebase has a router system inspired by uploadthing:

```
packages/core/src/router/
├── adapters/
│   ├── next.ts          # createNextHandler(), createAction()
│   └── direct.ts        # createCaller() for direct invocation
├── builder.ts           # Route builder with Zod validation
├── routes.ts            # Route definitions (session.list, session.get, etc.)
├── executor.ts          # Effect-based execution
└── stream.ts            # SSE streaming support
```

**Key insight from `adapters/next.ts`:**
```typescript
// Already exists! Routes resolve via ?path=session.list
export function createNextHandler(opts: NextHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.searchParams.get("path")  // e.g., "session.list"
    const route = opts.router.resolve(path)
    // ... execute route, return response
  }
}
```

### Implementation Options

#### Option A: Extend Existing Router (Recommended)

The router already supports Next.js via `createNextHandler()`. We just need to:

1. **Create a catch-all API route** that uses the existing router:

```typescript
// apps/web/src/app/api/opencode/[port]/route.ts
import { createNextHandler, createRouter, createRoutes } from "@opencode-vibe/core/router"
import { createClient } from "@opencode-vibe/core/client"

const router = createRouter(createRoutes())

const handler = createNextHandler({
  router,
  createContext: async (req) => {
    const url = new URL(req.url)
    const port = url.pathname.split('/')[3] // Extract port from /api/opencode/[port]
    
    // Create client pointing to localhost:[port]
    return {
      sdk: createClient(`http://127.0.0.1:${port}`)
    }
  }
})

export { handler as GET, handler as POST }
```

2. **Update `createClient()`** to use proxy URLs:

```typescript
// packages/core/src/client/client.ts
export function createClient(directory?: string, sessionId?: string): OpencodeClient {
  let discoveredUrl: string | undefined

  if (sessionId && directory) {
    // Returns /api/opencode/${port} for API calls
    discoveredUrl = multiServerSSE.getApiUrlForSession(sessionId, directory)
  } else if (directory) {
    discoveredUrl = multiServerSSE.getApiUrlForDirectory(directory)
  }

  const serverUrl = discoveredUrl ?? OPENCODE_URL
  return createOpencodeClient({ baseUrl: serverUrl, directory })
}
```

3. **Add separate URL methods to MultiServerSSE**:

```typescript
// packages/core/src/sse/multi-server-sse.ts

// For SSE connections (existing)
getBaseUrlForSession(sessionId, directory): string | undefined {
  return `/api/sse/${port}`
}

// For API calls (NEW)
getApiUrlForSession(sessionId, directory): string | undefined {
  return `/api/opencode/${port}`
}
```

#### Option B: Simple Catch-All Proxy

If the router approach is too complex, create a simple proxy:

```typescript
// apps/web/src/app/api/opencode/[port]/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ port: string; path: string[] }> }
) {
  const { port, path } = await params
  const targetPath = path.join('/')
  const url = new URL(request.url)
  
  const response = await fetch(
    `http://127.0.0.1:${port}/${targetPath}${url.search}`,
    {
      headers: request.headers,
    }
  )
  
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  })
}

export async function POST(request: NextRequest, context: any) {
  // Similar, but forward body
}
```

### Provider Elimination (ADR-012)

After API proxy works, implement uploadthing-style factory:

1. **Create `OpencodeSSRPlugin`**:
```typescript
// packages/react/src/next-ssr-plugin.tsx
"use client"
import { useServerInsertedHTML } from "next/navigation"

export function OpencodeSSRPlugin({ config }: { 
  config: { baseUrl: string; directory: string } 
}) {
  useServerInsertedHTML(() => (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__OPENCODE = ${JSON.stringify(config)};`,
      }}
    />
  ))
  return null
}
```

2. **Create `generateOpencodeHelpers()` factory**:
```typescript
// packages/react/src/factory.ts
export function generateOpencodeHelpers() {
  const getConfig = () => {
    if (typeof window !== "undefined" && (window as any).__OPENCODE) {
      return (window as any).__OPENCODE
    }
    throw new Error("OpenCode: No config. Did you forget <OpencodeSSRPlugin>?")
  }

  return {
    useSession(id: string) {
      const { directory } = getConfig()
      return useOpencodeStore(state => 
        state.directories[directory]?.sessions.find(s => s.id === id)
      )
    },
    // ... other hooks
  }
}
```

3. **Update app layout**:
```tsx
// apps/web/src/app/layout.tsx
import { OpencodeSSRPlugin } from "@opencode-vibe/react/next-ssr-plugin"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <OpencodeSSRPlugin config={{ 
          baseUrl: "/api/opencode", 
          directory: process.env.OPENCODE_DIRECTORY 
        }} />
        {children}
      </body>
    </html>
  )
}
```

---

## Files to Create/Modify

### Phase 1: API Proxy
1. `apps/web/src/app/api/opencode/[port]/route.ts` - NEW (router-based proxy)
   OR `apps/web/src/app/api/opencode/[port]/[...path]/route.ts` - NEW (simple proxy)
2. `packages/core/src/sse/multi-server-sse.ts` - Add `getApiUrlForSession()`, `getApiUrlForDirectory()`
3. `packages/core/src/client/client.ts` - Use API proxy URLs

### Phase 2: Provider Elimination
4. `packages/react/src/next-ssr-plugin.tsx` - NEW
5. `packages/react/src/factory.ts` - NEW
6. `apps/web/src/app/layout.tsx` - Replace provider with plugin
7. `apps/web/src/app/hooks.ts` - NEW (single source of hooks)

---

## Success Criteria

- [ ] All API calls proxy through Next.js (no direct localhost)
- [ ] Mobile/Tailscale can load sessions, messages, providers
- [ ] SSE still works via `/api/sse/[port]`
- [ ] No `<OpenCodeProvider>` wrapper needed
- [ ] Hooks work via factory pattern
- [ ] Tests pass
- [ ] Typecheck passes

---

## Related Files

- ADR-011: `docs/adr/011-sse-proxy-architecture.md`
- ADR-012: `docs/adr/012-provider-removal-ssr.md`
- Router: `packages/core/src/router/`
- Next adapter: `packages/core/src/router/adapters/next.ts`
- Client: `packages/core/src/client/client.ts`
- MultiServerSSE: `packages/core/src/sse/multi-server-sse.ts`
- Bug cell: `opencode-next--xts0a-mjtfdahejym`

---

## Reference: uploadthing Pattern

```tsx
// How uploadthing does it (our inspiration)

// 1. Server router definition
const f = createUploadthing()
export const uploadRouter = { 
  imageUploader: f({ image: { maxFileSize: "4MB" } })
    .onUploadComplete(({ file }) => ({ url: file.url })) 
}

// 2. SSR plugin in layout (injects config to globalThis)
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin"
<NextSSRPlugin routerConfig={extractRouterConfig(uploadRouter)} />

// 3. Factory-generated hooks (no provider needed)
import { generateReactHelpers } from "@uploadthing/react"
const { useUploadThing } = generateReactHelpers<typeof uploadRouter>()

// 4. Usage - just works
const { startUpload } = useUploadThing("imageUploader")
```

---

## Quick Start Command

```bash
# Create the swarm
/swarm "Implement ADR-011 Phase 2: Full API proxy + ADR-012 provider elimination following uploadthing pattern. See docs/guides/CONTINUATION_API_PROXY.md for details."
```
