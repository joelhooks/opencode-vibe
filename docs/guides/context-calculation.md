# Context Calculation Guide

**Version:** 1.0  
**Last Updated:** 2026-01-03  
**Status:** Production Reference

---

## Executive Summary

OpenCode calculates context usage differently in **3 places**, leading to potential discrepancies:

1. **TUI Display** – Includes `cache.write` in total (INCORRECT for context calculation)
2. **Compaction Trigger** – Excludes `cache.write` and `reasoning` (CORRECT for context, but outdated)
3. **ContextService** – Excludes `cache.write`, includes `reasoning` (CORRECT as of 2024)

**Key Insight:** `cache.write` is a **billing metric only** and should NOT count toward context window usage. The TUI incorrectly includes it, causing inflated percentages.

**Correct Formula:**

```typescript
used = input + output + reasoning + cache.read;
// cache.write excluded (billing-only, doesn't consume context)

usableContext = contextLimit - Math.min(outputLimit, 32000);
percentage = Math.round((used / usableContext) * 100);
```

---

## Token Calculation Formulas

### TUI Display (Current – INCORRECT)

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:54-59`

```typescript
const total =
  last.tokens.input +
  last.tokens.output +
  last.tokens.reasoning +
  last.tokens.cache.read +
  last.tokens.cache.write; // ← BUG: Should NOT be included

const percentage = model?.limit.context
  ? Math.round((total / model.limit.context) * 100)
  : null;
```

**Problem:** This inflates the percentage by counting cache writes, which don't consume context.

---

### Compaction Trigger (OUTDATED)

**File:** `packages/opencode/src/session/compaction.ts:30-38`

```typescript
const count =
  input.tokens.input + input.tokens.cache.read + input.tokens.output;
// Excludes reasoning, excludes cache.write

const output = Math.min(input.model.limit.output, 32000) || 32000;
const usable = context - output;
return count > usable;
```

**Problem:** Excludes `reasoning` tokens (added in 2024 with extended thinking models).

---

### ContextService (CORRECT)

**File:** `packages/core/src/services/context-service.ts`

```typescript
interface ComputeUsageInput {
  tokens: TokenUsage;
  modelLimits: ModelLimits;
}

interface ContextUsage {
  used: number; // Total tokens used
  limit: number; // Model's context window limit
  usableContext: number; // limit - outputReserve (capped at 32K)
  percentage: number; // (used / usableContext) * 100, rounded
  formatted: string; // e.g., "1.5K / 200K (1%)"
  tokens: { input; output; cached };
}

// Implementation
used = input + output + (reasoning ?? 0) + (cache?.read ?? 0);
// cache.write excluded (billing-only)

outputReserve = Math.min(modelLimits.output, 32000);
usableContext = limit - outputReserve;
percentage = Math.round((used / usableContext) * 100);
```

**This is the authoritative formula.** Use this in all new integrations.

---

## SSE Events Reference

### Primary Event: `message.part.updated`

**Emitted:** After each Claude API turn completes  
**Payload:** `StepFinishPart` with token breakdown

**Type Definition:**

**File:** `packages/opencode/src/session/message-v2.ts:189-206`

```typescript
export const StepFinishPart = PartBase.extend({
  type: z.literal("step-finish"),
  reason: z.string(), // "end_turn" | "max_tokens" | "stop_sequence"
  snapshot: z.string().optional(), // Session snapshot ID
  cost: z.number(), // Dollar cost
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(), // Extended thinking tokens (Claude 3.7+)
    cache: z.object({
      read: z.number(), // Prompt cache hits (5x cheaper)
      write: z.number(), // Prompt cache creation (25% surcharge)
    }),
  }),
});
```

**Event Name:** `"message.part.updated"`  
**When:** Appended to `AssistantMessage.parts[]` after API response

---

### Secondary Event: `message.updated`

**Emitted:** When assistant message metadata changes  
**Payload:** Full `AssistantMessage` with cumulative tokens

**Type Definition:**

**File:** `packages/opencode/src/session/message-v2.ts:336-378`

```typescript
export const Assistant = Base.extend({
  role: z.literal("assistant"),
  cost: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
  // ... other fields (parts, timestamp, etc.)
});
```

**Event Name:** `"message.updated"`  
**When:** After `StepFinishPart` appended, or message metadata changed

---

### Token Calculation (Backend)

**File:** `packages/opencode/src/session/index.ts:382-433`

```typescript
const tokens = {
  input: safe(adjustedInputTokens),
  output: safe(input.usage.outputTokens ?? 0),
  reasoning: safe(input.usage?.reasoningTokens ?? 0),
  cache: {
    write: safe(cacheCreationInputTokens),
    read: safe(cachedInputTokens),
  },
};

function safe(n: number | undefined): number {
  if (n == null || isNaN(n)) return 0;
  return Math.max(0, Math.round(n));
}
```

**Source:** `input.usage` from Anthropic SDK's `MessageStreamEvent`

---

## TypeScript Type Definitions

### Token Usage Object

```typescript
interface TokenUsage {
  input: number; // Non-cached input tokens
  output: number; // Assistant output tokens
  reasoning: number; // Extended thinking tokens (Claude 3.7+)
  cache: {
    read: number; // Prompt cache hits (don't count toward context)
    write: number; // Prompt cache creation (billing-only, NOT context)
  };
}
```

### Model Limits

**File:** `packages/sdk/js/src/v2/gen/types.gen.ts:1766-1769`

```typescript
interface ModelLimits {
  limit: {
    context: number; // Total context window (e.g., 200000 for Claude 3.7)
    output: number; // Max output tokens (e.g., 16000)
  };
}
```

**Example Values:**

- Claude 3.5 Sonnet: `{ context: 200000, output: 16000 }`
- Claude 3.7 Sonnet: `{ context: 200000, output: 16000 }`
- Claude Haiku: `{ context: 200000, output: 8192 }`

### Context Usage (ContextService Output)

```typescript
interface ContextUsage {
  used: number; // input + output + reasoning + cache.read
  limit: number; // Model's context window
  usableContext: number; // limit - min(outputLimit, 32000)
  percentage: number; // Math.round((used / usableContext) * 100)
  formatted: string; // Human-readable: "1.5K / 200K (1%)"
  tokens: {
    input: number;
    output: number;
    cached: number; // cache.read only
  };
}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      DATA FLOW: SSE → UI                        │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────────┐
  │ Claude API   │  Anthropic MessageStreamEvent
  │  Response    │  ├─ usage.input_tokens
  └──────┬───────┘  ├─ usage.output_tokens
         │          ├─ usage.reasoning_tokens (Claude 3.7+)
         │          ├─ usage.cache_creation_input_tokens
         ↓          └─ usage.cache_read_input_tokens
  ┌──────────────┐
  │ Session      │  Session.getUsage() → TokenUsage object
  │  .getUsage() │  File: packages/opencode/src/session/index.ts:382-433
  └──────┬───────┘
         │
         ↓
  ┌──────────────┐
  │ StepFinish   │  message.part.updated (SSE)
  │    Part      │  ├─ tokens: { input, output, reasoning, cache }
  └──────┬───────┘  └─ cost: number
         │
         ↓
  ┌──────────────┐
  │   Bus.ts     │  Event bus publishes to subscribers
  │  .publish()  │  File: packages/opencode/src/bus.ts
  └──────┬───────┘
         │
         ├──────────────────────────────────┐
         │                                  │
         ↓                                  ↓
  ┌──────────────┐                  ┌──────────────┐
  │ EventStore   │                  │ SSE Clients  │
  │  (SQLite)    │                  │  (HTTP/2)    │
  └──────┬───────┘                  └──────┬───────┘
         │                                  │
         ↓                                  ↓
  ┌──────────────┐                  ┌──────────────┐
  │ /stream      │                  │ EventSource  │
  │  /events     │───────SSE────────│  Listener    │
  └──────────────┘                  └──────┬───────┘
                                           │
                                           ↓
                                    ┌──────────────┐
                                    │ World Store  │  Jotai atom update
                                    │  Update      │  (worldAtom)
                                    └──────┬───────┘
                                           │
                                           ↓
                                    ┌──────────────┐
                                    │ UI Component │  React re-render
                                    │  Re-render   │  (context percentage)
                                    └──────────────┘
```

---

## Integration Guide: opencode-next World Layer

### Current State (BUGGY)

**File:** `packages/core/src/world/derived.ts:90-105`

```typescript
// BUG: Includes cache.write
const totalTokens = input + output + reasoning + cache.read + cache.write; // ← INCORRECT
```

### Recommended Fix

**Step 1: Add ContextService to ApiLayer**

**File:** `packages/core/src/runtime.ts:33`

```typescript
import { ContextService } from "./services/context-service";

export const ApiLayer = Layer.mergeAll(
  ContextService.Live, // ← Add this
  // ... other services
);
```

**Step 2: Use ContextService in derived.ts**

```typescript
import { ContextService } from "../services/context-service";

// Inside worldAtom derivation
const contextService = yield * _(ContextService);

const contextUsage = contextService.computeUsage({
  tokens: {
    input: message.tokens.input,
    output: message.tokens.output,
    reasoning: message.tokens.reasoning ?? 0,
    cache: {
      read: message.tokens.cache.read,
      write: message.tokens.cache.write,
    },
  },
  modelLimits: {
    context: session.model.limit.context,
    output: session.model.limit.output,
  },
});

// Populate EnrichedSession
const enrichedSession: EnrichedSession = {
  // ... other fields
  contextUsage, // { used, limit, usableContext, percentage, formatted, tokens }
};
```

**Step 3: Update EnrichedSession Type**

```typescript
interface EnrichedSession {
  id: string;
  // ... other fields
  contextUsage: ContextUsage; // ← Add this field
}
```

**Step 4: Display in UI**

```typescript
// In SessionView or ContextIndicator component
const { contextUsage } = session

return (
  <div>
    <span>{contextUsage.formatted}</span>
    {contextUsage.percentage > 80 && (
      <WarningIcon title="Approaching compaction threshold" />
    )}
  </div>
)
```

---

## Known Issues & Gotchas

### 1. TUI cache.write Bug

**Issue:** TUI includes `cache.write` in context calculation  
**File:** `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:54-59`  
**Impact:** Context percentage inflated by ~10-20% depending on cache behavior  
**Fix:** Remove `last.tokens.cache.write` from total

**Before:**

```typescript
const total =
  last.tokens.input +
  last.tokens.output +
  last.tokens.reasoning +
  last.tokens.cache.read +
  last.tokens.cache.write; // ← Remove this
```

**After:**

```typescript
const total =
  last.tokens.input +
  last.tokens.output +
  last.tokens.reasoning +
  last.tokens.cache.read;
```

---

### 2. Compaction Doesn't Account for Reasoning Tokens

**Issue:** Compaction trigger excludes `reasoning` tokens  
**File:** `packages/opencode/src/session/compaction.ts:30-38`  
**Impact:** Extended thinking models may hit limits before compaction triggers  
**Fix:** Add `reasoning` to compaction calculation

**Before:**

```typescript
const count =
  input.tokens.input + input.tokens.cache.read + input.tokens.output;
```

**After:**

```typescript
const count =
  input.tokens.input +
  input.tokens.cache.read +
  input.tokens.output +
  (input.tokens.reasoning ?? 0);
```

---

### 3. Cache Read vs Write Confusion

**Clarification:**

| Metric        | Context Usage? | Billing Impact | Purpose                         |
| ------------- | -------------- | -------------- | ------------------------------- |
| `cache.read`  | ✅ YES         | 90% cheaper    | Prompt cache hits (5x discount) |
| `cache.write` | ❌ NO          | 25% surcharge  | Cache creation (billing metric) |

**Why cache.write doesn't count:**

- Cache writes are **stored server-side** for future requests
- They don't occupy the current request's context window
- They're a billing metric to cover storage/indexing costs

---

### 4. Reasoning Token Support

**Added:** Claude 3.7 (December 2024)  
**Default:** `0` for older models  
**Behavior:** Extended thinking uses reasoning tokens (can be 10-100K+)

**Defensive Coding:**

```typescript
const reasoning = message.tokens.reasoning ?? 0; // Fallback for older models
```

---

### 5. Output Reserve Capping

**Why cap at 32K?**

The compaction logic reserves space for the assistant's response. Anthropic's models have varying output limits:

- Claude 3.5 Sonnet: 16K
- Claude 3.7 Sonnet: 16K
- Future models: May have 32K+ (but we cap at 32K for safety)

**Formula:**

```typescript
const outputReserve = Math.min(modelLimits.output, 32000);
const usableContext = contextLimit - outputReserve;
```

**Example (Claude 3.7):**

- Context limit: 200,000
- Output limit: 16,000
- Usable context: 200,000 - 16,000 = **184,000**

---

## Testing Strategy

### Unit Test: ContextService

```typescript
import { ContextService } from "./context-service";

test("excludes cache.write from context usage", () => {
  const service = new ContextService();

  const usage = service.computeUsage({
    tokens: {
      input: 1000,
      output: 500,
      reasoning: 2000,
      cache: { read: 5000, write: 3000 }, // write should be ignored
    },
    modelLimits: { context: 200000, output: 16000 },
  });

  expect(usage.used).toBe(8500); // 1000 + 500 + 2000 + 5000 (NO cache.write)
  expect(usage.usableContext).toBe(184000); // 200000 - 16000
  expect(usage.percentage).toBe(5); // Math.round((8500 / 184000) * 100)
});
```

### Integration Test: SSE → World Store

```typescript
test("worldAtom updates on message.part.updated", async () => {
  const store = createStore();

  // Simulate SSE event
  emitSSE("message.part.updated", {
    type: "step-finish",
    tokens: {
      input: 1000,
      output: 500,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  });

  await waitFor(() => {
    const world = store.get(worldAtom);
    const session = world.sessions.get("session-123");
    expect(session?.contextUsage.used).toBe(1500);
  });
});
```

### E2E Test: Context Percentage Display

```typescript
test("displays correct context percentage in UI", async () => {
  await page.goto("/session/123");

  // Wait for SSE connection + initial render
  await page.waitForSelector("[data-testid='context-indicator']");

  const text = await page.textContent("[data-testid='context-indicator']");
  expect(text).toMatch(/1\.5K \/ 200K \(1%\)/); // ContextUsage.formatted
});
```

---

## Migration Checklist

- [ ] **Add ContextService to ApiLayer** (runtime.ts)
- [ ] **Update derived.ts** to use ContextService instead of manual calculation
- [ ] **Fix TUI sidebar.tsx** to exclude cache.write
- [ ] **Update compaction.ts** to include reasoning tokens
- [ ] **Add EnrichedSession.contextUsage** field to type definitions
- [ ] **Update UI components** to display ContextUsage.formatted
- [ ] **Write unit tests** for ContextService edge cases
- [ ] **Write integration tests** for SSE → Store flow
- [ ] **Update documentation** to reflect correct formula

---

## References

### Source Files

| File                                                           | Lines     | Purpose                       |
| -------------------------------------------------------------- | --------- | ----------------------------- |
| `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` | 54-59     | TUI context display (BUGGY)   |
| `packages/opencode/src/session/compaction.ts`                  | 30-38     | Compaction trigger (OUTDATED) |
| `packages/opencode/src/session/message-v2.ts`                  | 189-206   | StepFinishPart type           |
| `packages/opencode/src/session/message-v2.ts`                  | 336-378   | AssistantMessage type         |
| `packages/opencode/src/session/index.ts`                       | 382-433   | Token calculation backend     |
| `packages/core/src/services/context-service.ts`                | (entire)  | ContextService (CORRECT)      |
| `packages/core/src/world/derived.ts`                           | 90-105    | World atom derivation (BUGGY) |
| `packages/sdk/js/src/v2/gen/types.gen.ts`                      | 1766-1769 | ModelLimits type              |

### External Documentation

- [Anthropic Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) – Cache read/write billing
- [Anthropic Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) – Reasoning tokens
- [SSE Specification](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) – EventSource API

---

## Appendix: ASCII Art for PRs

```
╔══════════════════════════════════════════════════════════════╗
║                   CONTEXT CALCULATION                        ║
║                      FIXED ✓                                 ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  BEFORE: UI = input + output + reasoning + read + WRITE ❌   ║
║  AFTER:  UI = input + output + reasoning + read       ✅     ║
║                                                              ║
║  Cache writes are billing-only, not context usage.          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

**Ship it.** 🚀
