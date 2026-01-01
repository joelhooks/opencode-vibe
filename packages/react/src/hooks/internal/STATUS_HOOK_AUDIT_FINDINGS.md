# Status Hook Duplication Audit - Findings Report

**Date:** 2025-12-31  
**Cell:** opencode-next--xts0a-mjut8nfmfz8  
**Epic:** opencode-next--xts0a-mjut8nf7hir  
**Auditor:** Swarm Worker Agent  

---

## Executive Summary

Verified claims from `docs/investigations/sse-unified-proposal.md` regarding status hook duplication. All three claims are **PARTIALLY VERIFIED** with important nuances.

---

## Claim 1: internal/use-session-status.ts is DEAD CODE

**Status:** ❌ **REFUTED**

### Evidence

The internal hook is **actively used** by:

1. **Re-exported** in 2 public index files:
   - `packages/react/src/hooks/index.ts:53` (internal hooks section)
   - `packages/react/src/index.ts:87` (package public API)

2. **Imported directly** in 3 hook implementations:
   - `use-session-facade.ts:54` - Facade pattern wraps it
   - `use-send-message.ts:6` - Queue management depends on it
   - `use-send-message.test.ts:36` - Test mocks it

3. **Usage count:** Found in 14 TypeScript files across the monorepo

### Import Patterns

```typescript
// Direct imports (provider-based pattern)
import { useSessionStatus } from "./internal/use-session-status"

// Web app imports (factory pattern)
import { useSessionStatus } from "@/app/hooks" 
// → comes from generateOpencodeHelpers() factory
```

### Verdict

**NOT dead code.** The internal hook is the **implementation source** for the facade pattern and provider-based hooks. However, the web app exclusively uses the factory version.

---

## Claim 2: factory.ts useSessionStatus is the CANONICAL version

**Status:** ✅ **VERIFIED** (for web app usage)

### Evidence

1. **Web app exclusively uses factory version:**
   - `apps/web/src/app/hooks.ts` imports from `generateOpencodeHelpers()`
   - All 3 web components import from `@/app/hooks`:
     - `session-status.tsx:15`
     - `session-layout.tsx:8`
     - `session-messages.tsx:5`

2. **Factory implements enhanced logic:**
   ```typescript
   // Lines 728-761 in factory.ts
   function useSessionStatus(sessionId: string): SessionStatus {
     // 1. Check main session status
     const mainStatus = dir.sessionStatus[sessionId] ?? "completed"
     if (mainStatus === "running") return "running"
     
     // 2. Check for running sub-agents (task parts)
     for (const message of messages) {
       for (const part of parts) {
         if (part.type === "tool" && part.tool === "task" && part.state.status === "running") {
           return "running"
         }
       }
     }
     
     return mainStatus
   }
   ```

3. **Internal version is simpler:**
   ```typescript
   // Lines 29-34 in internal/use-session-status.ts
   export function useSessionStatus(sessionId: string): SessionStatus {
     const { directory } = useOpencode()
     return useOpencodeStore(
       (state) => state.directories[directory]?.sessionStatus[sessionId] ?? "completed"
     )
   }
   ```

### Key Differences

| Aspect | Internal Version | Factory Version |
|--------|-----------------|-----------------|
| **Scope** | Main session status only | Main session + sub-agents |
| **Pattern** | Provider-based (`useOpencode()`) | Config-based (`getOpencodeConfig()`) |
| **Sub-agent support** | ❌ No | ✅ Yes - checks task parts |
| **Optimization** | Direct store selector | `useCallback` memoization |
| **Lines of code** | 6 lines | 34 lines |

### Verdict

**VERIFIED for production usage.** The factory version is canonical for the web app (ADR-013 Phase 2 provider-free architecture). The internal version remains for backward compatibility and facade pattern.

---

## Claim 3: useMultiDirectoryStatus has SEPARATE status derivation logic

**Status:** ✅ **VERIFIED**

### Evidence

Found **third status derivation approach** in `use-multi-directory-status.ts:38-52`:

```typescript
/**
 * Derive session status from the last message
 * A session is "busy" if the last message is an assistant message without a completed time
 */
function deriveSessionStatus(
  messages: Array<{
    info: { role: string; time?: { created: number; completed?: number } }
  }>
): "running" | "completed" {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return "completed"
  
  // Session is busy if last message is assistant without completed time
  if (lastMessage.info.role === "assistant" && !lastMessage.info.time?.completed) {
    return "running"
  }
  
  return "completed"
}
```

### Three Distinct Approaches

| Hook | Status Source | Logic |
|------|---------------|-------|
| **Internal** | `store.sessionStatus[id]` | Store selector only |
| **Factory** | `store.sessionStatus[id]` + sub-agents | Checks main + task parts |
| **MultiDirectory** | Last message metadata | Bootstrap: checks `message.time.completed`<br>SSE: uses `store.sessionStatus[id]` |

### Usage Pattern

`useMultiDirectoryStatus` uses **two-phase approach**:

1. **Bootstrap phase** (on mount):
   - Fetches recent sessions via API
   - Calls `deriveSessionStatus()` to check last message
   - Sets initial status if session is running

2. **SSE subscription phase** (after mount):
   - Subscribes to `store.directories[dir].sessionStatus`
   - Uses store values (fed by SSE events)
   - Adds 60-second cooldown timer on idle transitions

### Verdict

**VERIFIED.** Separate logic exists for bootstrap/initial status derivation. However, after bootstrap, it relies on the same `store.sessionStatus` as the other hooks.

---

## Summary Table

| Claim | Status | Evidence |
|-------|--------|----------|
| 1. Internal hook is dead code | ❌ REFUTED | Used by 3 hooks, re-exported in 2 indexes, 14 files reference it |
| 2. Factory version is canonical | ✅ VERIFIED | Web app uses exclusively, enhanced sub-agent logic |
| 3. MultiDirectory has separate logic | ✅ VERIFIED | Bootstrap phase uses message metadata, SSE phase uses store |

---

## Architectural Observations

### Duplication Type: **Intentional Layering** (Not Accidental)

1. **Internal hook** = Base implementation (provider-based, backward compatible)
2. **Factory hook** = Enhanced version (provider-free, sub-agent aware)
3. **MultiDirectory hook** = Bootstrap helper (API-based initial state + SSE sync)

### Migration State

The codebase is mid-migration:
- **Old pattern:** Provider-based hooks (`useOpencode()` → internal hooks)
- **New pattern:** Factory-based hooks (`generateOpencodeHelpers()` → factory hooks)
- **Web app:** Fully migrated to factory pattern (ADR-013 Phase 2)
- **Package exports:** Still expose both for backward compatibility

### Recommendation

The "duplication" is **intentional and correct** given the migration strategy. However:

1. **Mark internal exports as deprecated** with JSDoc tags:
   ```typescript
   /**
    * @deprecated Use factory version from generateOpencodeHelpers() instead
    * @internal
    */
   export { useSessionStatus } from "./internal/use-session-status"
   ```

2. **Document the layering** in a comment block showing:
   - Internal = base implementation
   - Factory = enhanced + provider-free
   - MultiDirectory = bootstrap helper

3. **Do NOT delete** internal version yet - still used by facade and send-message hooks.

---

## Files Audited

- ✅ `packages/react/src/hooks/internal/use-session-status.ts` (35 lines)
- ✅ `packages/react/src/factory.ts` (1167 lines, lines 728-761 relevant)
- ✅ `packages/react/src/hooks/use-multi-directory-status.ts` (222 lines)
- ✅ `packages/react/src/hooks/index.ts` (87 lines)
- ✅ `packages/react/src/index.ts` (129 lines)
- ✅ `apps/web/src/app/hooks.ts` (40 lines)

**Total grep matches:** 46 occurrences across 14 files

---

## Conclusion

**Claims 2 and 3 verified. Claim 1 refuted.**

The hooks are NOT duplicated accidentally - they represent three intentional layers:
1. **Base** (internal, provider-based)
2. **Enhanced** (factory, sub-agent aware)
3. **Bootstrap** (multi-directory, API + SSE hybrid)

The codebase is in a healthy migration state from provider-based to factory-based architecture.
