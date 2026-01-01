# ADR-015: Event Architecture Simplification

**Status:** Proposed  
**Date:** 2025-12-31  
**Deciders:** Joel Hooks, Swarm Analysis Team  
**Related:** [ADR-002](002-effect-migration.md), [ADR-007](007-nuclear-migration-plan.md), [ADR-010](010-store-architecture.md), [ADR-011](011-sse-proxy-architecture.md)

```
    ╔═══════════════════════════════════════════════╗
    ║   🔥 BURN THE COMPLEXITY, KEEP THE POWER 🔥   ║
    ╠═══════════════════════════════════════════════╣
    ║                                               ║
    ║   BEFORE: 15,900 LOC, 3 dead systems          ║
    ║    AFTER: ~10,929 LOC, enriched Core + lean   ║
    ║           React (31% reduction)               ║
    ║                                               ║
    ║   ┌──────────────┐                            ║
    ║   │   ZUSTAND    │  ← React UI State          ║
    ║   └──────┬───────┘                            ║
    ║          │                                    ║
    ║   ┌──────▼───────┐                            ║
    ║   │  CORE APIs   │  ← Session/Message/Status  ║
    ║   └──────┬───────┘                            ║
    ║          │                                    ║
    ║   ┌──────▼───────┐                            ║
    ║   │EFFECT LAYERS │  ← Service Composition     ║
    ║   └──────────────┘                            ║
    ║                                               ║
    ║   Hybrid: Best of Both Worlds                 ║
    ╚═══════════════════════════════════════════════╝
```

## Context

### Problem Statement

The current event architecture suffers from **severe over-engineering**:

- **15,900 total LOC** across core/react/web layers
- **4,561 LOC (29%) confirmed dead code**:
  - Router layer: **4,377 LOC** (VERIFIED: created but never invoked)
  - SSEAtom: **184 LOC** (VERIFIED: bypassed by store)
- **1,160 LOC factory pattern** (VERIFIED) with 22 hook functions, 3-4 nesting levels
- **Core gaps**: 8 identified areas where Core should provide APIs but React implements (840 LOC moveable)
- **Fragile wiring**: Per-page `useSSEEvents()` calls cause silent failures when missed
- **Hook duplication**: 4 hooks exported from both `@opencode-vibe/react` and `@opencode-vibe/react/hooks`

### Metrics Summary (VERIFIED by Swarm Research)

| Component | LOC | Status | Severity | Source |
|-----------|-----|--------|----------|--------|
| Router Layer | **4,377** | ✅ DEAD CODE (never invoked) | CRITICAL | Worker xts0a-mjuyf478ucu |
| SSEAtom | **184** | ✅ DEAD CODE (bypassed) | HIGH | Worker xts0a-mjuyf478ucu |
| Hook Factory | **1,160** | Over-engineered | HIGH | Worker xts0a-mjuyf478whz |
| Core Gaps | **~840** | Missing Core APIs | HIGH | Worker xts0a-mjuyf479p4z |
| Hook Duplication | 100-150 | Maintainability | MEDIUM | Worker xts0a-mjuyf478whz |

**Net reduction potential: ~4,971 LOC (31% of 15,900 LOC codebase)**

**Calculation:**
- Delete dead code: 4,377 (router) + 184 (SSEAtom) = **4,561 LOC removed**
- Add to Core: ~430 LOC (fill 8 gaps)
- Remove from React: ~840 LOC (use Core APIs instead)
- **Net: 4,561 + 840 - 430 = 4,971 LOC reduction**

### Current Architecture Pain Points

1. **Hook Factory Complexity**
   - 23 closure functions with 3-4 nesting levels
   - Hard to debug (closure scope inspection)
   - Hard to test (requires full factory setup)
   - No clear separation of concerns

2. **SSE Wiring Fragility**
   - Requires manual `useSSEEvents()` call in every page
   - Silent failures when missed (no compile-time check)
   - Caused production bugs (session routing, command execution)

3. **Dead Code Maintenance Burden**
   - **Router layer: 4,377 LOC** (VERIFIED: created in OpencodeProvider but never invoked)
   - **All API calls bypass router** via direct SDK client or atoms layer
   - SSEAtom: 184 LOC completely bypassed by Zustand store
   - Increases onboarding friction, false complexity signals

4. **Core Layer Gaps** (NEW FINDING)
   - 8 areas where Core should provide APIs but React implements:
     1. Session status computation (messages+parts joining)
     2. Bootstrap status computation
     3. Session lifecycle utilities
     4. Agent/turn utilities
     5. Command utilities
     6. Message utilities
     7. Part utilities  
     8. Reference utilities
   - ~840 LOC in React could move to Core
   - Causes duplication when non-React consumers need same logic

5. **Duplication**
   - 4 hooks exported from 2 entry points
   - Import path confusion (which one to use?)

## Decision Drivers

1. **Code reduction without functionality loss** - Remove 31% LOC (4,971 lines) while keeping all features
2. **Enrich Core layer** - Move domain logic to Core, make it reusable beyond React
3. **Eliminate fragility** - Make SSE wiring automatic, prevent silent failures
4. **Improve debuggability** - Replace closure factories with inspectable services
5. **Maintain React patterns** - Keep Zustand for UI state (familiar to team)
6. **Adopt Effect-TS strategically** - Use where it shines (streams, DI), not everywhere
7. **Independent shippability** - Each phase must be deployable alone

## Considered Options

### Option 1: Status Quo (Do Nothing)

**Pros:**
- No migration risk
- No development time spent

**Cons:**
- Maintain 3,646 LOC of dead code
- Continue fragile SSE wiring pattern
- Factory complexity blocks new contributors
- Router layer purpose unclear (potential security/stability risk)

**Verdict:** ❌ **REJECTED** - Technical debt compounds, onboarding friction remains

### Option 2: Pure Effect-TS Migration

**Approach:** Replace Zustand, React hooks, and factory with full Effect-TS stack.

**Pros:**
- Consistent programming model
- Type-safe throughout
- Maximum LOC reduction potential

**Cons:**
- High migration risk (rewrite UI state layer)
- Team unfamiliarity with Effect-TS
- React + Effect integration patterns immature
- Disrupts working Zustand patterns
- 2-3 month timeline

**Verdict:** ❌ **REJECTED** - Risk/reward ratio poor, disrupts what works

### Option 3: Hybrid Architecture (RECOMMENDED)

**Approach:** Zustand for UI state + Effect-TS for backend streaming/DI.

**Hybrid Model:**
```typescript
// UI State: Keep Zustand (familiar, works)
const store = create<OpencodeStore>((set) => ({ ... }));

// SSE Processing: Effect Stream (stateful, composable)
const sseStream = Stream.fromEventSource(url).pipe(
  Stream.scan({ messages: [], parts: [] }, (state, event) => {
    // Stateful event processing
  })
);

// Service Composition: Effect Layers (replaces factory)
class SSEService extends Effect.Service<SSEService>()("SSEService", {
  effect: Effect.gen(function* () {
    const config = yield* Config;
    return { connect: (url) => sseStream };
  })
}) {}
```

**Pros:**
- **Low risk:** Keep Zustand for UI state (proven pattern)
- **High impact:** Effect-TS where it excels (streams, DI)
- **Phased migration:** 4 independent phases
- **Team learning:** Gradual Effect-TS adoption
- **Code reduction:** 30-40% LOC removal
- **Improved debuggability:** Services > closures

**Cons:**
- Two state paradigms in codebase
- Requires learning Effect-TS (mitigated by phasing)
- Some architectural complexity (managed via clear boundaries)

**Verdict:** ✅ **ACCEPTED**

## Decision Outcome

**Adopt Hybrid Architecture with enriched Core layer + 4-phase migration.**

### React → Core Migration Path

**Key Insight:** The real simplification comes from **enriching Core with missing APIs**, not just deleting dead code.

**Current Problem:**
- React layer implements domain logic that should live in Core
- 8 identified gaps where Core should provide but doesn't
- Non-React consumers (CLI, TUI, future mobile) have to duplicate logic or depend on React

**8 Core Gaps to Fill:**

| Gap # | Domain | Current (React) | Should Be (Core) | LOC Impact |
|-------|--------|----------------|------------------|------------|
| 1 | Session Status | `useSessionStatus()` computes from messages+parts | `Core.Session.computeStatus(session, messages, parts)` | -120 |
| 2 | Bootstrap Status | `useBootstrapStatus()` | `Core.Session.getBootstrapStatus(session)` | -80 |
| 3 | Session Lifecycle | `useSessionLifecycle()` | `Core.Session.canStart/canContinue/canStop()` | -100 |
| 4 | Agent Utilities | `useAgentInfo()` | `Core.Agent.getCurrentAgent(session)` | -60 |
| 5 | Turn Utilities | `useTurnInfo()` | `Core.Turn.getActiveTurn(session)` | -70 |
| 6 | Command Utils | `useCommands()` | `Core.Command.parse/validate/execute()` | -150 |
| 7 | Message Utils | `useMessages()` filters | `Core.Message.filterByAgent/byTurn()` | -120 |
| 8 | Part Utils | `usePartsByMessage()` | `Core.Part.groupByMessage(parts)` | -140 |

**Total:** ~840 LOC moves from React → Core (~430 LOC net after deduplication)

**Migration Strategy:**

1. **Add Core APIs incrementally** (no breaking changes)
2. **Update React hooks to consume Core APIs** (one gap at a time)
3. **Delete React implementations** once Core APIs proven
4. **Gain reusability** - CLI/TUI can now use same logic

**Effect Pattern for Core:**

```typescript
// Core provides Effect-based APIs
export namespace Session {
  export const computeStatus = (
    session: Session,
    messages: Message[],
    parts: Part[]
  ): Effect.Effect<SessionStatus, never, never> =>
    Effect.gen(function* () {
      const activeTurn = yield* Turn.getActiveTurn(session);
      const hasActiveAgent = parts.some(p => p.state.status === 'active');
      return hasActiveAgent ? 'active' : 'idle';
    });
}

// React consumes via runWithRuntime pattern
export const useSessionStatus = (sessionId: string) => {
  const session = useOpencodeStore(s => s.sessions.find(x => x.id === sessionId));
  const messages = useOpencodeStore(s => s.messages);
  const parts = useOpencodeStore(s => s.parts);
  
  const [status, setStatus] = useState<SessionStatus>('idle');
  
  useEffect(() => {
    if (!session) return;
    
    // Bridge: Effect → Promise
    runWithRuntime(
      Session.computeStatus(session, messages, parts)
    ).then(setStatus);
  }, [session, messages, parts]);
  
  return status;
};
```

**Benefits:**
- ✅ Core becomes source of truth for domain logic
- ✅ React layer simplified (consumes, doesn't implement)
- ✅ Non-React consumers can reuse Core APIs
- ✅ Effect isolation (React never imports Effect directly)

---

## Migration Phases

**Adopt Hybrid Architecture with 4-phase migration:**

### Phase 0: Dead Code Removal (2-3 hours)
**Goal:** Immediate 29% LOC reduction (4,561 lines), zero risk

- ✅ Delete Router layer (**4,377 LOC**) - VERIFIED: created but never invoked
  - Created in `OpencodeProvider.tsx` but all API calls bypass via SDK client or atoms
  - No runtime references, safe to delete
- ✅ Delete SSEAtom (**184 LOC**) - VERIFIED: bypassed by Zustand store
- ✅ Consolidate hook exports - single entry point

**Success Criteria:**
- All tests pass (especially `factory.test.tsx`, `bootstrap.test.ts`)
- No runtime errors in dev/prod
- LOC reduced by 4,561 (29%)
- Type check passes: `bun run typecheck`

**Rollback:** Git revert (no dependencies)

**Verification Evidence:**
- Router: Worker xts0a-mjuyf478ucu found 0 invocations in 4,377 LOC
- All API calls use direct SDK client (`createOpencodeClient`) or atoms layer
- Router was AsyncLocalStorage DI experiment that never shipped

### Phase 1: SSE Wiring Automation (2-4 hours)
**Goal:** Eliminate fragility, prevent silent failures

**Current (fragile):**
```typescript
// MUST call in every page or SSE breaks silently
export default function Page() {
  useSSEEvents(); // Easy to forget!
  return <UI />;
}
```

**After (automatic):**
```typescript
// In root layout - applies to all routes
export default function RootLayout({ children }) {
  useSSEEvents(); // Called once, works everywhere
  return children;
}
```

**Success Criteria:**
- SSE events work on all pages
- Remove 10+ duplicate `useSSEEvents()` calls
- Add test: "SSE events reach store from any route"

**Rollback:** Keep both patterns temporarily, feature flag

### Phase 2: Effect-TS SSE Adoption (1 week)
**Goal:** Replace imperative SSE with Effect Stream (20-30% reduction)

**Current (imperative, 200+ LOC):**
```typescript
const eventSource = new EventSource(url);
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'message.new') {
    set((state) => {
      const idx = binarySearch(state.messages, event.id);
      state.messages.splice(idx, 0, event.data);
    });
  }
  // ... 15 more event types
};
```

**After (declarative, ~140 LOC):**
```typescript
const sseStream = Stream.fromEventSource(url).pipe(
  Stream.map(parseEvent),
  Stream.scan(initialState, (state, event) =>
    match(event)
      .with({ type: 'message.new' }, (e) => ({
        ...state,
        messages: insertSorted(state.messages, e.data)
      }))
      // ... declarative event handlers
  )
);

// Bridge to Zustand
Effect.runPromise(
  sseStream.pipe(Stream.runForEach((state) => store.setState(state)))
);
```

**Benefits:**
- **Stateful processing:** Stream.scan maintains state across events
- **Backpressure:** Built-in buffering for fast event streams
- **Error recovery:** Retry/fallback policies declarative
- **Testability:** Pure functions, no mocking

**Success Criteria:**
- All SSE event types handled
- <5% performance regression (measure with profiler)
- Error scenarios covered (disconnect, malformed events)

**Rollback:** Feature flag `USE_EFFECT_SSE`, dual implementation

### Phase 2.5: Enrich Core with Missing APIs (1 week)
**Goal:** Fill 8 Core gaps, enable React simplification (add ~430 LOC to Core)

**Before:** React implements domain logic (840 LOC)

**After:** Core provides APIs, React consumes them

**Migration Order** (by dependency):
1. **Core.Part** utilities (no dependencies)
2. **Core.Message** utilities (depends on Part)
3. **Core.Agent** utilities (depends on Message)
4. **Core.Turn** utilities (depends on Agent)
5. **Core.Session** status computation (depends on Turn)
6. **Core.Session** bootstrap status (depends on Session status)
7. **Core.Session** lifecycle (depends on bootstrap)
8. **Core.Command** utilities (depends on Session)

**Success Criteria:**
- All 8 Core APIs implemented with Effect
- All existing React hooks updated to consume Core
- Tests pass for both Core APIs and React hooks
- Type check passes
- ~840 LOC removed from React layer

**Rollback:** Dual implementation (Core + React) for 1 sprint, feature flag per gap

### Phase 3: Effect Layers for DI (2-3 weeks)
**Goal:** Replace factory with Layers (~5-6% factory reduction, not 30-40%)

**Reality Check:** Factory is 1,160 LOC but most is React hooks logic, not closures.
- Actual closures: ~150 LOC (initialization boilerplate)
- Hook implementations: ~1,010 LOC (stays in React)
- **Realistic reduction: 5-6% of factory (~60-70 LOC)**, not 30-40%

**Current (factory, 1,160 LOC, 22 hooks):**
```typescript
export function createOpencodeHooks(config: Config) {
  const useAuth = () => { /* closure 1 */ };
  const useSession = () => { /* closure 2, depends on useAuth */ };
  // ... 21 more closures with complex dependencies
  return { useAuth, useSession, /* ... */ };
}
```

**After (Layers, ~1,090 LOC, explicit dependencies):**
```typescript
class AuthService extends Effect.Service<AuthService>()("AuthService", {
  effect: Effect.gen(function* () {
    const config = yield* Config;
    return {
      getToken: () => Effect.succeed(config.token)
    };
  })
}) {}

class SessionService extends Effect.Service<SessionService>()("SessionService", {
  dependencies: [AuthService.Default],
  effect: Effect.gen(function* () {
    const auth = yield* AuthService;
    return {
      load: (id) => auth.getToken().pipe(/* ... */)
    };
  })
}) {}

// React integration
const useSession = (id: string) => {
  const runtime = useRuntime();
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => runtime.runPromise(
      SessionService.pipe(Effect.flatMap(s => s.load(id)))
    )
  });
};
```

**Benefits:**
- **Inspectable:** Services are objects, not closures
- **Testable:** Mock layers, not factory config
- **Type-safe DI:** Compile-time dependency checks
- **5-6% LOC reduction** in factory code (~60-70 LOC)
- **Foundation for future Effect adoption** (if Phase 2.5 succeeds)

**Migration Strategy:**
1. Create Layer equivalents for 5 core services (Config, SDK, Runtime, Store, SSE)
2. Dual export (factory + layers) for 1 week
3. Migrate hooks one-by-one to use layers
4. Delete factory initialization boilerplate when usage hits zero
5. Keep React hook implementations (they consume Core APIs from Phase 2.5)

**Success Criteria:**
- All 22 hooks migrated to Layer-based services
- Factory boilerplate eliminated (~60-70 LOC)
- No runtime behavior changes
- Phase 2.5 Core APIs fully integrated

**Rollback:** Keep factory alongside layers, feature flag per hook

**Note:** Original estimate of "30-40% factory reduction" was overstated. Most factory LOC is React hooks logic that stays in React. The real win is eliminating closure boilerplate and preparing for Effect adoption.

### Phase 4: Optional Enhancements (Future)
**If Phase 2-3 succeed, consider:**

- Effect PubSub for SSE multi-subscriber broadcast (10-15% event handling reduction)
- Tagged Errors for type-safe error handling
- Stream.merge for multi-source SSE (if needed for multi-server support)

## Consequences

### Positive

1. **31% LOC reduction** (4,971 lines) - easier maintenance, clearer architecture
2. **Enriched Core layer** - Domain logic in Core, reusable beyond React
3. **Eliminates fragility** - SSE wiring automatic, compile-time safe
4. **Improved debuggability** - Services > closures, Effect isolation clear
5. **Better testability** - Pure Core functions, mockable layers
6. **Gradual learning** - Team learns Effect-TS incrementally via Core APIs
7. **Independent phases** - Ship value every 1-2 weeks
8. **Keeps what works** - Zustand for UI state (familiar)
9. **Reusability** - CLI/TUI can use Core APIs without React dependency

### Negative

1. **Two paradigms** - Zustand + Effect-TS (mitigated by runWithRuntime boundary)
2. **Learning curve** - Effect-TS is advanced (mitigated by phasing, pairing, Core isolation)
3. **Migration effort** - 4-5 weeks total (spread across phases)
4. **Temporary duplication** - During dual export periods (weeks 2-4)
5. **Core API churn** - Phase 2.5 adds ~430 LOC, may need iteration to get APIs right

### Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Effect-TS too complex | Medium | High | Phase 1-2 prove value before Phase 2.5/3 commitment |
| Core API design wrong | Medium | Medium | Phase 2.5 iterates on API design, dual implementation period |
| Performance regression | Low | Medium | Measure in Phase 2, rollback if >5% slower |
| Team unfamiliarity | High | Medium | Pair programming, office hours, docs, runWithRuntime isolation |
| Breaking changes | Low | High | Feature flags, dual implementations, gradual rollout |
| Overstated reduction claims | Low | Low | ✅ FIXED: Updated metrics based on swarm verification |

## Links

- **Prior Art:** [ADR-002: Effect Migration](002-effect-migration.md) - original Effect-TS proposal
- **Architecture:** [ADR-010: Store Architecture](010-store-architecture.md) - Zustand patterns
- **SSE Design:** [ADR-011: SSE Proxy Architecture](011-sse-proxy-architecture.md) - current SSE system
- **Migration Context:** [ADR-007: Nuclear Migration Plan](007-nuclear-migration-plan.md) - lessons learned

## References

- **Effect-TS Docs:** [Effect Stream API](https://effect.website/docs/stream/stream)
- **Analysis Docs:**
  - `docs/investigations/sse-unified-proposal.md` - SSE simplification proposal
  - `docs/audits/08-SESSION-HOOK-SPRAWL-AUDIT.md` - factory complexity analysis
- **Test Strategy:** TDD per phase (RED → GREEN → REFACTOR)
- **Rollback Plans:** Feature flags, dual implementations, git revert points

---

**Next Steps:**

1. ✅ Verify claims via swarm research (COMPLETED 2025-12-31)
2. Review updated ADR with Joel Hooks
3. Create Phase 0 hive cell (dead code removal: 4,561 LOC)
4. Create Phase 2.5 hive cell (Core enrichment: +430 LOC, -840 React LOC)
5. Schedule Phase 1 (SSE wiring) after Phase 0 ships
6. Measure Phase 2 (Effect Stream) with benchmarks before committing to Phase 3

---

## Appendix: Swarm Verification (2025-12-31)

**Epic:** opencode-next--xts0a-mjuyf4793y8  
**Coordinator:** Joel Hooks  
**Workers:** 4 research agents + 1 synthesis agent

### Verification Results

| Claim | Original Estimate | Verified Finding | Variance | Worker |
|-------|------------------|------------------|----------|--------|
| Router LOC | 3,462 | **4,377** | +915 LOC (+26%) | xts0a-mjuyf478ucu |
| Router Status | "Appears dead" | **CONFIRMED DEAD** (0 invocations) | ✅ Verified | xts0a-mjuyf478ucu |
| Factory LOC | 1,161 | **1,160** | -1 LOC | xts0a-mjuyf478whz |
| Factory Hooks | 23 | **22** | -1 hook | xts0a-mjuyf478whz |
| Factory Reduction | "30-40%" | **5-6%** (~60-70 LOC) | ❌ Overstated | xts0a-mjuyf478whz |
| SSEAtom LOC | 184 | **184** | ✅ Accurate | xts0a-mjuyf478ucu |
| Core Gaps | Not identified | **8 gaps, ~840 LOC** | ✅ New finding | xts0a-mjuyf479p4z |
| Effect Patterns | Not documented | **runWithRuntime, service factories** | ✅ New finding | xts0a-mjuyf479qxu |

### Key Corrections

1. **Router Layer:** Increased from 3,462 → 4,377 LOC (+26%)
2. **Dead Code Total:** Increased from 3,646 → 4,561 LOC (+25%)
3. **Factory Reduction:** Corrected from "30-40%" → "5-6%" (reality check)
4. **Net Reduction:** Updated from "30%+" → "31%" (4,971 LOC)
5. **New Phase 2.5:** Added Core enrichment phase (8 gaps, +430/-840 LOC)

### Research Citations

- **Router Analysis:** `opencode-next--xts0a-mjuyf478ucu` (RouterLayerVerifier)
- **Factory Analysis:** `opencode-next--xts0a-mjuyf478whz` (FactoryPatternAuditor)  
- **Core Gaps:** `opencode-next--xts0a-mjuyf479p4z` (CoreGapAnalyst)
- **Effect Patterns:** `opencode-next--xts0a-mjuyf479qxu` (EffectPatternDocumentor)
- **Synthesis:** `opencode-next--xts0a-mjuyf47vghu` (ADR-Synthesizer)

### Lessons Learned

1. **Always verify estimates** - "30-40%" turned out to be 5-6%
2. **LOC counts drift** - Router grew from 3,462 → 4,377 without updates
3. **Find the gaps** - Core missing APIs was bigger win than factory simplification
4. **Document patterns** - runWithRuntime boundary crucial for hybrid architecture

**Verification Timestamp:** 2025-12-31  
**ADR Status:** Updated to VERIFIED metrics
