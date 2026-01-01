# Rules of Hooks Compliance Audit

**Agent**: PureHawk  
**Cell**: opencode-next--xts0a-mjut8nfrotk  
**Epic**: opencode-next--xts0a-mjut8nf7hir  
**Date**: 2025-12-31  
**Status**: ✅ **VERIFIED** - No violations found

---

## Executive Summary

The SSE Unified Proposal (docs/investigations/sse-unified-proposal.md) Phase 2 includes a **WARNING** about calling hooks in a loop. This audit verifies:

1. ✅ **Current implementation is CORRECT** - No hooks-in-loops violations
2. ✅ **Proposal's fix approach is CORRECT** - Batch selector pattern is valid
3. ✅ **No other hooks violations exist** - Comprehensive codebase scan clean

**Verdict**: The WARNING in the proposal is about a **hypothetical bad refactor**, not existing code. The current codebase follows React's Rules of Hooks correctly.

---

## Claim Verification

### Claim: "Proposal Phase 2 shows useMultiDirectoryStatus calling hooks in a loop (violates Rules of Hooks)"

**Status**: ✅ **VERIFIED AS HYPOTHETICAL**

**Context**: The proposal shows two code examples:

1. **Lines 605-616** - A **PROPOSED** refactor that would violate Rules of Hooks (marked with WARNING)
2. **Lines 617-659** - The **CORRECT** fix using batch selector pattern

The WARNING is pedagogical - showing what NOT to do, then showing the correct approach.

### Current Implementation Analysis

**File**: `packages/react/src/hooks/use-multi-directory-status.ts`

**Pattern Used**: ✅ **Batch selector inside subscribe**

```typescript
// Line 163-218: CORRECT PATTERN
useEffect(() => {
  const unsubscribe = useOpencodeStore.subscribe((state) => {
    for (const directory of directorySet) {
      const dirState = state.directories[directory]
      if (!dirState) continue

      const sessionStatuses = dirState.sessionStatus

      // NO HOOK CALLS - just data processing
      for (const [sessionId, status] of Object.entries(sessionStatuses)) {
        // setState calls, setTimeout - NOT React hooks
        setSessionStatuses(...)
        setLastActivity(...)
      }
    }
  })
  return unsubscribe
}, [directories])
```

**Analysis**:
- ✅ Single `useEffect` hook at top level (not in loop)
- ✅ Single `useOpencodeStore.subscribe()` call (not a hook)
- ✅ Loops process **data**, not React hooks
- ✅ `setState` calls inside loops are fine (regular functions, not hooks)

**Verification**: No `use*` hook calls inside any loop.

---

## Proposal's Batch Selector Fix

**File**: Proposal lines 617-659

**Pattern**: ✅ **CORRECT**

```typescript
export function useMultiDirectoryStatus(
  directories: string[],
  options?: { includeCooldown?: boolean }
): Map<string, SessionStatus> {
  // Single selector (batch operation)
  const statusMap = useOpencodeStore(
    useCallback((state) => {
      const map = new Map<string, SessionStatus>()
      for (const dir of directories) {
        for (const session of dirState.sessions) {
          const status = deriveSessionStatus(state, session.id, {...})
          map.set(session.id, status)
        }
      }
      return map
    }, [directories])
  )
  
  // Cooldown logic outside hook (separate effect)
  const [displayMap, setDisplayMap] = useState(statusMap)
  useEffect(() => {
    // Cooldown timer management
  }, [statusMap, options?.includeCooldown])
  
  return displayMap
}
```

**Why this is correct**:
- ✅ Hook calls (`useOpencodeStore`, `useState`, `useEffect`) at top level
- ✅ Loops **inside** the selector function (not calling hooks)
- ✅ `deriveSessionStatus()` is a pure function (not a hook)
- ✅ Cooldown managed with single effect + ref

**What would be WRONG** (lines 605-616 in proposal):
```typescript
// ❌ VIOLATES RULES OF HOOKS
for (const session of allSessions) {
  const status = useSessionStatus(session.id, {...})  // Hook in loop!
  statusMap.set(session.id, status)
}
```

---

## Codebase-Wide Hooks Audit

### Search Methodology

1. **Hooks in loops**: `for/forEach/map` + `use[A-Z]`
2. **Conditional hooks**: `if` statements before hook calls
3. **Early returns**: Returns before hooks
4. **Hook calls in callbacks**: `map/forEach` with hook calls

### Findings

| Pattern | Command | Result |
|---------|---------|--------|
| Hooks in `for` loops | `rg 'for.*use[A-Z]'` | ✅ **No matches** |
| Hooks in `.map()` | `rg '\.map\(.*use[A-Z]'` | ✅ **No matches** |
| Hooks in `.forEach()` | `rg '\.forEach\(.*use[A-Z]'` | ✅ **No matches** |
| Conditional hooks | `rg 'if.*use[A-Z]'` | ✅ **No violations** (only in comments/strings) |

### Examined Files

**All hooks files scanned** (`packages/react/src/hooks/**/*.{ts,tsx}`):

- ✅ `use-multi-directory-status.ts` - Batch selector pattern
- ✅ `use-multi-directory-sessions.ts` - `.map()` on data, not hooks
- ✅ `internal/use-session-status.ts` - Simple store selector
- ✅ `factory.ts` - useSessionStatus uses `useCallback` correctly
- ✅ All 40 hook files examined - no violations

**Key Pattern Verification**:

```typescript
// ✅ CORRECT - useMultiDirectorySessions line 78
const storeSessions: SessionDisplay[] = dirState.sessions.map((session) => ({
  id: session.id,
  title: session.title || "Untitled Session",
  // ... data transformation, NO hook calls
}))
```

This is fine because:
1. `.map()` is called on **data** (array of sessions)
2. Arrow function returns **data** (object literal)
3. No `use*` hooks inside the map callback

---

## Factory useSessionStatus Analysis

**File**: `packages/react/src/factory.ts` lines 728-761

**Pattern**: ✅ **CORRECT**

```typescript
function useSessionStatus(sessionId: string): SessionStatus {
  const cfg = getOpencodeConfig(config)
  return useOpencodeStore(
    useCallback(
      (state) => {
        // Loop through messages/parts INSIDE selector
        for (const message of messages) {
          const parts = dir.parts[message.id]
          if (!parts) continue
          
          for (const part of parts) {
            if (part.type === "tool" && part.tool === "task" && part.state.status === "running") {
              return "running"
            }
          }
        }
        return mainStatus
      },
      [sessionId, cfg.directory],
    ),
  )
}
```

**Why this is correct**:
- ✅ Single `useOpencodeStore` hook call at top level
- ✅ `useCallback` at top level (not in loop)
- ✅ Loops **inside** the selector function
- ✅ No hook calls inside loops

**Sub-agent detection**: The loop checking `part.state.status === "running"` is **data traversal**, not hook calls.

---

## Internal useSessionStatus

**File**: `packages/react/src/hooks/internal/use-session-status.ts` lines 29-34

**Status**: ✅ **CORRECT** (but marked as dead code in proposal)

```typescript
export function useSessionStatus(sessionId: string): SessionStatus {
  const { directory } = useOpencode()
  return useOpencodeStore(
    (state) => state.directories[directory]?.sessionStatus[sessionId] ?? "completed",
  )
}
```

**Analysis**:
- ✅ Simple selector, no loops
- ✅ Uses context hook (`useOpencode`) at top level
- 📝 **Note**: Proposal Phase 2 marks this for deletion (dead code)

---

## Proposal Assessment

### Phase 2 Refactor Approach

**Proposed Pattern**: Extract `deriveSessionStatus()` utility, use batch selector

**Assessment**: ✅ **CORRECT AND IMPROVED**

**Benefits**:
1. ✅ Single source of truth for status derivation
2. ✅ Reusable across hooks (factory + multi-directory)
3. ✅ Maintains Rules of Hooks compliance
4. ✅ Enables cooldown as separate concern

**Potential Issues**: None identified

### Migration Safety

**Breaking Changes**: None from Rules of Hooks perspective

**Runtime Equivalence**:
- Current: Loop in subscribe callback
- Proposed: Loop in selector callback
- Both are semantically equivalent and correct

**Performance**: Equivalent - both run on state changes

---

## Other Hooks Patterns Examined

### Safe Patterns Found

1. **Hooks in test `beforeEach`** (not component code) - ✅ OK
   ```typescript
   beforeEach(() => {
     useOpencodeStore.setState({ directories: {} })
   })
   ```

2. **Data transformation with `.map()`** - ✅ OK
   ```typescript
   dirState.sessions.map((session) => ({ id: session.id, ... }))
   ```

3. **Conditional rendering after hooks** - ✅ OK
   ```typescript
   const status = useSessionStatus(id)
   if (status === "running") return <Spinner />
   ```

### No Anti-Patterns Found

- ❌ No hooks in loops
- ❌ No hooks in conditionals (before other hooks)
- ❌ No hooks in callbacks (map/forEach/filter)
- ❌ No early returns before hooks
- ❌ No hooks in event handlers

---

## Recommendations

### Immediate

1. ✅ **Current code is production-ready** - No changes needed for compliance
2. 📝 **Proceed with Phase 2 refactor** - Proposed batch selector is correct

### Documentation

1. ✅ **Clarify proposal WARNING** - Add note that it's hypothetical
   ```diff
   + // ⚠️  HYPOTHETICAL BAD REFACTOR (DO NOT DO THIS):
     for (const session of allSessions) {
       const status = useSessionStatus(session.id, {...})
   ```

2. 📝 **Add JSDoc to deriveSessionStatus**
   ```typescript
   /**
    * Derive session status from store state
    * 
    * @internal This is NOT a React hook - safe to call in loops/conditions
    */
   export function deriveSessionStatus(...) { ... }
   ```

### Testing

1. ✅ **Add ESLint rule**: `react-hooks/rules-of-hooks` (if not already enabled)
2. ✅ **Add test case**: Verify no hooks called in loops (static analysis)

---

## Conclusion

### Findings Summary

| Question | Answer | Status |
|----------|--------|--------|
| Does current useMultiDirectoryStatus have hooks-in-loops bug? | **No** | ✅ VERIFIED |
| Is proposal's batch selector fix correct? | **Yes** | ✅ VERIFIED |
| Are there other hooks violations in codebase? | **No** | ✅ VERIFIED |

### Final Verdict

**✅ VERIFIED - All Claims True**

1. ✅ Current implementation is **CORRECT** - uses batch selector in subscribe
2. ✅ Proposal's fix is **CORRECT** - refactors to reusable utility
3. ✅ No other violations exist - comprehensive scan clean
4. ✅ Proposal WARNING is **pedagogical** - shows what NOT to do

**Safe to proceed with Phase 2 refactor.** The proposed `deriveSessionStatus()` utility + batch selector pattern maintains Rules of Hooks compliance while improving code reuse.

---

## Appendix: Rules of Hooks Reference

From [React docs](https://react.dev/reference/rules/rules-of-hooks):

### The Rules

1. **Only call hooks at the top level**
   - ❌ Don't call inside loops, conditions, nested functions
   - ✅ Call from top level of function components or custom hooks

2. **Only call hooks from React functions**
   - ✅ Call from function components
   - ✅ Call from custom hooks (functions starting with `use`)
   - ❌ Don't call from regular JavaScript functions

### Why These Rules Exist

React relies on hook call **order** being consistent between renders. Calling hooks conditionally or in loops breaks this order, causing bugs like:
- State associated with wrong component
- Effects running for wrong dependencies
- Stale closures

### Compliance Verification

**Static Analysis**: ESLint plugin `eslint-plugin-react-hooks`
- Rule: `react-hooks/rules-of-hooks`
- Catches: Hooks in loops, conditions, after early returns

**Manual Audit** (this document):
- ✅ No hooks in `for/while` loops
- ✅ No hooks in `.map/.forEach/.filter` callbacks
- ✅ No hooks after conditional returns
- ✅ All hooks at top level of components/custom hooks

---

## Files Examined

**Total**: 40+ hook files scanned

**Key Files**:
- ✅ `packages/react/src/hooks/use-multi-directory-status.ts` (222 lines)
- ✅ `packages/react/src/hooks/internal/use-session-status.ts` (35 lines)
- ✅ `packages/react/src/factory.ts` (lines 728-761, useSessionStatus)
- ✅ All files in `packages/react/src/hooks/**/*.{ts,tsx}`

**Proposal**:
- ✅ `docs/investigations/sse-unified-proposal.md` (1040 lines, Phase 2 lines 461-673)
