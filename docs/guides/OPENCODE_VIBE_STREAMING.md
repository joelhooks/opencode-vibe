# Effect-TS Streaming with OpenCode Vibe

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ███████╗███████╗███████╗███████╗ ██████╗████████╗    ███████╗████████╗║
║   ██╔════╝██╔════╝██╔════╝██╔════╝██╔════╝╚══██╔══╝    ██╔════╝╚══██╔══╝║
║   █████╗  █████╗  █████╗  █████╗  ██║        ██║       ███████╗   ██║   ║
║   ██╔══╝  ██╔══╝  ██╔══╝  ██╔══╝  ██║        ██║       ╚════██║   ██║   ║
║   ███████╗██║     ███████╗███████╗╚██████╗   ██║       ███████║   ██║   ║
║   ╚══════╝╚═╝     ╚══════╝╚══════╝ ╚═════╝   ╚═╝       ╚══════╝   ╚═╝   ║
║                                                                           ║
║   Real-time streaming with Effect-TS and durable streams                 ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## Overview

OpenCode Vibe is a 4-layer Effect-TS router that makes streaming routes composable, testable, and resilient. This guide covers the current architecture and how to integrate durable streams for bulletproof real-time sync.

**Key insight:** Streaming in Effect-TS is just another Effect. You compose it like any other operation—with timeouts, retries, error handling, and cancellation built in.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCODE VIBE ROUTER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 4: Adapters (Next.js, Direct)                           │
│  ├─ adapters/next.ts    (Route handler → Response)             │
│  └─ adapters/direct.ts  (Route handler → AsyncIterable)        │
│                                                                 │
│  Layer 3: Router & Routes                                      │
│  ├─ router.ts           (Route registration, execution)        │
│  └─ routes.ts           (Route definitions)                    │
│                                                                 │
│  Layer 2: Builders & Executors                                 │
│  ├─ builder.ts          (Fluent API: o({}).input().handler())  │
│  ├─ executor.ts         (Execute handlers with config)         │
│  └─ stream.ts           (AsyncGenerator → Effect.Stream)       │
│                                                                 │
│  Layer 1: Types & Errors                                       │
│  ├─ types.ts            (Route, Handler, Config types)         │
│  ├─ errors.ts           (TaggedError types)                    │
│  └─ schedule.ts         (Duration parsing)                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Design principle:** Each layer depends only on layers below it. No circular dependencies. Easy to test in isolation.

---

## Current State: SSE Streaming

### What Exists

The router currently supports streaming via `AsyncGenerator`:

```typescript
// Define a streaming route
const route = o({ heartbeat: "60s" })
  .input(z.object({ sessionId: z.string() }))
  .stream()
  .handler(async function* (ctx) {
    for await (const event of ctx.sdk.global.event()) {
      yield event;
    }
  });
```

### How It Works

1. **Handler returns AsyncGenerator** - Your handler is an async generator function
2. **Converted to Effect.Stream** - `executeStreamHandler` wraps it with `Stream.fromAsyncIterable`
3. **Heartbeat timeout applied** - `Stream.timeoutFail` fails if no event within interval
4. **Abort signal integrated** - `Stream.interruptWhen` cancels on client disconnect
5. **Converted to Response** - `streamToReadable` adapts to Next.js Response API

### Current Limitations

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT SSE PROBLEMS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ❌ No offset tracking                                          │
│     → Can't resume from last event                             │
│     → Reconnect = refetch entire state                         │
│                                                                 │
│  ❌ No durability                                               │
│     → Events only exist in-flight                              │
│     → Server restart = lost events                             │
│                                                                 │
│  ❌ No catch-up reads                                           │
│     → Can't fetch missed events on reconnect                   │
│     → Race conditions during reconnect                         │
│                                                                 │
│  ❌ Server discovery via lsof polling                           │
│     → Slow, fragile, not scalable                              │
│     → No built-in multi-server support                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Durable Streams with Effect-TS

### The Pattern

Durable Streams Protocol provides offset-based resumability. Here's how to integrate with Effect-TS:

```
┌─────────────────────────────────────────────────────────────────┐
│                 DURABLE STREAMS PATTERN                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Client connects with offset                                │
│     GET /stream/session-123?offset=01JFXYZ&live=true           │
│                                                                 │
│  2. Server returns catch-up events + live tail                 │
│     Stream-Next-Offset: 01JFXYZ...                             │
│     { type: "message.updated", ... }                           │
│                                                                 │
│  3. Client stores offset from Stream-Next-Offset header        │
│                                                                 │
│  4. On reconnect, resume from stored offset                    │
│     GET /stream/session-123?offset=01JFXYZ&live=true           │
│                                                                 │
│  5. Server catches up missed events, then live tail            │
│     (no gaps, no duplicates)                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Code Examples

### 1. Basic Streaming Route

```typescript
import * as Schema from "effect/Schema";
import { o } from "./router/builder";

const EventSchema = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.Number,
  data: Schema.Unknown,
});

export const globalEventRoute = o({ heartbeat: "60s" })
  .stream()
  .handler(async function* (ctx) {
    // Yield events as they arrive
    for await (const event of ctx.sdk.global.event()) {
      yield event;
    }
  });
```

**Key points:**

- Mark with `.stream()` to enable streaming mode
- Handler is an `async function*` (generator)
- `yield` events as they arrive
- Heartbeat timeout prevents hanging connections

---

### 2. Durable Stream Subscription with Offset Tracking

```typescript
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { o } from "./router/builder";

interface DurableStreamEvent {
  offset: string;
  type: string;
  timestamp: number;
  data: unknown;
}

interface StreamRequest {
  sessionId: string;
  offset?: string; // Resume from this offset
  live?: boolean; // Tail live events
}

// Durable stream route with offset tracking
export const durableStreamRoute = o({
  heartbeat: "30s",
  timeout: "5m",
})
  .input(
    Schema.Struct({
      sessionId: Schema.String,
      offset: Schema.optional(Schema.String),
      live: Schema.optional(Schema.Boolean),
    }),
  )
  .stream()
  .handler(async function* (ctx) {
    const { sessionId, offset, live = true } = ctx.input;

    // Fetch durable stream client
    const client = ctx.sdk.durableStreams;

    // Catch-up: fetch missed events from offset
    if (offset) {
      const catchUp = await client.getCatchUp(sessionId, offset);
      for (const event of catchUp) {
        yield {
          offset: event.offset,
          type: event.type,
          timestamp: event.timestamp,
          data: event.data,
        } as DurableStreamEvent;
      }
    }

    // Live: tail new events
    if (live) {
      for await (const event of client.subscribe(sessionId, {
        offset: offset || "0",
        live: true,
      })) {
        yield {
          offset: event.offset,
          type: event.type,
          timestamp: event.timestamp,
          data: event.data,
        } as DurableStreamEvent;
      }
    }
  });
```

**Key points:**

- Input includes optional `offset` for resumability
- Fetch catch-up events first (if offset provided)
- Then tail live events
- Client stores offset from each event for next reconnect

---

### 3. Offset Tracking with Effect.Ref

```typescript
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Ref from "effect/Ref";
import { o } from "./router/builder";

interface OffsetState {
  lastOffset: string;
  eventCount: number;
  lastEventTime: number;
}

export const trackedStreamRoute = o({
  heartbeat: "30s",
})
  .input(Schema.Struct({ sessionId: Schema.String }))
  .stream()
  .handler(async function* (ctx) {
    const { sessionId } = ctx.input;

    // Create Effect.Ref for offset tracking
    const offsetRef = await Effect.runPromise(
      Ref.make<OffsetState>({
        lastOffset: "0",
        eventCount: 0,
        lastEventTime: Date.now(),
      }),
    );

    const client = ctx.sdk.durableStreams;

    for await (const event of client.subscribe(sessionId, {
      offset: "0",
      live: true,
    })) {
      // Update offset state
      await Effect.runPromise(
        Ref.update(offsetRef, (state) => ({
          lastOffset: event.offset,
          eventCount: state.eventCount + 1,
          lastEventTime: Date.now(),
        })),
      );

      // Yield event with current offset
      yield {
        ...event,
        _metadata: {
          offset: event.offset,
          count: (await Effect.runPromise(Ref.get(offsetRef))).eventCount,
        },
      };
    }
  });
```

**Key points:**

- `Ref.make` creates mutable state within Effect
- `Ref.update` atomically updates state
- Track offset, event count, timing
- Metadata available to client for debugging

---

### 4. Error Recovery with Retry

```typescript
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import { o } from "./router/builder";

class StreamConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamConnectionError";
  }
}

export const resilientStreamRoute = o({
  heartbeat: "30s",
  retry: {
    maxAttempts: 3,
    delay: "1s",
    backoff: 2, // exponential: 1s, 2s, 4s
  },
})
  .input(Schema.Struct({ sessionId: Schema.String }))
  .stream()
  .handler(async function* (ctx) {
    const { sessionId } = ctx.input;
    const client = ctx.sdk.durableStreams;

    // Wrap subscription with retry logic
    const subscribe = () =>
      Effect.tryPromise({
        try: async () => {
          const stream = await client.subscribe(sessionId, {
            offset: "0",
            live: true,
          });
          return stream;
        },
        catch: (e) => new StreamConnectionError(String(e)),
      });

    // Retry with exponential backoff
    const retrySchedule = Schedule.exponential("100ms", 2).pipe(
      Schedule.compose(Schedule.recurs(3)),
    );

    const subscription = await Effect.runPromise(
      Effect.retry(subscribe(), retrySchedule),
    );

    for await (const event of subscription) {
      yield event;
    }
  });
```

**Key points:**

- `Effect.tryPromise` wraps async operations
- `Schedule.exponential` creates backoff schedule
- `Effect.retry` applies schedule automatically
- Fails after max attempts, propagates error

---

### 5. Heartbeat Handling

```typescript
import * as Stream from "effect/Stream";
import * as Duration from "effect/Duration";
import { o } from "./router/builder";

interface HeartbeatEvent {
  type: "heartbeat" | "data";
  timestamp: number;
  data?: unknown;
}

export const heartbeatStreamRoute = o({
  heartbeat: "30s", // Fail if no event for 30s
})
  .input(Schema.Struct({ sessionId: Schema.String }))
  .stream()
  .handler(async function* (ctx) {
    const { sessionId } = ctx.input;
    const client = ctx.sdk.durableStreams;

    // Create a stream that yields heartbeats if no data
    const dataStream = client.subscribe(sessionId, {
      offset: "0",
      live: true,
    });

    // Merge with heartbeat stream
    const heartbeatInterval = setInterval(() => {
      // Heartbeat is implicit in Effect.Stream.timeoutFail
      // If no event within heartbeat duration, stream fails
    }, 15000); // Send heartbeat every 15s (half of 30s timeout)

    try {
      for await (const event of dataStream) {
        yield {
          type: "data",
          timestamp: Date.now(),
          data: event,
        } as HeartbeatEvent;
      }
    } finally {
      clearInterval(heartbeatInterval);
    }
  });
```

**Key points:**

- Heartbeat timeout is configured at route level: `.heartbeat("30s")`
- Stream fails if no event within 30s
- Client should send heartbeat events to keep stream alive
- `Stream.timeoutFail` handles this automatically

---

### 6. Next.js Adapter Integration

```typescript
// app/api/stream/[sessionId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Effect from "effect/Effect";
import { durableStreamRoute } from "@/core/router/routes";
import { executeStreamHandler } from "@/core/router/stream";
import { streamToReadable } from "@/core/router/stream";

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params;
  const offset = request.nextUrl.searchParams.get("offset");
  const live = request.nextUrl.searchParams.get("live") === "true";

  // Create handler context
  const ctx = {
    input: { sessionId, offset: offset || undefined, live },
    sdk: getOpencodeClient(),
    signal: request.signal,
    ctx: {},
  };

  try {
    // Execute streaming handler
    const stream = await Effect.runPromise(
      executeStreamHandler(durableStreamRoute, ctx),
    );

    // Convert to ReadableStream
    const readable = streamToReadable(stream);

    // Return Response with proper headers
    return new NextResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable proxy buffering
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

**Key points:**

- Extract offset and live params from query string
- Create `HandlerContext` with input, SDK, and abort signal
- `executeStreamHandler` returns Effect that yields Stream
- `streamToReadable` converts to Next.js Response
- Set proper SSE headers (no-cache, keep-alive, no-buffer)

---

### 7. Client-Side Offset Tracking (React)

```typescript
// hooks/useDurableStream.ts
import { useEffect, useRef, useState } from "react";

interface StreamEvent {
  offset: string;
  type: string;
  timestamp: number;
  data: unknown;
}

export function useDurableStream(sessionId: string) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const offsetRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Restore offset from localStorage
    const stored = localStorage.getItem(`stream-offset-${sessionId}`);
    if (stored) {
      offsetRef.current = stored;
    }

    // Build URL with offset
    const url = new URL(`/api/stream/${sessionId}`, window.location.origin);
    if (offsetRef.current) {
      url.searchParams.set("offset", offsetRef.current);
    }
    url.searchParams.set("live", "true");

    // Connect to stream
    const eventSource = new EventSource(url.toString());

    eventSource.addEventListener("message", (e) => {
      try {
        const event = JSON.parse(e.data) as StreamEvent;
        offsetRef.current = event.offset;

        // Persist offset
        localStorage.setItem(`stream-offset-${sessionId}`, event.offset);

        // Add to events
        setEvents((prev) => [...prev, event]);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    eventSource.addEventListener("error", () => {
      setError(new Error("Stream connection lost"));
      eventSource.close();
    });

    eventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  return { events, error, lastOffset: offsetRef.current };
}
```

**Key points:**

- Store offset in `localStorage` for persistence
- Restore offset on reconnect
- Pass offset to server via query param
- Server resumes from that offset
- No gaps, no duplicates

---

## Migration Path: SSE → Durable Streams

### Phase 1: Add Offset Support (Week 1)

```typescript
// Step 1: Update route input schema
const streamRoute = o({ heartbeat: "30s" })
  .input(
    Schema.Struct({
      sessionId: Schema.String,
      offset: Schema.optional(Schema.String), // NEW
    }),
  )
  .stream()
  .handler(async function* (ctx) {
    const { sessionId, offset } = ctx.input;

    // Fetch catch-up if offset provided
    if (offset) {
      const catchUp = await ctx.sdk.durableStreams.getCatchUp(
        sessionId,
        offset,
      );
      for (const event of catchUp) {
        yield event;
      }
    }

    // Continue with live events
    for await (const event of ctx.sdk.global.event()) {
      yield event;
    }
  });
```

**Effort:** 2-3 hours
**Risk:** Low (backward compatible)
**Benefit:** Clients can now resume from offset

---

### Phase 2: Persistent Event Store (Week 2)

```typescript
// Step 2: Store events durably
const storeEvent = (sessionId: string, event: any) => {
  return Effect.tryPromise({
    try: async () => {
      await db.events.create({
        sessionId,
        offset: generateOffset(), // ULID or similar
        type: event.type,
        data: event,
        createdAt: new Date(),
      });
    },
    catch: (e) => new Error(`Failed to store event: ${e}`),
  });
};

// Use in route
const streamRoute = o({ heartbeat: "30s" })
  .stream()
  .handler(async function* (ctx) {
    for await (const event of ctx.sdk.global.event()) {
      // Store durably
      await Effect.runPromise(storeEvent(ctx.input.sessionId, event));
      yield event;
    }
  });
```

**Effort:** 1-2 days
**Risk:** Medium (database schema change)
**Benefit:** Events survive server restart

---

### Phase 3: Catch-Up Reads (Week 3)

```typescript
// Step 3: Implement catch-up fetch
const getCatchUpEvents = (sessionId: string, fromOffset: string) => {
  return Effect.tryPromise({
    try: async () => {
      return await db.events.findMany({
        where: {
          sessionId,
          offset: { gt: fromOffset },
        },
        orderBy: { offset: "asc" },
        take: 1000, // Limit to prevent huge responses
      });
    },
    catch: (e) => new Error(`Failed to fetch catch-up: ${e}`),
  });
};

// Use in route
const streamRoute = o({ heartbeat: "30s" })
  .input(
    Schema.Struct({
      sessionId: Schema.String,
      offset: Schema.optional(Schema.String),
    }),
  )
  .stream()
  .handler(async function* (ctx) {
    const { sessionId, offset } = ctx.input;

    // Catch-up
    if (offset) {
      const catchUp = await Effect.runPromise(
        getCatchUpEvents(sessionId, offset),
      );
      for (const event of catchUp) {
        yield event;
      }
    }

    // Live
    for await (const event of ctx.sdk.global.event()) {
      await Effect.runPromise(storeEvent(sessionId, event));
      yield event;
    }
  });
```

**Effort:** 1-2 days
**Risk:** Low (read-only)
**Benefit:** Clients can recover from any disconnect

---

### Phase 4: Multi-Server Discovery (Week 4)

```typescript
// Step 4: Replace lsof polling with service discovery
const discoverServers = () => {
  return Effect.tryPromise({
    try: async () => {
      // Use Consul, etcd, or simple HTTP registry
      const response = await fetch("http://service-registry/servers");
      return await response.json();
    },
    catch: (e) => new Error(`Discovery failed: ${e}`),
  });
};

// Periodic discovery
const discoverySchedule = Schedule.fixed("5s").pipe(Schedule.forever);

const monitorServers = Effect.gen(function* () {
  while (true) {
    const servers = yield* discoverServers();
    yield* updateServerCache(servers);
    yield* Effect.sleep("5s");
  }
});
```

**Effort:** 2-3 days
**Risk:** Medium (infrastructure change)
**Benefit:** Scalable multi-server support

---

## Testing Patterns

### 1. Unit Test: Basic Streaming Route

```typescript
import { describe, it, expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { streamToAsyncIterable } from "@/core/router/stream";

describe("Streaming Routes", () => {
  it("yields events from handler", async () => {
    // Arrange
    const route = o({ heartbeat: "30s" })
      .stream()
      .handler(async function* () {
        yield { type: "event1", data: "a" };
        yield { type: "event2", data: "b" };
        yield { type: "event3", data: "c" };
      });

    const ctx = {
      input: {},
      sdk: mockSdk(),
      signal: new AbortController().signal,
      ctx: {},
    };

    // Act
    const stream = await Effect.runPromise(executeStreamHandler(route, ctx));
    const iterable = streamToAsyncIterable(stream);
    const events = [];
    for await (const event of iterable) {
      events.push(event);
    }

    // Assert
    expect(events).toEqual([
      { type: "event1", data: "a" },
      { type: "event2", data: "b" },
      { type: "event3", data: "c" },
    ]);
  });
});
```

---

### 2. Integration Test: Durable Stream with Offset

```typescript
describe("Durable Streams", () => {
  it("resumes from offset", async () => {
    // Arrange
    const sessionId = "test-session";
    const db = setupTestDb();

    // Store initial events
    await db.events.create({
      sessionId,
      offset: "01JFXYZ000",
      type: "message.created",
      data: { id: "msg1" },
    });
    await db.events.create({
      sessionId,
      offset: "01JFXYZ001",
      type: "message.updated",
      data: { id: "msg1", status: "sent" },
    });
    await db.events.create({
      sessionId,
      offset: "01JFXYZ002",
      type: "message.created",
      data: { id: "msg2" },
    });

    // Act: Resume from first offset
    const route = durableStreamRoute;
    const ctx = {
      input: { sessionId, offset: "01JFXYZ000", live: false },
      sdk: mockSdk(db),
      signal: new AbortController().signal,
      ctx: {},
    };

    const stream = await Effect.runPromise(executeStreamHandler(route, ctx));
    const iterable = streamToAsyncIterable(stream);
    const events = [];
    for await (const event of iterable) {
      events.push(event);
    }

    // Assert: Should get events after offset
    expect(events).toHaveLength(2);
    expect(events[0].offset).toBe("01JFXYZ001");
    expect(events[1].offset).toBe("01JFXYZ002");
  });
});
```

---

### 3. Test: Heartbeat Timeout

```typescript
describe("Heartbeat Timeout", () => {
  it("fails if no event within heartbeat duration", async () => {
    // Arrange
    const route = o({ heartbeat: "100ms" })
      .stream()
      .handler(async function* () {
        // Never yield - should timeout
        await new Promise(() => {}); // Hang forever
      });

    const ctx = {
      input: {},
      sdk: mockSdk(),
      signal: new AbortController().signal,
      ctx: {},
    };

    // Act & Assert
    const stream = await Effect.runPromise(executeStreamHandler(route, ctx));

    const result = await Effect.runPromise(
      Effect.either(Stream.runCollect(stream)),
    );

    expect(result._tag).toBe("Left");
    expect(result.left).toBeInstanceOf(HeartbeatTimeoutError);
  });
});
```

---

### 4. Test: Abort Signal Cancellation

```typescript
describe("Abort Signal", () => {
  it("cancels stream on abort", async () => {
    // Arrange
    const abortController = new AbortController();
    let yieldCount = 0;

    const route = o({ heartbeat: "30s" })
      .stream()
      .handler(async function* () {
        for (let i = 0; i < 100; i++) {
          yieldCount++;
          yield { count: i };
          await new Promise((r) => setTimeout(r, 10));
        }
      });

    const ctx = {
      input: {},
      sdk: mockSdk(),
      signal: abortController.signal,
      ctx: {},
    };

    // Act
    const stream = await Effect.runPromise(executeStreamHandler(route, ctx));

    const iterable = streamToAsyncIterable(stream);
    const iterator = iterable[Symbol.asyncIterator]();

    // Get first event
    await iterator.next();
    expect(yieldCount).toBe(1);

    // Abort
    abortController.abort();

    // Try to get next event - should fail
    const result = await iterator.next();
    expect(result.done).toBe(true);
    expect(yieldCount).toBeLessThan(100); // Didn't complete all
  });
});
```

---

### 5. Test: Error Recovery with Retry

```typescript
describe("Error Recovery", () => {
  it("retries on transient failure", async () => {
    // Arrange
    let attemptCount = 0;

    const route = o({
      heartbeat: "30s",
      retry: {
        maxAttempts: 3,
        delay: "10ms",
        backoff: 2,
      },
    })
      .stream()
      .handler(async function* () {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Transient failure");
        }
        yield { success: true };
      });

    const ctx = {
      input: {},
      sdk: mockSdk(),
      signal: new AbortController().signal,
      ctx: {},
    };

    // Act
    const stream = await Effect.runPromise(executeStreamHandler(route, ctx));
    const iterable = streamToAsyncIterable(stream);
    const events = [];
    for await (const event of iterable) {
      events.push(event);
    }

    // Assert
    expect(attemptCount).toBe(3);
    expect(events).toEqual([{ success: true }]);
  });
});
```

---

## Summary Checklist

### Current State (SSE)

- [x] Streaming routes with AsyncGenerator
- [x] Heartbeat timeout support
- [x] Abort signal integration
- [x] Next.js adapter (streamToReadable)
- [x] Direct adapter (streamToAsyncIterable)
- [x] Multi-server SSE discovery
- [x] Event routing by directory

### Phase 1: Offset Support

- [ ] Add `offset` parameter to stream route input
- [ ] Implement `getCatchUp` in durable streams client
- [ ] Update client to store/restore offset from localStorage
- [ ] Test offset resumability

### Phase 2: Persistent Store

- [ ] Create events table in database
- [ ] Add event storage in stream handler
- [ ] Implement offset generation (ULID)
- [ ] Test event persistence

### Phase 3: Catch-Up Reads

- [ ] Implement `getCatchUpEvents` query
- [ ] Integrate into stream route
- [ ] Limit catch-up size (pagination)
- [ ] Test catch-up with large event backlog

### Phase 4: Multi-Server Discovery

- [ ] Replace lsof polling with service registry
- [ ] Implement server discovery Effect
- [ ] Update MultiServerSSE to use registry
- [ ] Test with multiple servers

### Testing

- [x] Unit tests for streaming routes
- [x] Integration tests with offset
- [x] Heartbeat timeout tests
- [x] Abort signal tests
- [x] Error recovery tests
- [ ] End-to-end tests with real database
- [ ] Load tests with many concurrent streams
- [ ] Chaos tests (server restart, network flaps)

---

## Key Takeaways

1. **Streaming is just another Effect** - Compose with timeouts, retries, error handling
2. **Offset-based resumability** - Store offsets, resume from any point
3. **Catch-up + live** - Fetch missed events, then tail live
4. **Heartbeat prevents hangs** - Fail if no event within duration
5. **Abort signal for cancellation** - Clean up on client disconnect
6. **Test in isolation** - Each layer testable independently
7. **No circular dependencies** - 4-layer architecture keeps code clean

---

## References

- [Effect-TS Stream API](https://effect.website/docs/guides/streaming)
- [Durable Streams Protocol](https://github.com/durable-streams/durable-streams)
- [OpenCode Vibe Router](../router/)
- [Testing Patterns](./TESTING_PATTERNS.md)
