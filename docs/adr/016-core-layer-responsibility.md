# ADR-016: Core Layer Responsibility Model

**Status:** Proposed  
**Date:** 2026-01-01  
**Deciders:** Joel Hooks, ADR-Architect Agent  
**Related:** [ADR-015](015-event-architecture-simplification.md), [CORE_LAYER_GAPS_AUDIT.md](../CORE_LAYER_GAPS_AUDIT.md)

```
    ╔═════════════════════════════════════════════════╗
    ║   🧠 SMART BOUNDARIES, DUMB COMPONENTS 🧠       ║
    ╠═════════════════════════════════════════════════╣
    ║                                                 ║
    ║   BEFORE: React does everything                 ║
    ║   ┌───────────────────────────────┐             ║
    ║   │  REACT LAYER (bloated)        │             ║
    ║   │  • Status computation         │             ║
    ║   │  • Data joining               │             ║
    ║   │  • Business logic             │             ║
    ║   │  • API transformations        │             ║
    ║   │  • UI rendering               │             ║
    ║   └───────────────────────────────┘             ║
    ║                ▼                                ║
    ║   ┌───────────────────────────────┐             ║
    ║   │  CORE (thin wrapper)          │             ║
    ║   │  • SDK re-exports             │             ║
    ║   │  • SSE pass-through           │             ║
    ║   └───────────────────────────────┘             ║
    ║                                                 ║
    ║   AFTER: Core does heavy lifting                ║
    ║   ┌───────────────────────────────┐             ║
    ║   │  REACT LAYER (lean)           │             ║
    ║   │  • UI binding only            │             ║
    ║   └───────────────────────────────┘             ║
    ║                ▼                                ║
    ║   ┌───────────────────────────────┐             ║
    ║   │  CORE (smart boundary)        │             ║
    ║   │  • Computed APIs              │             ║
    ║   │  • Pre-joined data            │             ║
    ║   │  • Effect services            │             ║
    ║   │  • Domain logic               │             ║
    ║   │  • Status computation         │             ║
    ║   └───────────────────────────────┘             ║
    ║                ▼                                ║
    ║   ┌───────────────────────────────┐             ║
    ║   │  SDK / BACKEND                │             ║
    ║   └───────────────────────────────┘             ║
    ║                                                 ║
    ║   Model B: 840 LOC → Core, React simplified    ║
    ╚═════════════════════════════════════════════════╝
```

## Context

### The Question

What should `packages/core/` be responsible for in the opencode-next architecture?

### Current State: Thin Wrapper (Model A)

The Core layer is currently a **thin wrapper** around the SDK:

```
packages/core/ (current)
├── api/           # Promise wrappers over SDK
├── atoms/         # Effect programs (mostly unused)
├── sse/           # MultiServerSSE (pass-through)
├── router/        # 4,377 LOC DEAD CODE (0 invocations)
└── types/         # Type re-exports
```

**Characteristics:**
- Core re-exports SDK types and methods with minimal transformation
- React layer does ALL domain logic (status computation, data joining, transformations)
- Router exists but 100% unused (all API calls bypass it)
- ~840 LOC of business logic lives in React that should be reusable

### The Problem

**Core is too thin.** React does work that belongs in Core:

1. **Session status computation** - 3-source logic (sessionStatus map + sub-agent activity + last message check)
2. **Bootstrap status derivation** - N+1 query pattern, fragile heuristics
3. **Messages + Parts joining** - Every render pays join cost
4. **Session status normalization** - Backend sends 3 different formats, React normalizes
5. **Context usage computation** - Token summation, model limit lookup, percentage calc
6. **Prompt API transformation** - Path resolution, MIME detection, ID generation
7. **Time formatting** - Relative time ("5m ago"), prevents SSR
8. **Token formatting** - Number abbreviation (1.5K, 2.3M)

**Impact:** Non-React consumers (CLI, TUI, future mobile) can't reuse this logic without depending on React.

**Evidence:** [CORE_LAYER_GAPS_AUDIT.md](../CORE_LAYER_GAPS_AUDIT.md) documents 8 gaps in detail.

### The Router Situation

The router layer (4,377 LOC) was created in ADR-002 as an Effect-based routing abstraction. **It is 100% dead code:**

- Created in `OpencodeProvider` but never invoked
- All API calls bypass via direct SDK client or atoms layer
- AsyncLocalStorage DI experiment that never shipped
- Verified by swarm research (Worker xts0a-mjuyf478ucu): 0 invocations found

**Key Insight:** Router solves the wrong problem. The issue isn't "how to route requests" (SDK handles that). The issue is "what computation should Core provide?"

### EffectPatterns Research

Research into Effect-React integration patterns (from Hivemind) reveals the **runWithRuntime pattern**:

**Anti-Pattern (DON'T):**
```typescript
// ❌ React imports Effect directly
import { Effect } from "effect";

export function useSession(id: string) {
  const [session, setSession] = useState<Session | null>(null);
  
  useEffect(() => {
    const program = Session.get(id); // Effect program
    // React component now coupled to Effect
  }, [id]);
}
```

**Correct Pattern (DO):**
```typescript
// ✅ Core exposes promise APIs, hides Effect
// packages/core/src/api/sessions.ts
export async function getSessions(): Promise<Session[]> {
  return runWithRuntime(SessionService.pipe(Effect.flatMap(s => s.list())));
}

// packages/react/src/hooks/use-sessions.ts
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  
  useEffect(() => {
    getSessions().then(setSessions); // React never imports Effect
  }, []);
  
  return sessions;
}
```

**Benefits:**
- Effect dependencies pre-configured in AppLayer
- Consumer code never imports Effect types
- Core can use Effect internally without polluting React
- Future: CLI/TUI consumers just call promise APIs

**Source:** Hivemind memories `mem-abe714fa47ad2b36`, `mem-eb60fc36630619f1`, `mem-5bef20787787b69d`

## Decision Drivers

1. **Reusability** - Core logic should work beyond React (CLI, TUI, mobile)
2. **Simplicity** - React should bind UI, not implement business logic
3. **Performance** - Pre-compute on backend/Core, not every React render
4. **Maintainability** - Single source of truth for domain logic
5. **Effect isolation** - React never imports Effect directly
6. **SSR compatibility** - Formatting utils must work server-side
7. **Avoid dead code** - Delete the router (4,377 LOC), don't double down on it

## Considered Options

### Option 1: Keep Thin Wrapper (Status Quo)

**Model:** Core = SDK wrapper, React does everything else.

**Pros:**
- No migration cost
- No risk
- Familiar pattern

**Cons:**
- 840 LOC of business logic trapped in React
- Non-React consumers can't reuse logic
- Router remains dead code (4,377 LOC maintenance burden)
- Bootstrap N+1 query pattern persists
- Status computation duplicated (bootstrap vs SSE)
- No SSR for time/token formatting

**Verdict:** ❌ **REJECTED** - Doesn't solve the actual problem

---

### Option 2: Router Gateway (Embrace the Router)

**Model:** Keep router, make it the primary API surface.

**Architecture:**
```typescript
// All API calls go through router
const router = createRouter({
  sessions: {
    list: Effect.gen(function* () {
      const sdk = yield* SDK;
      const timeout = yield* TimeoutService;
      return yield* sdk.sessions.list().pipe(timeout.apply());
    }),
  },
});

// React uses router
export function useSessions() {
  const router = useRouter();
  return useEffect(() => {
    router.sessions.list().pipe(Effect.runPromise).then(setSessions);
  }, []);
}
```

**Pros:**
- Type-safe routes with timeout/retry/validation built-in
- Effect services for cross-cutting concerns (logging, auth, metrics)
- Centralized API contract

**Cons:**
- **Solves wrong problem** - Issue isn't "routing", it's "computation"
- **4,377 LOC of existing code is unused** - No evidence anyone needs this abstraction
- **React must import Effect types** - Violates EffectPatterns guidance
- **Router adds indirection** - SDK already handles routing
- **Doesn't address the 8 gaps** - Router is for routing, not status computation
- **Doubles down on dead code** - Investing in something that never shipped

**Key Insight:** The router was an abstraction looking for a problem. The real gaps are:
- "How do I compute session status?"
- "How do I join messages + parts?"
- "How do I format tokens for display?"

These are **computation problems**, not **routing problems**.

**Verdict:** ❌ **REJECTED** - Wrong abstraction for the actual needs

---

### Option 3: Smart Boundary (RECOMMENDED)

**Model:** Core provides computed APIs + Effect services, React binds UI only.

**Architecture:**
```
┌─────────────────────────────────────────┐
│  REACT LAYER                            │
│  - Hooks call Core promise APIs        │
│  - Never imports Effect                 │
│  - UI binding only                      │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│  CORE API LAYER (promises)              │
│  - sessions.getStatus()                 │
│  - sessions.listWithStatus()            │
│  - messages.listWithParts()             │
│  - format.relativeTime()                │
│  - format.tokens()                      │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│  CORE SERVICE LAYER (Effect)            │
│  - SessionService                       │
│  - MessageService                       │
│  - StatusService                        │
│  - AppLayer (DI composition)            │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│  SDK / BACKEND                          │
└─────────────────────────────────────────┘
```

**Fill the 8 Gaps:**

| Gap # | Current (React) | New (Core API) | LOC Impact |
|-------|-----------------|----------------|------------|
| 1. Session status | `deriveSessionStatus()` in hooks | `sessions.getStatus(sessionId)` | -300 |
| 2. Time formatting | `formatRelativeTime()` in hooks | `format.relativeTime(timestamp)` | -50 |
| 3. Messages+Parts | `useMessagesWithParts()` joins | `messages.listWithParts(sessionId)` | -70 |
| 4. Bootstrap status | N+1 queries in hook | `sessions.listWithStatus({ recentOnly: true })` | -150 |
| 5. Prompt transform | `convertToApiParts()` in lib | `prompt.convertToApiParts(parts, dir)` | -80 |
| 6. Status normalize | Switch statement in store | `sse.normalizeStatus(payload)` (internal) | -40 |
| 7. Token formatting | `formatTokens()` in hooks | `format.tokens(n)` | -30 |
| 8. Context usage | `useContextUsage()` computes | `sessions.getContextUsage(sessionId)` | -120 |
| **TOTAL** | **~840 LOC** | **~430 LOC** | **-410 net** |

**Example Implementation (Gap 1: Session Status):**

```typescript
// packages/core/src/services/status-service.ts
import { Effect, Layer } from "effect";

export class StatusService extends Effect.Service<StatusService>()("StatusService", {
  effect: Effect.gen(function* () {
    const sdk = yield* SDKService;
    
    return {
      /**
       * Compute session status from 3 sources:
       * 1. sessionStatus map from SSE
       * 2. Sub-agent activity (task parts with status="running")
       * 3. Last message check (bootstrap edge case)
       */
      computeStatus: (
        sessionId: string,
        options?: { includeSubAgents?: boolean }
      ) => Effect.gen(function* () {
        // SOURCE 1: Check status map (from SSE)
        const statusMap = yield* StatusMapService;
        const mainStatus = statusMap.get(sessionId) ?? "completed";
        if (mainStatus === "running") return "running";
        
        // SOURCE 2: Check sub-agent activity
        if (options?.includeSubAgents) {
          const parts = yield* sdk.parts.list({ sessionId });
          const hasActiveSubAgent = parts.some(p => p.state?.status === "running");
          if (hasActiveSubAgent) return "running";
        }
        
        // SOURCE 3: Last message check (bootstrap case)
        const messages = yield* sdk.messages.list({ sessionId, limit: 1 });
        const lastMessage = messages[0];
        if (lastMessage?.role === "assistant" && !lastMessage.time?.completed) {
          return "running";
        }
        
        return mainStatus;
      }),
    };
  }),
}) {}

// packages/core/src/api/sessions.ts
import { runWithRuntime } from "./runtime";
import { StatusService } from "../services/status-service";

/**
 * Get session status (all sources combined)
 */
export async function getStatus(
  sessionId: string,
  options?: { includeSubAgents?: boolean }
): Promise<SessionStatus> {
  return runWithRuntime(
    StatusService.pipe(
      Effect.flatMap(s => s.computeStatus(sessionId, options))
    )
  );
}

// packages/react/src/hooks/use-session-status.ts
import { getStatus } from "@opencode-vibe/core/api/sessions";
// ☝️ React NEVER imports Effect

export function useSessionStatus(sessionId: string): SessionStatus {
  const [status, setStatus] = useState<SessionStatus>("completed");
  
  useEffect(() => {
    getStatus(sessionId, { includeSubAgents: true }).then(setStatus);
  }, [sessionId]);
  
  return status;
}
```

**Pros:**
- **Addresses the actual gaps** - Fills all 8 gaps identified in audit
- **Effect isolation** - React never imports Effect, uses promise APIs
- **Reusability** - CLI/TUI can call same Core APIs
- **Performance** - Pre-computed data, no client-side joins/computation
- **SSR-compatible** - Formatting utils work server-side
- **Deletes router** - 4,377 LOC removed (it was solving wrong problem)
- **Net LOC reduction** - ~840 removed from React, ~430 added to Core = -410 net
- **Single source of truth** - Status computation logic lives in one place
- **Aligns with EffectPatterns** - runWithRuntime boundary proven pattern
- **Testable** - Core functions are pure Effect programs, easy to test

**Cons:**
- **Migration effort** - 1-2 weeks to implement all 8 gaps
- **Core API churn** - May need iteration to get APIs right
- **Learning curve** - Team must understand Effect for Core development (mitigated: React devs don't need it)
- **Temporary duplication** - Dual implementation during migration

**Verdict:** ✅ **ACCEPTED**

## Decision Outcome

**Adopt Model B: Smart Boundary.**

### What This Means

**Core Responsibilities:**
1. **Computed APIs** - Pre-compute session status, context usage, etc.
2. **Pre-joined data** - Return messages with parts embedded
3. **Effect services** - Internal implementation using Effect for DI/streams
4. **Promise APIs** - External surface area is async/await, not Effect
5. **Domain logic** - Status computation, formatting, transformations
6. **Utils layer** - Formatting functions (time, tokens, numbers)

**React Responsibilities:**
1. **UI binding** - Hooks connect Core APIs to components
2. **Zustand store** - UI state only (selected session, UI flags)
3. **SSE event dispatch** - Call Core APIs when events arrive
4. **No business logic** - All computation delegated to Core
5. **No Effect imports** - Use promise APIs only

**Router Responsibility:**
- **DELETE IT** - 4,377 LOC removed, problem was "computation" not "routing"

### Why This Wins

1. **Router was wrong abstraction** - It's not a routing problem, it's a computation problem
2. **Gaps audit shows real needs** - 8 specific gaps that Model B fills
3. **EffectPatterns proven** - runWithRuntime pattern isolates Effect from React
4. **Reusability unlocked** - CLI/TUI can use Core without React dependency
5. **Simplifies React** - 840 LOC of business logic moves to Core
6. **Aligns with goals** - "Simplify React by enriching Core" (ADR-015)

## Consequences

### Positive

1. **410 net LOC reduction** - 840 removed from React, 430 added to Core
2. **4,377 LOC dead code deleted** - Router removed
3. **Reusable Core** - CLI/TUI/mobile can call same APIs
4. **Effect isolation** - React devs don't need to learn Effect
5. **SSR-compatible** - Formatting utils work server-side
6. **Performance gains** - Pre-computed data, no client-side joins
7. **Single source of truth** - Status logic in one place (not bootstrap + SSE)
8. **Better testability** - Pure Effect programs, mockable services
9. **Eliminates N+1 queries** - Bootstrap fetches status in one call
10. **Future-proof** - Core becomes universal API layer (web, CLI, TUI, mobile)

### Negative

1. **Migration effort** - 1-2 weeks to fill 8 gaps + update React hooks
2. **Core API design risk** - May need iteration to get APIs right
3. **Temporary duplication** - Dual implementation during migration (1-2 weeks)
4. **Effect learning curve** - Core developers must understand Effect (React devs exempt)
5. **Testing burden** - Need tests for Core services + React hooks + integration
6. **Dependency complexity** - AppLayer composition requires understanding Effect Layers

### Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Core API design wrong | Medium | Medium | Iterate in Phase 1 (Priority 1 gaps only), get feedback before expanding |
| Effect too complex | Low | Medium | runWithRuntime isolates React from Effect, only Core devs need Effect knowledge |
| Performance regression | Low | High | Measure in Phase 1, rollback if slower than client-side computation |
| Migration breaks features | Medium | High | Dual implementation + feature flags, gradual rollout per gap |
| Backend changes required | Medium | Medium | Some gaps (bootstrap, context usage) may need backend support - phase accordingly |

## Implementation Plan

### Phase 1: Core Foundations (Priority 1 Gaps) - 2-3 days

**Goal:** Prove the pattern with highest-impact gaps.

**Tasks:**
1. ✅ Add `packages/core/src/utils/format.ts`
   - `formatRelativeTime(timestamp): string` (Gap 2)
   - `formatTokens(n): string` (Gap 7)
   - Tests for formatting utilities
2. ✅ Add `packages/core/src/services/status-service.ts`
   - `computeStatus(sessionId, options)` Effect program (Gap 1)
   - Tests for status computation logic
3. ✅ Add `packages/core/src/api/sessions.ts`
   - `getStatus(sessionId, options): Promise<SessionStatus>` (Gap 1)
   - `listWithStatus(options): Promise<SessionWithStatus[]>` (Gap 4)
   - Tests for promise APIs
4. ✅ Update React hooks (Priority 1 only)
   - Replace `deriveSessionStatus()` with `sessions.getStatus()`
   - Replace bootstrap N+1 with `sessions.listWithStatus({ recentOnly: true })`
   - Update tests

**Success Criteria:**
- All tests pass (Core + React)
- Type check passes: `bun run typecheck`
- Bootstrap latency reduced by >50%
- No Effect imports in React layer

**Rollback:** Feature flag `USE_CORE_STATUS_API`, dual implementation for 1 week

### Phase 2: Data Transformation (Priority 2 Gaps) - 2-3 days

**Goal:** Move API transformations to Core.

**Tasks:**
1. ✅ Add `packages/core/src/services/message-service.ts`
   - `listWithParts(sessionId)` Effect program (Gap 3)
   - Tests for message+parts join logic
2. ✅ Add `packages/core/src/api/messages.ts`
   - `listWithParts(sessionId): Promise<OpencodeMessage[]>` (Gap 3)
   - Tests for promise API
3. ✅ Add `packages/core/src/api/prompt.ts`
   - `convertToApiParts(parts, directory): ApiPart[]` (Gap 5)
   - Tests for path resolution, MIME detection
4. ✅ Update React hooks/lib
   - Replace `useMessagesWithParts()` with `messages.listWithParts()`
   - Replace `convertToApiParts()` with Core API
   - Update tests

**Success Criteria:**
- All tests pass
- Type check passes
- Client-side join eliminated (verify with profiler)
- 150 LOC removed from React

**Rollback:** Git revert, feature flag per API

### Phase 3: SSE Normalization (Priority 2) - 1-2 days

**Goal:** Centralize status format normalization.

**Tasks:**
1. ✅ Add status normalization to `packages/core/src/sse/multi-server-sse.ts`
   - `private normalizeStatus(payload): SessionStatus` (Gap 6)
   - Handle 3 backend formats (object.type, object.running, string)
   - Emit normalized status in SSE events
   - Tests for normalization logic
2. ✅ Update React store
   - Remove normalization switch statement
   - Expect normalized status from SSE
   - Update tests

**Success Criteria:**
- All tests pass
- SSE events have consistent status format
- 40 LOC removed from React store
- No breaking changes to SSE contract

**Rollback:** Keep normalization in both places temporarily

### Phase 4: Context Usage (Priority 2) - 2-3 days

**Goal:** Move context usage computation to Core (or backend).

**Tasks:**
1. ✅ Add `packages/core/src/services/context-service.ts`
   - `computeUsage(sessionId)` Effect program (Gap 8)
   - Token summation, model limit lookup, percentage calc
   - Tests for computation logic
2. ✅ Add `packages/core/src/api/sessions.ts`
   - `getContextUsage(sessionId): Promise<ContextUsage>` (Gap 8)
   - Tests for promise API
3. ✅ Update React hooks
   - Replace `useContextUsage()` computation with Core API
   - Update tests

**Alternative:** Backend includes `contextUsage` in Session type (requires backend coordination).

**Success Criteria:**
- All tests pass
- Context usage computed once (not every render)
- 120 LOC removed from React
- Consider backend pre-computation (Phase 5)

**Rollback:** Feature flag `USE_CORE_CONTEXT_USAGE`, dual implementation

### Phase 5: Backend Coordination (Optional) - 1-2 weeks

**Goal:** Move some computation to backend for maximum performance.

**Candidates:**
- **Gap 4 (Bootstrap):** Backend includes status in `/session/list` response
- **Gap 8 (Context Usage):** Backend computes usage server-side, includes in Session
- **Gap 6 (Status Normalization):** Backend standardizes on single format

**Trade-off:** Backend changes add development time but reduce client computation.

**Success Criteria:**
- Measure client-side computation cost first
- Only move to backend if >100ms savings per request
- Coordinate with backend team on API changes

**Decision:** Defer until Phase 1-4 complete, measure actual impact.

### Phase 6: Cleanup - 1 day

**Goal:** Delete dead code and consolidate.

**Tasks:**
1. ✅ Delete `packages/core/src/router/` (4,377 LOC)
2. ✅ Delete unused React utilities replaced by Core
3. ✅ Update documentation (README, AGENTS.md)
4. ✅ Verify all tests pass
5. ✅ Run final type check: `bun run typecheck`

**Success Criteria:**
- 4,377 LOC removed (router)
- ~410 net LOC reduction (840 React - 430 Core)
- All features working
- No dead imports

### Migration Timeline

| Phase | Duration | LOC Impact | Risk |
|-------|----------|------------|------|
| Phase 1 (Foundations) | 2-3 days | -300 React | Low |
| Phase 2 (Transformation) | 2-3 days | -150 React | Low |
| Phase 3 (SSE Normalize) | 1-2 days | -40 React | Low |
| Phase 4 (Context Usage) | 2-3 days | -120 React | Medium |
| Phase 5 (Backend - Optional) | 1-2 weeks | TBD | Medium |
| Phase 6 (Cleanup) | 1 day | -4,377 Router | Low |
| **TOTAL** | **1.5-2 weeks** | **-4,987 net** | **Low-Medium** |

**Phasing Strategy:**
- Each phase is independently shippable
- Feature flags for gradual rollout
- Dual implementation during migration (1-2 weeks per phase)
- Measure performance after each phase

## Links

- **Related ADRs:**
  - [ADR-015: Event Architecture Simplification](015-event-architecture-simplification.md) - Overall simplification strategy
  - [ADR-002: Effect Migration](002-effect-migration.md) - Original Effect-TS proposal
  - [ADR-010: Store Architecture](010-store-architecture.md) - Zustand patterns
- **Analysis Documents:**
  - [CORE_LAYER_GAPS_AUDIT.md](../CORE_LAYER_GAPS_AUDIT.md) - Detailed gap analysis with code examples
  - `docs/investigations/router-layer-usage-analysis.md` - Router dead code verification
  - `docs/investigations/sse-core-layer.md` - SSE integration patterns

## References

- **Effect-TS Patterns:**
  - [EffectPatterns Repo](https://github.com/effect-patterns) - runWithRuntime examples
  - Hivemind Memory `mem-eb60fc36630619f1` - Effect Promise API pattern
  - Hivemind Memory `mem-abe714fa47ad2b36` - Effect React anti-patterns
  - Hivemind Memory `mem-5bef20787787b69d` - Service factory patterns
- **Architectural Principles:**
  - "Parse, don't validate" - Alexis King
  - "Make impossible states impossible" - TypeScript mantra
  - "Simplicity is prerequisite for reliability" - Dijkstra
- **Prior Art:**
  - Remix loader pattern (data pre-fetching)
  - Next.js Server Components (computation on server)
  - Effect-TS Layers (dependency injection)

---

## Appendix A: Comparison Matrix

| Concern | Model A (Thin) | Model B (Smart) | Model C (Router) |
|---------|----------------|-----------------|------------------|
| **LOC in Core** | ~2,000 | ~2,430 (+430) | ~6,377 (keep router) |
| **LOC in React** | ~3,000 | ~2,160 (-840) | ~2,800 (-200) |
| **Dead code** | 4,377 (router) | 0 (deleted) | 0 (used) |
| **Effect isolation** | N/A | ✅ Yes (runWithRuntime) | ❌ No (React imports Effect) |
| **Reusability** | ❌ Logic in React | ✅ Core APIs | ⚠️ Need Effect runtime |
| **SSR compatible** | ❌ React formatting | ✅ Core utils | ⚠️ Effect on server |
| **8 Gaps filled** | ❌ No | ✅ Yes | ⚠️ Partially |
| **Migration risk** | None | Low-Medium | High |
| **Team learning** | None | Effect for Core only | Effect everywhere |
| **Addresses problem** | ❌ No | ✅ Yes | ❌ Wrong problem |

## Appendix B: The 8 Gaps Reference

Quick reference to gaps filled by Model B:

| # | Gap | React LOC | Core LOC | API |
|---|-----|-----------|----------|-----|
| 1 | Session status computation | -300 | +100 | `sessions.getStatus()` |
| 2 | Time formatting | -50 | +30 | `format.relativeTime()` |
| 3 | Messages+Parts join | -70 | +50 | `messages.listWithParts()` |
| 4 | Bootstrap status | -150 | +80 | `sessions.listWithStatus()` |
| 5 | Prompt API transform | -80 | +60 | `prompt.convertToApiParts()` |
| 6 | Status normalization | -40 | +20 | `sse.normalizeStatus()` (internal) |
| 7 | Token formatting | -30 | +20 | `format.tokens()` |
| 8 | Context usage | -120 | +70 | `sessions.getContextUsage()` |

**Total:** -840 React, +430 Core = **-410 net reduction**

---

**Next Steps:**

1. ✅ Review ADR-016 with Joel Hooks
2. Create Phase 1 hive cell (Core foundations: status + formatting)
3. Create Phase 6 hive cell (Delete router: 4,377 LOC)
4. Schedule Phase 1 implementation (2-3 days)
5. Measure performance after Phase 1 before proceeding to Phase 2

---

> "The purpose of abstraction is not to be vague, but to create a new semantic level in which one can be absolutely precise."  
> — Edsger W. Dijkstra

**Model B creates the right abstraction:** Core is the semantic level for domain logic, React is the semantic level for UI binding. Each layer can be absolutely precise about its responsibilities.
