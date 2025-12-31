# Pattern Comparison Matrix - ADR-013

**Synthesized Research:** uploadthing, tRPC, oRPC, OpenCode Core Router

**Date:** 2025-12-31

---

## Executive Summary

This document synthesizes research from four RPC/SDK architectures to inform OpenCode's unified same-origin architecture (ADR-013). Each library solves different constraints:

- **uploadthing**: Multi-framework factory pattern with SSR plugin for zero-hydration
- **tRPC**: Proxy-based type inference with React Query integration
- **oRPC**: Simplified proxy pattern with contract-first design and SSR singleton optimization
- **OpenCode Core Router**: 4-layer Effect-based builder with streaming support

**Recommended Hybrid Approach:**

```
uploadthing factory DX + tRPC type inference + oRPC SSR singleton + OpenCode streaming
```

---

## Pattern Comparison Table

| Pattern Dimension | uploadthing | tRPC | oRPC | OpenCode Current | OpenCode Recommended |
|-------------------|-------------|------|------|------------------|----------------------|
| **Factory Pattern** | ✅ `generateReactHelpers<T>()` | ❌ Direct proxy | ✅ `createORPCClient<T>()` | ❌ Builder chains | ✅ Hybrid factory |
| **Type Inference** | Identity proxy (runtime pass-through) | Mapped types + Proxy | Conditional mapped types | Effect Schemas + builder | Proxy + mapped types |
| **Provider-Free** | ✅ Yes (factory binds types) | ❌ No (needs `TRPCProvider`) | ✅ Yes (factory-based) | ❌ Needs `OpenCodeProvider` | ✅ Yes (factory) |
| **SSR Hydration** | `UploadThingProvider` + `useServerInsertedHTML` | React Query hydration | SSR singleton (zero-hydration) | Manual SSE setup | SSR singleton |
| **Type Safety** | Generic binding at factory call | Type-only router import | Contract-first schemas | Effect Schemas | Hybrid (runtime + compile-time) |
| **Multi-Instance** | ✅ Yes (factory per config) | ❌ No (global provider) | ✅ Yes (factory per contract) | ❌ No (singleton) | ✅ Yes (factory) |
| **Streaming** | ❌ No | ❌ No | ✅ Server Actions streaming | ✅ Effect Stream + SSE | ✅ Enhanced streaming |
| **Framework Lock-in** | React-specific hooks | React Query required | React/Next.js only | Framework-agnostic | React-optimized |
| **Dependencies** | Minimal | React Query + Proxy | Minimal | Effect + Hono | Effect + minimal |
| **Bundle Size** | Small (~5KB) | Large (React Query) | Small (~3KB) | Medium (Effect) | Medium |

---

## Type Inference Comparison

### 1. uploadthing - Identity Proxy Pattern

**How types flow:**

```typescript
// 1. Factory binds FileRouter type at creation
export const generateReactHelpers = <TRouter extends FileRouter>() => {
  return {
    useUploadThing: <TEndpoint extends keyof TRouter>(
      endpoint: TEndpoint
    ) => {
      // Type inference: TRouter[TEndpoint] flows through
      type InferredInput = inferEndpointInput<TRouter[TEndpoint]>;
      type InferredOutput = inferEndpointOutput<TRouter[TEndpoint]>;
      
      return {
        startUpload: (files: File[]) => 
          Promise<InferredOutput> // Full type safety
      };
    }
  };
};

// 2. Usage - types bound at factory call
const { useUploadThing } = generateReactHelpers<MyFileRouter>();

// 3. Hook call - endpoint autocomplete + type checking
const { startUpload } = useUploadThing("imageUploader");
//                                      ^^^^^^^^^^^^^^^ - autocomplete from keyof MyFileRouter
```

**Key insights:**
- **Generic binding at factory call** - types flow from `generateReactHelpers<T>()`
- **Identity proxy** - runtime pass-through, compile-time type extraction
- **No runtime overhead** - types erased at compile time
- **Multi-instance safe** - each factory call creates independent type binding

---

### 2. tRPC - Mapped Types + Recursive Proxy

**How types flow:**

```typescript
// 1. Type-only import (no runtime code)
import type { AppRouter } from './server/router';

// 2. Client factory with generic
const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })]
});

// 3. Proxy intercepts property access
const createRecursiveProxy = <T>(callback: ProxyCallback) => {
  return new Proxy(
    () => {}, // Dummy function
    {
      get(_target, path) {
        // Recursively build path: user.getById.query
        return createRecursiveProxy((args) => callback([path, ...args]));
      },
      apply(_target, _this, args) {
        // Terminal operation: execute RPC call
        return callback(args);
      }
    }
  );
};

// 4. Mapped types extract procedures
type CreateTRPCProxyClient<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Router
    ? CreateTRPCProxyClient<TRouter[K]> // Recurse into nested routers
    : TRouter[K] extends Procedure
    ? ProcedureToClient<TRouter[K]> // Convert procedure to client method
    : never;
};

// 5. Usage - full type inference
const user = await client.user.getById.query({ id: 123 });
//    ^^^^ - inferred from AppRouter.user.getById output type
```

**Key insights:**
- **Recursive proxy** - builds procedure path dynamically (`user.getById.query`)
- **Mapped types** - transforms server router type to client type
- **Type-only import** - zero runtime cost for router type
- **Deep autocomplete** - nested routers fully typed

---

### 3. oRPC - Conditional Mapped Types + Simplified Proxy

**How types flow:**

```typescript
// 1. Contract-first schema definition
const userContract = {
  getById: {
    input: z.object({ id: z.number() }),
    output: z.object({ id: z.number(), name: z.string() })
  }
};

// 2. Client factory with contract type
const client = createORPCClient<typeof userContract>({
  baseURL: '/api/orpc'
});

// 3. Simpler proxy (no recursion for nested routers)
export function createORPCClient<T extends NestedContract>(opts) {
  return new Proxy({} as any, {
    get(_, path: string) {
      return async (input: any) => {
        const res = await fetch(`${opts.baseURL}/${path}`, {
          method: 'POST',
          body: JSON.stringify(input)
        });
        return res.json();
      };
    }
  }) as ORPCClient<T>;
}

// 4. Conditional mapped type for SSR optimization
type ORPCClient<T> = {
  [K in keyof T]: T[K] extends { input: infer I; output: infer O }
    ? (input: I) => Promise<O> // Direct function call
    : T[K] extends NestedContract
    ? ORPCClient<T[K]> // Recurse
    : never;
};

// 5. Usage - simpler API than tRPC
const user = await client.getById({ id: 123 });
//    ^^^^ - inferred from contract.getById.output
```

**Key insights:**
- **Contract-first** - Zod schemas define types (runtime + compile-time)
- **Simplified proxy** - no `.query`/`.mutate` suffixes, just function calls
- **Conditional mapped types** - cleaner type transformations
- **SSR singleton** - server-side client uses global cache (zero hydration overhead)

---

### 4. OpenCode Current - Effect Schemas + Builder Pattern

**How types flow:**

```typescript
// 1. Builder defines route with Effect Schemas
const route = Route.builder()
  .path("/user/:id")
  .method("GET")
  .params(Schema.Struct({ id: Schema.NumberFromString }))
  .response(Schema.Struct({ id: Schema.Number, name: Schema.String }))
  .effect((req) => 
    Effect.gen(function* () {
      const { id } = req.params;
      const user = yield* UserService.getById(id);
      return user;
    })
  );

// 2. Router aggregates routes
const router = Router.builder()
  .mount("/api", route)
  .toHandler();

// 3. Client SDK (manually generated)
class UserAPI {
  getById(id: number): Effect.Effect<User, HttpError> {
    return Effect.gen(function* () {
      const res = yield* HttpClient.get(`/api/user/${id}`);
      return yield* Schema.decode(UserSchema)(res);
    });
  }
}

// 4. Usage - Effect-based
const program = Effect.gen(function* () {
  const user = yield* UserAPI.getById(123);
  //    ^^^^ - type from Schema
  return user;
});
```

**Key insights:**
- **Schema-driven** - Effect Schemas provide runtime validation + compile-time types
- **Builder pattern** - explicit route definition (verbose but type-safe)
- **Manual client generation** - no automatic type inference from router
- **Effect-first** - streaming, error handling, dependency injection built-in

---

## Type Inference Winner: Hybrid Approach

**Recommended:**

```typescript
// Combine best of all worlds:

// 1. Factory pattern (uploadthing-style)
export const createOpenCodeClient = <TRouter extends Router>() => {
  
  // 2. Proxy for type inference (tRPC-style)
  const createProxy = <T>(): T => {
    return new Proxy({} as any, {
      get(_, path: string) {
        return async (input: any) => {
          // 3. Effect runtime (OpenCode current)
          return Effect.runPromise(
            Effect.gen(function* () {
              const res = yield* HttpClient.post(`/${path}`, input);
              // 4. Schema validation (oRPC-style contract)
              return yield* Schema.decode(/* inferred from TRouter */)(res);
            })
          );
        };
      }
    });
  };
  
  return {
    // SSR-aware (oRPC-style singleton)
    client: typeof window === 'undefined' 
      ? getCachedClient<TRouter>() 
      : createProxy<ClientFrom<TRouter>>()
  };
};
```

**Benefits:**
- **Factory DX** - clean import, multi-instance support
- **Proxy type inference** - automatic client typing from router
- **Effect runtime** - streaming, error handling, observability
- **SSR optimization** - zero hydration overhead
- **Schema validation** - runtime safety + compile-time types

---

## SSR Hydration Comparison

### uploadthing - useServerInsertedHTML Plugin

```typescript
// 1. Provider caches SSR data in global Map
const ssrDataCache = new Map<string, unknown>();

export function UploadThingProvider({ children }) {
  // 2. Inject cache into HTML during SSR
  useServerInsertedHTML(() => {
    const data = Array.from(ssrDataCache.entries());
    return (
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__UPLOADTHING_SSR__=${JSON.stringify(data)}`
        }}
      />
    );
  });
  
  return children;
}

// 3. Client hook reads from cache
export function useUploadThing(endpoint: string) {
  const [data, setData] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.__UPLOADTHING_SSR__?.[endpoint];
    }
    return undefined;
  });
  
  // ... rest of hook
}
```

**Pros:**
- Zero network request on client mount (data pre-serialized)
- Works with React 18 streaming SSR
- Simple API (`useServerInsertedHTML`)

**Cons:**
- Requires provider (breaks factory-only pattern)
- Global state (`window.__UPLOADTHING_SSR__`)
- Manual cache invalidation

---

### tRPC - React Query Hydration

```typescript
// 1. Server: Pre-fetch data during SSR
import { createServerSideHelpers } from '@trpc/react-query/server';

export async function getServerSideProps() {
  const helpers = createServerSideHelpers({
    router: appRouter,
    ctx: {}
  });
  
  // Pre-fetch queries
  await helpers.user.getById.fetch({ id: 123 });
  
  return {
    props: {
      trpcState: helpers.dehydrate() // Serialize React Query cache
    }
  };
}

// 2. Client: Hydrate React Query cache
export function MyApp({ Component, pageProps }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => createTRPCClient({ ... }));
  
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Hydrate state={pageProps.trpcState}>
          <Component {...pageProps} />
        </Hydrate>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

**Pros:**
- Leverages React Query's built-in hydration
- Cache invalidation handled by React Query
- Works with prefetching strategies

**Cons:**
- Requires React Query dependency (large bundle)
- Complex provider setup
- Not optimized for App Router RSC

---

### oRPC - SSR Singleton (Zero Hydration)

```typescript
// 1. Singleton cache for server-side client
const serverClientCache = new Map<string, any>();

export function createORPCClient<T>(opts) {
  // 2. Server: Return cached singleton
  if (typeof window === 'undefined') {
    const cacheKey = opts.baseURL;
    if (!serverClientCache.has(cacheKey)) {
      serverClientCache.set(cacheKey, createProxyClient<T>(opts));
    }
    return serverClientCache.get(cacheKey)!;
  }
  
  // 3. Client: Create fresh instance
  return createProxyClient<T>(opts);
}

// Usage in RSC - no hydration needed
export async function UserProfile({ id }: { id: number }) {
  const client = createORPCClient<AppContract>({ baseURL: '/api/orpc' });
  const user = await client.getById({ id }); // Direct server call
  
  return <div>{user.name}</div>; // Rendered on server
}
```

**Pros:**
- **Zero hydration overhead** - no data serialization/deserialization
- **Singleton pattern** - one client instance per server request
- **RSC-native** - works seamlessly with Next.js App Router
- **No provider needed** - factory handles instance management

**Cons:**
- Server-only optimization (client still needs separate fetch)
- Cache invalidation manual (but less important in RSC)

---

## SSR Hydration Winner: oRPC Singleton Pattern

**Why:**
- **Zero-cost abstraction** for RSC (no hydration)
- **Factory-based** (no provider wrapper)
- **Simple implementation** (20 lines vs uploadthing's 100+ or tRPC's React Query integration)

**Recommended for OpenCode:**

```typescript
// Singleton cache (server-side only)
const serverClientCache = new Map<string, OpencodeClient>();

export const createOpencodeClient = <TRouter extends Router>(opts: {
  baseUrl: string;
  directory?: string;
}) => {
  // SSR: Return cached singleton
  if (typeof window === 'undefined') {
    const cacheKey = `${opts.baseUrl}:${opts.directory}`;
    if (!serverClientCache.has(cacheKey)) {
      serverClientCache.set(cacheKey, new OpencodeClient(opts));
    }
    return serverClientCache.get(cacheKey)!;
  }
  
  // Client: Fresh instance with SSE support
  return new OpencodeClient(opts);
};
```

---

## Recommended Hybrid Approach for OpenCode

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                        │
│  React Server Components + Server Actions + Client Hooks   │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
┌─────────────────────────────────────────────────────────────┐
│                      SDK LAYER (NEW)                        │
│  Factory Pattern + Proxy Type Inference + SSR Singleton     │
│                                                             │
│  createOpencodeClient<TRouter>({                            │
│    baseUrl: string,                                         │
│    directory?: string                                       │
│  })                                                         │
│                                                             │
│  Returns:                                                   │
│  - Proxy client with full type inference (tRPC-style)       │
│  - SSR singleton optimization (oRPC-style)                  │
│  - Effect-based runtime (OpenCode current)                  │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
┌─────────────────────────────────────────────────────────────┐
│                   CORE ROUTER (CURRENT)                     │
│  Effect-based 4-layer system with streaming                │
│  - Builder API for route definition                         │
│  - Schema validation (Effect Schemas)                       │
│  - SSE streaming support                                    │
│  - Error handling + observability                           │
└─────────────────────────────────────────────────────────────┘
```

### Code Patterns

#### 1. Factory Function (uploadthing-inspired)

```typescript
// packages/react/src/create-opencode-client.ts

import type { Router } from '@opencode/core';

/**
 * Factory function that creates type-safe OpenCode client
 * 
 * @example
 * ```ts
 * import type { AppRouter } from './server/router';
 * 
 * const opencode = createOpencodeClient<AppRouter>({
 *   baseUrl: '/api/opencode',
 *   directory: '/path/to/project'
 * });
 * 
 * // Full type inference
 * const sessions = await opencode.session.list();
 * //    ^^^^^^^^ - Type: Session[]
 * ```
 */
export function createOpencodeClient<TRouter extends Router>(opts: {
  baseUrl: string;
  directory?: string;
}) {
  // SSR singleton optimization (oRPC-style)
  if (typeof window === 'undefined') {
    return getCachedServerClient<TRouter>(opts);
  }
  
  // Client: Fresh instance with SSE
  return createProxyClient<TRouter>(opts);
}
```

#### 2. Proxy Type Inference (tRPC-inspired)

```typescript
// packages/react/src/proxy-client.ts

type InferClientFromRouter<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Router
    ? InferClientFromRouter<TRouter[K]> // Recurse
    : TRouter[K] extends Procedure<infer I, infer O>
    ? (input: I) => Effect.Effect<O, HttpError> // Convert to Effect
    : never;
};

function createProxyClient<TRouter>(opts: ClientOptions): InferClientFromRouter<TRouter> {
  return new Proxy({} as any, {
    get(target, path: string) {
      return (input: any) => {
        return Effect.gen(function* () {
          const res = yield* HttpClient.post(`${opts.baseUrl}/${path}`, {
            body: JSON.stringify(input),
            headers: {
              'x-opencode-directory': opts.directory ?? ''
            }
          });
          
          // Schema validation from router type
          return yield* Schema.decode(/* inferred */)(res);
        });
      };
    }
  });
}
```

#### 3. SSR Singleton (oRPC-inspired)

```typescript
// packages/react/src/server-client.ts

const serverClientCache = new Map<string, any>();

function getCachedServerClient<TRouter>(opts: ClientOptions) {
  const cacheKey = `${opts.baseUrl}:${opts.directory}`;
  
  if (!serverClientCache.has(cacheKey)) {
    serverClientCache.set(
      cacheKey,
      createProxyClient<TRouter>(opts)
    );
  }
  
  return serverClientCache.get(cacheKey)!;
}
```

#### 4. React Hooks (uploadthing-inspired factory)

```typescript
// packages/react/src/hooks.ts

export function createOpencodeHooks<TRouter extends Router>() {
  return {
    /**
     * Hook for real-time session updates via SSE
     */
    useSession(sessionId: string) {
      const [session, setSession] = useState<Session | null>(null);
      const client = useOpencodeClient<TRouter>();
      
      useEffect(() => {
        const stream = client.session.subscribe(sessionId);
        
        Effect.runPromise(
          Effect.gen(function* () {
            for await (const update of stream) {
              setSession(update);
            }
          })
        );
      }, [sessionId]);
      
      return session;
    },
    
    /**
     * Hook for SSE event stream
     */
    useSSE(directory: string) {
      const client = useOpencodeClient<TRouter>();
      const [events, setEvents] = useState<Event[]>([]);
      
      useEffect(() => {
        const stream = client.global.event({ directory });
        
        Effect.runPromise(
          Effect.gen(function* () {
            for await (const event of stream) {
              setEvents(prev => [...prev, event]);
            }
          })
        );
      }, [directory]);
      
      return events;
    }
  };
}
```

#### 5. Usage Example

```typescript
// app/layout.tsx (RSC)

import type { AppRouter } from '@/server/router';
import { createOpencodeClient } from '@opencode/react';

export default async function RootLayout({ children }) {
  // SSR: Uses singleton cache (zero hydration)
  const opencode = createOpencodeClient<AppRouter>({
    baseUrl: process.env.OPENCODE_URL!,
    directory: process.env.PROJECT_DIR
  });
  
  // Direct server call (no fetch overhead)
  const sessions = await Effect.runPromise(
    opencode.session.list({ limit: 5 })
  );
  
  return (
    <html>
      <body>
        <SessionList sessions={sessions} />
        {children}
      </body>
    </html>
  );
}
```

```typescript
// app/session/[id]/page.tsx (Client Component)

'use client';

import type { AppRouter } from '@/server/router';
import { createOpencodeHooks } from '@opencode/react';

const { useSession, useSSE } = createOpencodeHooks<AppRouter>();

export default function SessionPage({ params }: { params: { id: string } }) {
  // Real-time updates via SSE
  const session = useSession(params.id);
  const events = useSSE('/path/to/project');
  
  if (!session) return <div>Loading...</div>;
  
  return (
    <div>
      <h1>{session.title}</h1>
      <MessageList messages={session.messages} />
    </div>
  );
}
```

---

## Migration Strategy

### Phase 1: SDK Layer (Week 1)

**Goal:** Create factory-based client with proxy type inference

**Tasks:**
1. Create `packages/react/src/create-opencode-client.ts`
2. Implement proxy client with mapped types
3. Add SSR singleton optimization
4. Write tests for type inference

**Files to create:**
- `packages/react/src/create-opencode-client.ts` - Factory function
- `packages/react/src/proxy-client.ts` - Proxy implementation
- `packages/react/src/server-client.ts` - SSR singleton
- `packages/react/src/types.ts` - Type utilities

**Success criteria:**
- [ ] Factory creates type-safe client from router type
- [ ] Proxy intercepts property access and builds paths
- [ ] SSR singleton returns cached instance
- [ ] Full autocomplete in IDE

---

### Phase 2: React Hooks (Week 2)

**Goal:** Create provider-free hooks with SSE support

**Tasks:**
1. Implement `createOpencodeHooks<TRouter>()`
2. Add `useSession` hook with SSE streaming
3. Add `useSSE` hook for global events
4. Migrate existing hooks to factory pattern

**Files to create:**
- `packages/react/src/hooks.ts` - Hook factory
- `packages/react/src/use-session.ts` - Session hook
- `packages/react/src/use-sse.ts` - SSE hook

**Success criteria:**
- [ ] Hooks work without provider wrapper
- [ ] SSE streaming functional
- [ ] Type inference from router type
- [ ] Zero hydration overhead in RSC

---

### Phase 3: Migration (Week 3)

**Goal:** Replace `OpenCodeProvider` with factory pattern

**Tasks:**
1. Update `apps/web/src/app/layout.tsx` to use factory
2. Migrate client components to new hooks
3. Remove `OpenCodeProvider`
4. Update documentation

**Files to modify:**
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/session/[id]/page.tsx`
- `apps/web/src/components/**/*.tsx`

**Success criteria:**
- [ ] No provider wrappers
- [ ] SSE functional in production
- [ ] Type errors caught at compile time
- [ ] Bundle size reduced (no provider overhead)

---

## Key Takeaways

### Pattern Winners

| Dimension | Winner | Rationale |
|-----------|--------|-----------|
| **Factory DX** | uploadthing | Clean API, multi-instance support |
| **Type Inference** | tRPC | Proxy + mapped types = full autocomplete |
| **SSR Optimization** | oRPC | Singleton pattern = zero hydration |
| **Streaming** | OpenCode | Effect Streams + SSE = real-time |
| **Overall** | **Hybrid** | Combine best of all worlds |

### Anti-Patterns to Avoid

1. **Provider Hell** (current OpenCode + tRPC)
   - Factory pattern eliminates provider wrappers
   
2. **Manual Client Generation** (current OpenCode)
   - Proxy + mapped types = automatic type inference
   
3. **Hydration Overhead** (uploadthing + tRPC)
   - SSR singleton = zero serialization cost
   
4. **Framework Lock-in** (tRPC React Query)
   - Effect runtime = portable across frameworks

---

## References

**Hivemind Memories:**
- `mem-812fba6557da5629` - OpenCode Core Router Architecture
- `mem-260a3f65e79d260f` - uploadthing Factory Pattern
- `mem-64ca1dcbbdc3845f` - tRPC Proxy Pattern
- `mem-621dfa2a7a68ba46` - tRPC vs uploadthing Comparison
- `mem-b95c3f4fba1898bd` - oRPC Implementation Patterns
- `mem-90f09167e4bf9fb6` - oRPC Factory Pattern Research

**External:**
- [uploadthing GitHub](https://github.com/pingdotgg/uploadthing)
- [tRPC GitHub](https://github.com/trpc/trpc)
- [oRPC GitHub](https://github.com/unnoq/orpc)
- [Effect-TS](https://effect.website)

---

**Next Steps:**
1. Review this matrix with team
2. Validate hybrid approach with prototype
3. Begin Phase 1 (SDK Layer) implementation
4. Document migration guide for existing code
