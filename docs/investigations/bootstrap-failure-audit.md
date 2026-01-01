# Bootstrap Failure Scenarios Audit

**Agent**: Worker Agent (Bootstrap Audit)  
**Cell**: opencode-next--xts0a-mjut8nfspbk  
**Epic**: opencode-next--xts0a-mjut8nf7hir  
**Date**: 2025-12-31  
**Status**: ✅ COMPLETE (Read-only investigation)

---

## Executive Summary

Phase 3 of the SSE Unified Proposal proposes **removing message.model.limits as a fallback** and making store.modelLimits the **ONLY source** for model limit data. This audit examines what happens when bootstrap fails and whether the proposed change would break graceful degradation.

**TL;DR**: Current implementation has **solid graceful degradation**, but Phase 3 **breaks it** without additional safeguards. The removal of message.model.limits fallback means context usage becomes **all-or-nothing** - if bootstrap fails, context usage is **permanently unavailable** for that session.

---

## Current Bootstrap Flow (What Exists Today)

### 1. Bootstrap Sequence

Located in `packages/react/src/providers/opencode-provider.tsx` (lines 98-184):

```typescript
const bootstrap = useCallback(async () => {
  // PHASE 1: Load sessions (critical)
  try {
    const sessionsResponse = await client.session.list()
    store.setSessions(directory, sessions)
    store.setSessionReady(directory, true)
  } catch (error) {
    console.warn("[OpenCode] Failed to load sessions:", error)
    store.setSessionReady(directory, true) // ✅ STILL MARKS READY
  }

  // PHASE 2: Load session statuses (non-critical)
  try {
    const statusResponse = await client.session.status()
    // Process statuses...
  } catch (error) {
    console.warn("[OpenCode] Failed to load statuses:", error)
    // ✅ SILENT FAILURE - SSE will update statuses
  }

  // PHASE 3: Load model limits (non-critical)
  try {
    const providerResponse = await client.provider.list()
    const modelLimits = extractLimits(providerResponse)
    if (Object.keys(modelLimits).length > 0) {
      store.setModelLimits(directory, modelLimits)
    }
  } catch (error) {
    console.warn("[OpenCode] Failed to load providers:", error)
    // ⚠️ SILENT FAILURE - context usage unavailable
  }
}, [directory, getClient])
```

**Key Observations**:

- **Three-phase fetch** with independent try/catch blocks
- **Sessions phase** marks ready even on failure → app doesn't hang
- **Statuses phase** fails silently → SSE provides updates later
- **Model limits phase** fails silently → context usage unavailable

### 2. Fallback Strategy (Current)

Located in `packages/react/src/store/store.ts` (lines 337-380):

```typescript
if (message.tokens) {
  let limits: { context: number; output: number } | undefined

  // FIRST TRY: message.model.limits (if backend sends it)
  if (message.model?.limits) {
    limits = message.model.limits
    // Cache for future use
    dir.modelLimits[message.model.name] = limits
  }
  // SECOND TRY: cached limits by modelID
  else {
    const modelID = message.modelID as string | undefined
    if (modelID && dir.modelLimits[modelID]) {
      limits = dir.modelLimits[modelID]
    }
  }

  // Calculate context usage if we have limits
  if (limits) {
    dir.contextUsage[sessionID] = {
      used: tokens.input + (tokens.cache?.read || 0) + tokens.output,
      limit: limits.context,
      percentage: Math.round((used / usableContext) * 100),
      isNearLimit: percentage >= 80,
      // ...
    }
  }
  // ⚠️ IF NO LIMITS: contextUsage[sessionID] not set
}
```

**Current Fallback Chain**:

1. **message.model.limits** (if backend includes it in message)
2. **dir.modelLimits[modelID]** (from bootstrap cache)
3. **undefined** (context usage unavailable)

**Reality Check**: The fallback to `message.model.limits` provides resilience IF the backend includes limits in messages. Without this, bootstrap failure = no context usage.

---

## Error Handling Analysis

### What Happens When Bootstrap Fails?

| Failure Scenario | Current Behavior | Impact |
|------------------|------------------|--------|
| **Sessions API fails** | Logs warning, marks ready=true, shows empty session list | ✅ App remains usable, SSE will populate sessions |
| **Statuses API fails** | Logs warning, continues | ✅ SSE provides status updates |
| **Providers API fails** | Logs warning, continues | ⚠️ Context usage unavailable (unless message includes limits) |
| **Network timeout** | All three fail independently | ✅ App still loads, partial data shown |
| **Server not running** | All three fail independently | ✅ App shows "no servers discovered" |
| **CORS error** | All three fail independently | ✅ Same as network timeout |

### Retry Mechanisms

**NONE for bootstrap.** Key findings:

1. **Bootstrap runs once** on mount (via `bootstrapCalledRef.current` check)
2. **No retry logic** in OpencodeProvider
3. **SSE provides eventual consistency** - status/message updates arrive via events
4. **Re-bootstrap on disposal** - `global.disposed` event triggers re-bootstrap (line 260)

```typescript
if ((payload?.type as string) === "global.disposed") {
  bootstrapRef.current() // ✅ Re-run bootstrap when backend restarts
}
```

**Retry exists for**:
- SSE reconnection (exponential backoff in MultiServerSSE)
- NOT for bootstrap API calls

### User Experience When Limits Missing

**Current UX** (with message.model.limits fallback):

- Context usage shows IF message includes limits
- Context usage missing IF message doesn't include limits AND bootstrap failed
- **No user-facing error** - feature is just absent

**Proposed UX** (Phase 3, no fallback):

- Context usage shows IF bootstrap succeeded
- Context usage missing IF bootstrap failed
- **No user-facing error** - feature is just absent
- **No recovery path** - once bootstrap fails, context usage unavailable forever (until page reload)

---

## Phase 3 Risk Assessment

### Proposal: Remove message.model.limits Fallback

From `docs/investigations/sse-unified-proposal.md` (lines 680-698):

```typescript
// PROPOSED CHANGE (Phase 3)
handleMessageCreated(directory, payload) {
  if (message.tokens) {
    // Only use cached limits (populated by bootstrap)
    const modelID = message.modelID as string | undefined
    const limits = modelID ? dir.modelLimits[modelID] : undefined
    
    if (limits) {
      // Calculate context usage...
    }
    // ❌ NO FALLBACK - if limits missing, no context usage
  }
}
```

### What Would Break

| Scenario | Before (Current) | After (Phase 3) | Impact |
|----------|------------------|-----------------|--------|
| Bootstrap succeeds | ✅ Context usage works | ✅ Context usage works | No change |
| Bootstrap fails, message includes limits | ✅ Context usage works (fallback) | ❌ Context usage unavailable | **REGRESSION** |
| Bootstrap fails, message excludes limits | ❌ Context usage unavailable | ❌ Context usage unavailable | No change |
| Bootstrap succeeds, then backend restarts | ✅ Re-bootstrap on disposal event | ✅ Re-bootstrap on disposal event | No change |
| Slow network, bootstrap timeout | ⚠️ Context usage delayed but eventually available | ❌ Context usage unavailable | **REGRESSION** |

### Breaking the Fallback

**Current resilience pattern**:

```
Bootstrap fails → message.model.limits provides limits → context usage calculated
```

**Phase 3 breaks this**:

```
Bootstrap fails → no limits in store → context usage unavailable (no recovery)
```

**Why this matters**:

1. **Development environments** - backend not always running
2. **Mobile networks** - bootstrap timeout on slow connections
3. **Transient failures** - 500 errors, rate limits, etc.
4. **Edge cases** - CORS failures, proxy issues

---

## Graceful Degradation Analysis

### Current Degradation (Good)

| Feature | Bootstrap Required? | Fallback Strategy |
|---------|---------------------|-------------------|
| Session list | Yes | Empty list + SSE populates |
| Session status | No | SSE provides updates |
| Messages | No | Loaded on sync(), not bootstrap |
| Context usage | **Partially** | message.model.limits fallback |
| Todos | No | Loaded on sync() |
| Diffs | No | Loaded on sync() |

**Key insight**: Only session list requires bootstrap. Everything else works via SSE or lazy loading.

### Phase 3 Degradation (Worse)

| Feature | Bootstrap Required? | Fallback Strategy |
|---------|---------------------|-------------------|
| Session list | Yes | Empty list + SSE populates |
| Session status | No | SSE provides updates |
| Messages | No | Loaded on sync(), not bootstrap |
| Context usage | **Yes (new)** | ❌ None - unavailable if bootstrap fails |
| Todos | No | Loaded on sync() |
| Diffs | No | Loaded on sync() |

**Regression**: Context usage becomes **bootstrap-dependent** with no recovery path.

---

## Missing Error Recovery Mechanisms

### What's Missing Today

1. **No retry for bootstrap** - runs once, no exponential backoff
2. **No error boundaries** - React has no ErrorBoundary in packages/react
3. **No user-facing errors** - silent console.warn, user doesn't know bootstrap failed
4. **No "retry bootstrap" UI** - can't manually trigger re-fetch
5. **No health checks** - can't detect "bootstrap succeeded but limits missing"

### What SSE Provides (Partial Recovery)

✅ **Session updates** - SSE sends `session.created`, `session.updated` events  
✅ **Status updates** - SSE sends `session.status` events  
✅ **Message streaming** - SSE sends `message.updated`, `message.part.updated` events  
❌ **Model limits** - SSE does NOT send provider/model updates (no event type exists)

**Gap**: Model limits are bootstrap-only, no SSE fallback exists.

---

## Recommendations

### Option 1: Add Bootstrap Retry (Medium Effort, High Impact)

**Preserve Phase 3 change, but add retry logic**:

```typescript
const bootstrap = useCallback(async () => {
  const maxRetries = 3
  const retryDelay = [1000, 2000, 4000] // Exponential backoff
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Fetch sessions...
      // Fetch statuses...
      
      // CRITICAL: Fetch model limits with retry
      const providerResponse = await client.provider.list()
      const modelLimits = extractLimits(providerResponse)
      if (Object.keys(modelLimits).length > 0) {
        store.setModelLimits(directory, modelLimits)
        return // ✅ Success, exit retry loop
      }
    } catch (error) {
      console.warn(`[OpenCode] Bootstrap attempt ${attempt + 1} failed:`, error)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay[attempt]))
      }
    }
  }
  
  // ❌ All retries failed - context usage unavailable
  console.error("[OpenCode] Bootstrap failed after 3 retries")
}, [directory, getClient])
```

**Pros**: Reduces bootstrap failure rate, preserves Phase 3 simplification  
**Cons**: Adds complexity, doesn't eliminate all failures (network timeouts)  
**Risk**: Medium - retry logic is well-understood pattern

### Option 2: Keep message.model.limits Fallback (Low Effort, Medium Impact)

**Abandon Phase 3 proposal for model limits**:

```typescript
// KEEP CURRENT BEHAVIOR
if (message.tokens) {
  let limits: { context: number; output: number } | undefined
  
  // FIRST TRY: message.model.limits (if backend sends it)
  if (message.model?.limits) {
    limits = message.model.limits
    // Cache for future use
    dir.modelLimits[message.model.name] = limits
  }
  // SECOND TRY: cached limits
  else {
    const modelID = message.modelID as string | undefined
    if (modelID && dir.modelLimits[modelID]) {
      limits = dir.modelLimits[modelID]
    }
  }
  
  if (limits) {
    // Calculate context usage...
  }
}
```

**Pros**: Zero regression, maintains current resilience  
**Cons**: Keeps "dual source of truth" that Phase 3 aimed to eliminate  
**Risk**: Low - no changes needed

### Option 3: Add SSE Event for Model Limits (High Effort, High Impact)

**Add new SSE event type** for provider updates:

Backend sends:
```typescript
{
  type: "provider.limits.updated",
  properties: {
    modelID: "claude-opus-4-5",
    limits: { context: 200000, output: 4096 }
  }
}
```

Store handles it:
```typescript
case "provider.limits.updated": {
  const { modelID, limits } = event.properties
  dir.modelLimits[modelID] = limits
  break
}
```

**Pros**: Eliminates bootstrap dependency, enables real-time limit updates  
**Cons**: Requires backend changes, out of scope for Phase 3  
**Risk**: High - cross-package changes, testing complexity

### Option 4: Default Fallback Limits (Low Effort, Low Impact)

**Use sane defaults when limits missing**:

```typescript
if (message.tokens) {
  const modelID = message.modelID as string | undefined
  let limits = modelID ? dir.modelLimits[modelID] : undefined
  
  // ✅ FALLBACK: Use conservative defaults
  if (!limits) {
    limits = {
      context: 128000,  // Conservative default (most models support this)
      output: 4096,     // Standard output limit
    }
    console.warn(`[OpenCode] Using default limits for ${modelID ?? 'unknown model'}`)
  }
  
  if (limits) {
    // Calculate context usage...
  }
}
```

**Pros**: Context usage always available, graceful degradation  
**Cons**: Inaccurate estimates (could show 50% when actually at 80%)  
**Risk**: Medium - incorrect limits could mislead users

---

## Findings Summary

### Current State (Before Phase 3)

✅ **Bootstrap has graceful degradation** - app remains usable even if all fetches fail  
✅ **Model limits have fallback** - message.model.limits provides resilience  
❌ **No retry mechanism** - bootstrap runs once, no recovery  
❌ **No user-facing errors** - silent failures, users don't know what's missing  
❌ **No error boundaries** - React errors propagate to default handler

### Phase 3 Impact

🔥 **Breaking graceful degradation** - removes message.model.limits fallback  
🔥 **Context usage becomes all-or-nothing** - works if bootstrap succeeds, unavailable forever if it fails  
❌ **No additional safeguards proposed** - Phase 3 assumes bootstrap never fails  
⚠️ **Realistic failure scenarios** - dev environments, mobile networks, transient errors

### Recommended Action

**DO NOT proceed with Phase 3 (model limits centralization) without additional safeguards.**

**Minimum requirements for Phase 3**:
1. Add bootstrap retry (3 attempts with exponential backoff)
2. Add default fallback limits (conservative estimates)
3. Add user-facing warning when limits unavailable
4. Consider adding SSE event for limit updates (future work)

**Alternative**: Keep current dual-source approach (Option 2) - maintains resilience with no additional work.

---

## Test Coverage Gaps

**What's NOT tested today**:

1. Bootstrap retry logic (doesn't exist)
2. Bootstrap failure UX (no test for "limits unavailable" state)
3. message.model.limits fallback (exists but untested)
4. Default limit fallback (doesn't exist)
5. Context usage calculation with missing limits (edge case)

**Recommended tests** (if implementing Option 1 + Option 4):

```typescript
describe("OpencodeProvider bootstrap", () => {
  it("retries bootstrap on failure (exponential backoff)", async () => {
    // Mock provider.list to fail 2x, succeed on 3rd attempt
    // Verify retry delays: 1s, 2s
    // Verify model limits set after 3rd attempt
  })

  it("uses default limits when bootstrap fails", async () => {
    // Mock provider.list to fail all attempts
    // Trigger message with tokens
    // Verify contextUsage calculated with default limits
    // Verify warning logged
  })

  it("caches limits from message.model.limits (current behavior)", async () => {
    // Bootstrap fails
    // Message arrives with message.model.limits
    // Verify limits cached in store
    // Verify next message uses cached limits
  })
})
```

---

## Files Analyzed

**Primary source files**:
- `packages/react/src/providers/opencode-provider.tsx` - Bootstrap logic (lines 98-184)
- `packages/react/src/store/store.ts` - Model limits storage and fallback (lines 337-380)
- `packages/react/src/store/types.ts` - DirectoryState type (line 137)
- `docs/investigations/sse-unified-proposal.md` - Phase 3 proposal (lines 675-730)

**Related files checked**:
- `packages/react/src/hooks/use-providers.test.ts` - Provider API tests (no bootstrap tests)
- No error boundaries found in packages/react
- No retry logic found in OpencodeProvider

---

## Conclusion

**Phase 3's proposal to centralize model limits in the store is architecturally sound**, but **breaks existing graceful degradation** by removing the message.model.limits fallback. Without additional safeguards (retry, defaults, or SSE events), bootstrap failure becomes a **permanent loss of context usage** for that session.

**Recommendation**: Either:
1. Implement Option 1 (retry) + Option 4 (defaults) alongside Phase 3
2. Abandon Phase 3's model limits change (Option 2) and preserve current resilience

**Phase 3 should NOT proceed** as-is without addressing bootstrap failure scenarios.

---

## Next Steps

For coordinator:
1. Review these findings
2. Decide Phase 3 path (add safeguards vs abandon limits change)
3. If proceeding with safeguards, file cells for:
   - Bootstrap retry logic
   - Default limit fallback
   - User-facing warning UI
   - Test coverage for failure scenarios
4. Update SSE Unified Proposal with revised Phase 3 plan

End of audit.
