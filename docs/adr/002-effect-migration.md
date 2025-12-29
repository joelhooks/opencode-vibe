# ADR 002: @opencode/router - Effect-Powered Async Router

**Status:** Approved  
**Date:** 2025-12-29

---

## TL;DR

Build `@opencode/router` - a type-safe router where handlers are async/await, config is declarative, and Effect runs invisibly underneath. Steal the UploadThing pattern wholesale.

```typescript
const o = createOpencodeRoute();

export const routes = {
  getSession: o({ timeout: "30s" })
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, sdk }) => sdk.session.get(input.id)),

  subscribe: o({
    stream: true,
    retry: "exponential",
    heartbeat: "60s",
  }).handler(async function* ({ sdk }) {
    for await (const event of sdk.global.event()) yield event;
  }),
} satisfies OpencodeRouter;
```

---

## Current Async Inventory

Before building, know what exists. This is the complete async surface area:

### Server-Side (Router Scope)

| File                                             | Lines | Patterns                                             | Router Coverage                                            |
| ------------------------------------------------ | ----- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web/src/app/api/opencode-servers/route.ts` | 150+  | Timeout (2s), concurrency (5), parallel fetch        | `{ concurrency: 5, timeout: "2s" }`                        |
| `apps/web/src/react/use-sse.tsx`                 | 342   | Exponential backoff, heartbeat (60s), visibility API | `{ stream: true, retry: "exponential", heartbeat: "60s" }` |
| `apps/web/src/core/multi-server-sse.ts`          | 454   | Polling (5s), per-server SSE, merge streams          | Discovery route + streaming route                          |
| `apps/web/src/react/use-send-message.ts`         | 208   | FIFO queue, session status gating                    | `{ timeout: "30s" }` for send, queue logic stays in hook   |
| `apps/web/src/react/use-create-session.ts`       | 116   | Simple async/await                                   | `{ timeout: "60s" }`                                       |
| `apps/web/src/react/use-file-search.ts`          | 115   | Debounced fetch (150ms)                              | `{ timeout: "5s" }`                                        |
| `apps/web/src/react/use-providers.ts`            | 94    | useEffect fetch, cancellation                        | `{ timeout: "30s", cache: { ttl: "30s" } }`                |

### Client-Side (NOT Router Scope)

These stay as React hooks - they're client-side concerns:

| Pattern                                  | Location                  | Why Not Router                    |
| ---------------------------------------- | ------------------------- | --------------------------------- |
| Event batching (16ms debounce)           | `use-sse.tsx:209-243`     | Render optimization               |
| Visibility API (pause on background)     | `use-sse.tsx:410-435`     | Browser API                       |
| Session status gating (queue until idle) | `use-send-message.ts:134` | Business logic                    |
| Binary search updates                    | `store.ts`                | State management                  |
| FIFO message queue                       | `use-send-message.ts`     | Application logic wrapping router |

### State Management (NOT Router Scope)

| File                          | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `apps/web/src/react/store.ts` | Zustand + Immer, binary search updates |
| `apps/web/src/core/client.ts` | SDK client factory, session routing    |

---

## Route Configuration

```typescript
type RouteConfig = {
  // Timeout - abort after duration
  timeout?: Duration; // "5s", "30s", "2m"

  // Retry - how to handle failures
  retry?:
    | "none"
    | "exponential" // 1s, 2s, 4s, 8s... capped at 30s
    | "linear" // 1s, 2s, 3s, 4s... capped at 30s
    | {
        type: "exponential" | "linear";
        maxRetries?: number;
        maxDuration?: Duration;
        retryIf?: (error: unknown) => boolean;
      };

  // Concurrency - for batch operations
  concurrency?: number | "unbounded";

  // Streaming - for SSE/real-time
  stream?: boolean;

  // Heartbeat - for streaming routes, reconnect if no event in duration
  // Server sends heartbeat every 30s, client expects event within 60s
  heartbeat?: Duration; // "60s" default for streaming

  // Cache - for repeated calls
  cache?: {
    ttl: Duration;
    key?: (input: unknown) => string;
  };
};
```

---

## Package Structure

```
packages/router/
├── src/
│   ├── builder.ts          # createOpencodeRoute() fluent API
│   ├── router.ts           # createRouter(), route resolution
│   ├── executor.ts         # Effect execution engine
│   ├── stream.ts           # Streaming + heartbeat support
│   ├── errors.ts           # Typed error classes
│   ├── runtime.ts          # ManagedRuntime setup
│   ├── schedule.ts         # Retry schedule builders
│   ├── adapters/
│   │   ├── next.ts         # createNextHandler(), createAction()
│   │   └── direct.ts       # createCaller()
│   ├── types.ts            # Public types
│   └── index.ts            # Public exports
├── effect.ts               # @opencode/router/effect escape hatch
├── package.json
└── tsconfig.json

packages/router-react/
├── src/
│   ├── use-subscription.ts # Streaming hook with visibility API
│   ├── use-query.ts        # Request-response hook
│   └── index.ts
└── package.json
```

---

## Implementation Spec

### 1. Builder API (`builder.ts`)

```typescript
import { z } from "zod";

type Duration = `${number}${"ms" | "s" | "m" | "h"}`;

interface RouteConfig {
  timeout?: Duration;
  retry?: RetryConfig;
  concurrency?: number | "unbounded";
  stream?: boolean;
  heartbeat?: Duration;
  cache?: { ttl: Duration; key?: (input: unknown) => string };
}

interface RouteBuilder<TInput, TOutput, TCtx> {
  input<T extends z.ZodType>(
    schema: T,
  ): RouteBuilder<z.infer<T>, TOutput, TCtx>;
  middleware<T>(
    fn: (ctx: TCtx) => Promise<T>,
  ): RouteBuilder<TInput, TOutput, TCtx & T>;
  handler(fn: HandlerFn<TInput, TOutput, TCtx>): Route<TInput, TOutput>;
  onError(fn: ErrorHandler): RouteBuilder<TInput, TOutput, TCtx>;
}

type HandlerFn<TInput, TOutput, TCtx> =
  | ((ctx: HandlerContext<TInput, TCtx>) => Promise<TOutput>)
  | ((ctx: HandlerContext<TInput, TCtx>) => AsyncGenerator<TOutput>);

interface HandlerContext<TInput, TCtx> {
  input: TInput;
  sdk: OpencodeClient;
  signal: AbortSignal;
  ctx: TCtx;
}

export function createOpencodeRoute() {
  return function o<TConfig extends RouteConfig>(config: TConfig) {
    return {
      input<T extends z.ZodType>(schema: T) {
        return this as RouteBuilder<z.infer<T>, unknown, {}>;
      },
      middleware<T>(fn: (ctx: {}) => Promise<T>) {
        return this as RouteBuilder<unknown, unknown, T>;
      },
      handler<TOutput>(fn: HandlerFn<unknown, TOutput, {}>) {
        return {
          _config: config,
          _inputSchema: undefined,
          _middleware: [],
          _handler: fn,
          _errorHandler: undefined,
        } as Route<unknown, TOutput>;
      },
      onError(fn: ErrorHandler) {
        return this;
      },
    };
  };
}
```

### 2. Executor (`executor.ts`)

```typescript
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";

export const executeRoute = <TInput, TOutput>(
  route: Route<TInput, TOutput>,
  input: TInput,
  ctx: RouteContext,
): Effect.Effect<TOutput, RouteError, RouterEnv> =>
  Effect.gen(function* () {
    // 1. Validate input
    const validatedInput = route._inputSchema
      ? yield* validateInput(route._inputSchema, input)
      : input;

    // 2. Run middleware chain
    let middlewareCtx = {};
    for (const mw of route._middleware) {
      const result = yield* Effect.tryPromise({
        try: () => mw({ ...ctx, ctx: middlewareCtx }),
        catch: (e) => new MiddlewareError({ cause: e }),
      });
      middlewareCtx = { ...middlewareCtx, ...result };
    }

    // 3. Build handler context
    const handlerCtx = {
      input: validatedInput,
      sdk: ctx.sdk,
      signal: ctx.signal,
      ctx: middlewareCtx,
    };

    // 4. Execute based on route type
    if (route._config.stream) {
      return yield* executeStreamHandler(route, handlerCtx);
    } else {
      return yield* executeRequestHandler(route, handlerCtx);
    }
  });

const executeRequestHandler = <TInput, TOutput>(
  route: Route<TInput, TOutput>,
  ctx: HandlerContext<TInput, unknown>,
): Effect.Effect<TOutput, RouteError, RouterEnv> => {
  let effect = Effect.tryPromise({
    try: () => route._handler(ctx) as Promise<TOutput>,
    catch: (e) => new HandlerError({ cause: e }),
  });

  // Apply timeout
  if (route._config.timeout) {
    effect = effect.pipe(
      Effect.timeout(parseDuration(route._config.timeout)),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(new TimeoutError({ duration: route._config.timeout })),
      ),
    );
  }

  // Apply retry
  if (route._config.retry && route._config.retry !== "none") {
    effect = effect.pipe(Effect.retry(buildSchedule(route._config.retry)));
  }

  return effect;
};

const executeStreamHandler = <TInput, TOutput>(
  route: Route<TInput, TOutput>,
  ctx: HandlerContext<TInput, unknown>,
): Effect.Effect<Stream.Stream<TOutput, RouteError>, RouteError, RouterEnv> =>
  Effect.gen(function* () {
    const generator = route._handler(ctx) as AsyncGenerator<TOutput>;

    let stream = Stream.fromAsyncIterable(
      generator,
      (e) => new StreamError({ cause: e }),
    );

    // Apply heartbeat timeout (reconnect if no event in duration)
    if (route._config.heartbeat) {
      const heartbeatDuration = parseDuration(route._config.heartbeat);
      stream = stream.pipe(
        Stream.timeoutFail({
          duration: heartbeatDuration,
          onTimeout: () =>
            new HeartbeatTimeoutError({ duration: route._config.heartbeat }),
        }),
      );
    }

    // Apply retry (reconnects on heartbeat timeout or connection error)
    if (route._config.retry && route._config.retry !== "none") {
      stream = stream.pipe(Stream.retry(buildSchedule(route._config.retry)));
    }

    // Interrupt on abort signal
    stream = stream.pipe(
      Stream.interruptWhen(
        Effect.async<never, never>((resume) => {
          ctx.signal.addEventListener("abort", () => resume(Effect.void));
        }),
      ),
    );

    return stream;
  });
```

### 3. Schedule Builder (`schedule.ts`)

```typescript
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";

type RetryConfig =
  | "none"
  | "exponential"
  | "linear"
  | {
      type: "exponential" | "linear";
      maxRetries?: number;
      maxDuration?: Duration;
      retryIf?: (error: unknown) => boolean;
    };

export const buildSchedule = (
  retry: RetryConfig,
): Schedule.Schedule<unknown, unknown> => {
  if (retry === "none") {
    return Schedule.stop;
  }

  if (retry === "exponential") {
    return Schedule.exponential("1 second").pipe(
      Schedule.either(Schedule.spaced("30 seconds")), // Cap at 30s
      Schedule.upTo(10), // Max 10 retries
    );
  }

  if (retry === "linear") {
    return Schedule.spaced("1 second").pipe(
      Schedule.upTo(30), // Max 30 retries (30s total)
    );
  }

  // Custom config
  const base =
    retry.type === "exponential"
      ? Schedule.exponential("1 second")
      : Schedule.spaced("1 second");

  let schedule = base;

  if (retry.maxRetries) {
    schedule = schedule.pipe(Schedule.upTo(retry.maxRetries));
  }

  if (retry.maxDuration) {
    schedule = schedule.pipe(
      Schedule.either(Schedule.spaced(parseDuration(retry.maxDuration))),
    );
  }

  if (retry.retryIf) {
    schedule = schedule.pipe(
      Schedule.whileInput((err: unknown) => retry.retryIf!(err)),
    );
  }

  return schedule;
};
```

### 4. Typed Errors (`errors.ts`)

```typescript
import { Data } from "effect";

export class RouteError extends Data.TaggedError("RouteError")<{
  route?: string;
  cause: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  route?: string;
  issues: z.ZodIssue[];
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  route?: string;
  duration: string;
}> {}

export class HandlerError extends Data.TaggedError("HandlerError")<{
  route?: string;
  cause: unknown;
}> {}

export class StreamError extends Data.TaggedError("StreamError")<{
  route?: string;
  cause: unknown;
}> {}

export class HeartbeatTimeoutError extends Data.TaggedError(
  "HeartbeatTimeoutError",
)<{
  route?: string;
  duration: string;
}> {}

export class MiddlewareError extends Data.TaggedError("MiddlewareError")<{
  route?: string;
  cause: unknown;
}> {}
```

### 5. Next.js Adapter (`adapters/next.ts`)

```typescript
import { ManagedRuntime, Layer, Context } from "effect";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export class RouterEnv extends Context.Tag("RouterEnv")<
  RouterEnv,
  {
    sdk: OpencodeClient;
    signal: AbortSignal;
  }
>() {}

export const createNextHandler = <TRouter extends Router>(opts: {
  router: TRouter;
  createContext?: (req: Request) => Promise<{ sdk: OpencodeClient }>;
}) => {
  return async (req: Request) => {
    const controller = new AbortController();

    // Abort on client disconnect
    req.signal.addEventListener("abort", () => controller.abort());

    const ctx = opts.createContext
      ? await opts.createContext(req)
      : { sdk: createDefaultClient() };

    const layer = Layer.succeed(RouterEnv, {
      sdk: ctx.sdk,
      signal: controller.signal,
    });

    const runtime = ManagedRuntime.make(layer);

    try {
      const path = getRoutePath(req);
      const route = opts.router.resolve(path);
      const input = await parseInput(req, route);

      const result = await runtime.runPromise(
        executeRoute(route, input, { sdk: ctx.sdk, signal: controller.signal }),
      );

      if (route._config.stream) {
        // Convert Effect.Stream to ReadableStream
        const readable = streamToReadable(
          result as Stream.Stream<unknown, unknown>,
        );
        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      return Response.json(result);
    } catch (error) {
      return handleRouteError(error);
    }
  };
};

export const createAction = <TInput, TOutput>(
  route: Route<TInput, TOutput>,
): ((input: TInput) => Promise<TOutput>) => {
  return async (input: TInput) => {
    const controller = new AbortController();
    const sdk = createDefaultClient();

    const layer = Layer.succeed(RouterEnv, {
      sdk,
      signal: controller.signal,
    });

    const runtime = ManagedRuntime.make(layer);

    if (route._config.stream) {
      // Return AsyncIterable for streaming routes
      const stream = await runtime.runPromise(
        executeRoute(route, input, { sdk, signal: controller.signal }),
      );
      return streamToAsyncIterable(stream) as TOutput;
    }

    return runtime.runPromise(
      executeRoute(route, input, { sdk, signal: controller.signal }),
    );
  };
};
```

### 6. React Hook (`router-react/use-subscription.ts`)

```typescript
import { useState, useEffect, useRef, useCallback } from "react";

type SubscriptionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "paused";

interface UseSubscriptionOptions {
  /** Pause when tab is hidden (default: true) */
  pauseOnHidden?: boolean;
  /** Batch events for N ms before updating state (default: 16) */
  batchMs?: number;
}

export function useSubscription<T>(
  action: () => AsyncIterable<T>,
  deps: unknown[],
  options: UseSubscriptionOptions = {},
) {
  const { pauseOnHidden = true, batchMs = 16 } = options;

  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const batchRef = useRef<T[]>([]);
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const flushBatch = useCallback(() => {
    if (batchRef.current.length > 0) {
      setEvents((prev) => [...prev, ...batchRef.current]);
      batchRef.current = [];
    }
    batchTimeoutRef.current = null;
  }, []);

  const queueEvent = useCallback(
    (event: T) => {
      batchRef.current.push(event);
      if (!batchTimeoutRef.current) {
        batchTimeoutRef.current = setTimeout(flushBatch, batchMs);
      }
    },
    [batchMs, flushBatch],
  );

  useEffect(() => {
    controllerRef.current = new AbortController();
    let isPaused = false;

    async function subscribe() {
      setStatus("connecting");
      setError(null);

      try {
        const iterable = action();
        setStatus("connected");

        for await (const event of iterable) {
          if (controllerRef.current?.signal.aborted) break;
          if (isPaused) continue; // Skip events while paused
          queueEvent(event);
        }
      } catch (err) {
        if (!controllerRef.current?.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus("error");
        }
      }
    }

    // Visibility API integration
    function handleVisibilityChange() {
      if (!pauseOnHidden) return;

      if (document.visibilityState === "hidden") {
        isPaused = true;
        setStatus("paused");
      } else {
        isPaused = false;
        setStatus("connected");
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    subscribe();

    return () => {
      controllerRef.current?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
        flushBatch();
      }
    };
  }, deps);

  const reconnect = useCallback(() => {
    controllerRef.current?.abort();
    setEvents([]);
    // Re-run effect by updating a dep (or use a key pattern)
  }, []);

  return {
    events,
    status,
    error,
    connected: status === "connected",
    reconnect,
  };
}
```

---

## Router Definition Example

```typescript
// apps/web/src/server/router.ts
import { createOpencodeRoute, createRouter } from "@opencode/router";
import { z } from "zod";

const o = createOpencodeRoute();

export const appRouter = createRouter({
  // Session operations
  session: {
    get: o({ timeout: "30s" })
      .input(z.object({ id: z.string() }))
      .handler(async ({ input, sdk }) => sdk.session.get(input.id)),

    list: o({ timeout: "30s", cache: { ttl: "5s" } }).handler(async ({ sdk }) =>
      sdk.session.list(),
    ),

    create: o({ timeout: "60s" })
      .input(z.object({ provider: z.string().optional() }))
      .handler(async ({ input, sdk }) => sdk.session.create(input)),
  },

  // Real-time subscriptions
  subscribe: {
    events: o({ stream: true, retry: "exponential", heartbeat: "60s" })
      .input(z.object({ directory: z.string() }))
      .handler(async function* ({ input, sdk }) {
        for await (const event of sdk.global.event()) {
          if (event.directory === input.directory) {
            yield event;
          }
        }
      }),

    multiServer: o({ stream: true, retry: "exponential", heartbeat: "60s" })
      .input(z.object({ servers: z.array(z.string()) }))
      .handler(async function* ({ input, sdk }) {
        const streams = input.servers.map((url) =>
          sdk.withBaseUrl(url).global.event(),
        );
        for await (const event of mergeAsyncIterables(streams)) {
          yield event;
        }
      }),
  },

  // Server discovery
  servers: {
    discover: o({ concurrency: 5, timeout: "2s" })
      .input(
        z.object({
          ports: z.array(z.number()).default([3000, 3001, 3002, 4096]),
        }),
      )
      .handler(async ({ input }) => {
        const results = await Promise.all(
          input.ports.map(async (port) => {
            try {
              const res = await fetch(
                `http://127.0.0.1:${port}/project/current`,
              );
              if (!res.ok) return null;
              const data = await res.json();
              return { port, url: `http://127.0.0.1:${port}`, ...data };
            } catch {
              return null;
            }
          }),
        );
        return results.filter(Boolean);
      }),
  },

  // Messages
  messages: {
    send: o({ timeout: "30s" })
      .input(
        z.object({
          sessionId: z.string(),
          content: z.string(),
          model: z.string().optional(),
        }),
      )
      .handler(async ({ input, sdk }) => {
        return sdk.session.promptAsync({
          path: { id: input.sessionId },
          body: {
            parts: [{ type: "text", text: input.content }],
            model: input.model,
          },
        });
      }),
  },

  // Providers
  providers: {
    list: o({ timeout: "30s", cache: { ttl: "30s" } }).handler(
      async ({ sdk }) => sdk.provider.list(),
    ),
  },

  // Files
  files: {
    search: o({ timeout: "5s" })
      .input(z.object({ query: z.string(), dirs: z.boolean().default(true) }))
      .handler(async ({ input, sdk }) => {
        return sdk.find.files({
          query: { query: input.query, dirs: String(input.dirs) },
        });
      }),
  },
});

export type AppRouter = typeof appRouter;
```

---

## Migration Targets

After router is built, migrate in this order:

| Priority | File                            | Current Lines | After | Reduction |
| -------- | ------------------------------- | ------------- | ----- | --------- |
| 1        | `api/opencode-servers/route.ts` | 150+          | 15    | 90%       |
| 2        | `use-sse.tsx`                   | 342           | 30    | 91%       |
| 3        | `multi-server-sse.ts`           | 454           | 50    | 89%       |
| 4        | `use-send-message.ts`           | 208           | 40    | 81%       |
| 5        | `use-create-session.ts`         | 116           | 10    | 91%       |
| 6        | `use-file-search.ts`            | 115           | 15    | 87%       |
| 7        | `use-providers.ts`              | 94            | 10    | 89%       |

**Total: 1479 lines → ~170 lines (88% reduction)**

---

## Dependencies

```json
{
  "name": "@opencode/router",
  "dependencies": {
    "effect": "^3.12.0"
  },
  "peerDependencies": {
    "zod": "^3.22.0",
    "next": ">=15.0.0"
  }
}
```

Note: Using Effect 3.12+ (Schema is now in core `effect` package, not separate `@effect/schema`).

---

## Testing Strategy

```typescript
// Test routes by mocking handlers, not Effect internals
import { createTestCaller } from "@opencode/router/test";

describe("session.get", () => {
  it("returns session by id", async () => {
    const mockSdk = {
      session: {
        get: vi.fn().mockResolvedValue({ id: "123", title: "Test" }),
      },
    };

    const caller = createTestCaller(appRouter, { sdk: mockSdk });
    const result = await caller.session.get({ id: "123" });

    expect(result).toEqual({ id: "123", title: "Test" });
    expect(mockSdk.session.get).toHaveBeenCalledWith("123");
  });

  it("times out after 30s", async () => {
    const mockSdk = {
      session: {
        get: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      },
    };

    const caller = createTestCaller(appRouter, { sdk: mockSdk });

    await expect(caller.session.get({ id: "123" })).rejects.toThrow(
      TimeoutError,
    );
  });
});

describe("subscribe.events", () => {
  it("yields events from generator", async () => {
    const events = [{ type: "message" }, { type: "status" }];
    const mockSdk = {
      global: {
        event: async function* () {
          for (const e of events) yield { directory: "/test", payload: e };
        },
      },
    };

    const caller = createTestCaller(appRouter, { sdk: mockSdk });
    const stream = await caller.subscribe.events({ directory: "/test" });

    const received = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toHaveLength(2);
  });

  it("retries on connection error", async () => {
    let attempts = 0;
    const mockSdk = {
      global: {
        event: async function* () {
          attempts++;
          if (attempts < 3) throw new Error("Connection failed");
          yield { directory: "/test", payload: { type: "success" } };
        },
      },
    };

    const caller = createTestCaller(appRouter, { sdk: mockSdk });
    const stream = await caller.subscribe.events({ directory: "/test" });

    const received = [];
    for await (const event of stream) {
      received.push(event);
      break; // Just get first event
    }

    expect(attempts).toBe(3);
    expect(received[0].payload.type).toBe("success");
  });
});
```

---

## Escape Hatch

For cases where the router abstraction is too limiting:

```typescript
// @opencode/router/effect
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { RouterEnv } from "@opencode/router";

// Direct Effect access for power users
export const customRoute = o({ timeout: "30s" }).handler(async ({ sdk }) => {
  // Can use Effect directly if needed
  const effect = Effect.gen(function* () {
    const result = yield* Effect.tryPromise(() => sdk.session.list());
    // Custom Effect logic here
    return result;
  });

  return Effect.runPromise(effect);
});
```

---

## References

### UploadThing (Pattern Source)

| File                                                                                                                           | Pattern          | Lines                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ---------------------- |
| [`upload-builder.ts`](https://github.com/pingdotgg/uploadthing/blob/main/packages/uploadthing/src/_internal/upload-builder.ts) | Fluent builder   | 101-123                |
| [`handler.ts`](https://github.com/pingdotgg/uploadthing/blob/main/packages/uploadthing/src/_internal/handler.ts)               | Effect execution | 50-52, 66-101, 103-150 |
| [`effect-platform.ts`](https://github.com/pingdotgg/uploadthing/blob/main/packages/uploadthing/src/effect-platform.ts)         | Effect export    | 32-70                  |

### Effect Documentation

- [Effect.gen](https://effect.website/docs/guides/essentials/using-generators)
- [Effect.Stream](https://effect.website/docs/guides/streaming/stream)
- [Effect.Schedule](https://effect.website/docs/guides/scheduling/schedule)
- [ManagedRuntime](https://effect.website/docs/guides/runtime)

### Current Codebase

| File                                             | Lines | Key Patterns                                   |
| ------------------------------------------------ | ----- | ---------------------------------------------- |
| `apps/web/src/app/api/opencode-servers/route.ts` | 150+  | Timeout, concurrency, parallel fetch           |
| `apps/web/src/react/use-sse.tsx`                 | 342   | Exponential backoff, heartbeat, visibility API |
| `apps/web/src/core/multi-server-sse.ts`          | 454   | Polling, per-server SSE, stream merge          |
| `apps/web/src/react/use-send-message.ts`         | 208   | FIFO queue, session gating                     |
