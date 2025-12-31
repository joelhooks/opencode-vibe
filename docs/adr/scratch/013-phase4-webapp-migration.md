# ADR-013 Phase 4: Web App Migration

**Date:** 2025-12-30  
**Status:** Task Specification  
**Parent:** ADR-013 Unified Same-Origin Architecture  
**Dependencies:** Phase 1 (SSE Proxy ✅), Phase 2 (API Proxy ⏳), Phase 3 (SSR Plugin ⏳)

---

## Context (50 lines max)

### What This Phase Does

Migrates `apps/web` from provider-based architecture to factory + SSR plugin pattern:

**Before (Provider Hell):**
```tsx
// app/layout.tsx
<OpenCodeProvider url="..." directory="...">
  {children}
</OpenCodeProvider>

// components/*.tsx
const { ready, sync } = useOpencode() // Context consumption
const session = useSession(id)
```

**After (Factory + SSR):**
```tsx
// app/layout.tsx
<OpencodeSSRPlugin config={{ baseUrl, directory }} />
{children}

// app/hooks.ts (single source of truth)
export const { useSession, useSendMessage } = generateOpencodeHelpers()

// components/*.tsx
import { useSession } from "@/app/hooks" // Direct import, no context
const session = useSession(id)
```

### Why This Matters

1. **Zero Ceremony** - No provider wrapper needed
2. **Zero Hydration Delay** - Config injected before React hydrates
3. **Type Safety** - Factory binds types at creation time
4. **Mobile/Tailscale Ready** - Works with same-origin proxy (Phases 1-2)

### Assumptions

- Phase 1 complete: `/api/sse/[port]` proxies SSE streams
- Phase 2 complete: `/api/opencode/[port]/[[...path]]` proxies API calls
- Phase 3 complete: `OpencodeSSRPlugin` and `generateOpencodeHelpers` exist in `@opencode-vibe/react`

---

## Files to Create/Modify

### Create

| File | Purpose |
|------|---------|
| `apps/web/src/app/hooks.ts` | Single source of truth for all OpenCode hooks |

### Modify

| File | Changes |
|------|---------|
| `apps/web/src/app/layout.tsx` | Replace `<Providers>` with direct SSR plugin injection |
| `apps/web/src/app/providers.tsx` | Remove `OpenCodeProvider`, keep ThemeProvider + Toaster |
| `packages/react/src/providers/opencode-provider.tsx` | Add deprecation warning (console.warn) |
| All component imports | Update from context hooks to factory hooks |

### Delete

None (deprecation strategy - keep old code with warnings for 1 release)

---

## Migration Steps (Exact Changes Per File)

### Step 1: Create apps/web/src/app/hooks.ts (NEW FILE)

**Purpose:** Single source of truth for all OpenCode hooks in the web app.

```typescript
/**
 * OpenCode hooks - Single source of truth
 * 
 * Generated via factory pattern - no provider wrapper needed.
 * Config injected via <OpencodeSSRPlugin> in layout.tsx.
 */

import { generateOpencodeHelpers } from "@opencode-vibe/react"

// Factory creates all hooks with type inference
// Config comes from globalThis.__OPENCODE (injected by SSR plugin)
export const {
  // Unified Facade
  useSession,
  
  // Data Fetching
  useSessionList,
  useSessionData,
  useProjects,
  useCurrentProject,
  useServers,
  useCurrentServer,
  useProviders,
  
  // Actions
  useSendMessage,
  useCreateSession,
  useCommands,
  
  // Utilities
  useFileSearch,
  
  // Internal (for advanced use)
  useSessionStatus,
  useMessages,
  useParts,
  useMessagesWithParts,
  useSubagents,
  useSubagent,
  useSubagentSync,
  useContextUsage,
  useCompactionState,
  useLiveTime,
} = generateOpencodeHelpers()
```

**Test:** None needed (re-export of factory output).

---

### Step 2: Update apps/web/src/app/layout.tsx

**Changes:**

1. Remove `<Providers>` wrapper
2. Add `<OpencodeSSRPlugin>` directly in body
3. Keep `<ThemeProvider>` and `<Toaster>` (non-OpenCode providers)

**Before:**
```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ErrorBoundary>
          <Suspense fallback={...}>
            <Providers>{children}</Providers>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  )
}
```

**After:**
```tsx
import { OpencodeSSRPlugin } from "@opencode-vibe/react/next-ssr-plugin"

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ErrorBoundary>
          <Suspense fallback={...}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
              <OpencodeSSRPlugin 
                config={{ 
                  baseUrl: "/api/opencode/4056",  // Same-origin proxy
                  directory: process.cwd()
                }} 
              />
              {children}
              <Toaster position="top-right" richColors closeButton />
            </ThemeProvider>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  )
}
```

**Rationale:**
- `ThemeProvider` not OpenCode-specific, keep it
- `Toaster` not OpenCode-specific, keep it
- `SSEProvider` replaced by factory pattern (SSE wiring internal to hooks)
- Config uses `/api/opencode/4056` (same-origin proxy from Phase 2)

---

### Step 3: Update apps/web/src/app/providers.tsx

**Changes:** Remove `OpenCodeProvider`, keep theme/toast providers.

**Before:**
```tsx
import { SSEProvider } from "@opencode-vibe/react"
import { OPENCODE_URL } from "@/lib/client"

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SSEProvider url={OPENCODE_URL}>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </SSEProvider>
    </ThemeProvider>
  )
}
```

**After:**
```tsx
/**
 * DEPRECATED: OpenCode-specific providers moved to layout.tsx
 * 
 * This file now only exists for backward compatibility.
 * Recommend importing ThemeProvider + Toaster directly in layout.tsx.
 */

import type { ReactNode } from "react"

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  console.warn(
    "[OpenCode] Providers component is deprecated. " +
    "Use <OpencodeSSRPlugin> in layout.tsx instead. " +
    "See docs/adr/013-unified-same-origin-architecture.md"
  )
  return <>{children}</>
}
```

**Rationale:**
- Deprecation strategy: keep file, add warning, return passthrough
- Prevents hard breaks for external code
- Will be removed in next major version

---

### Step 4: Deprecate packages/react/src/providers/opencode-provider.tsx

**Changes:** Add deprecation warning at top of `OpencodeProvider` function.

**Insert at line 74 (start of OpencodeProvider function):**
```typescript
export function OpencodeProvider({ url, directory, children }: OpencodeProviderProps) {
  // DEPRECATION WARNING
  useEffect(() => {
    console.warn(
      "[OpenCode] OpencodeProvider is deprecated and will be removed in v2.0.0.\n" +
      "Migrate to factory pattern:\n\n" +
      "// app/hooks.ts\n" +
      "export const { useSession } = generateOpencodeHelpers()\n\n" +
      "// app/layout.tsx\n" +
      "<OpencodeSSRPlugin config={{ baseUrl, directory }} />\n\n" +
      "See: docs/adr/013-unified-same-origin-architecture.md"
    )
  }, [])
  
  // ... rest of implementation unchanged
```

**Rationale:**
- Non-breaking change (warning only)
- Guides users to migration path
- Logs once per mount (useEffect with empty deps)

---

### Step 5: Update Component Imports

**Pattern:** Change all component imports from context-based to factory-based.

**Before:**
```tsx
import { useSession, useSendMessage } from "@opencode-vibe/react"
```

**After:**
```tsx
import { useSession, useSendMessage } from "@/app/hooks"
```

**Affected Files (~50 components):**
```
apps/web/src/components/ai-elements/*.tsx
apps/web/src/components/prompt/*.tsx
apps/web/src/app/session/[id]/*.tsx
apps/web/src/app/provider/*.tsx
```

**Find/Replace Strategy:**
1. Run: `rg "from \"@opencode-vibe/react\"" apps/web/src/components --files-with-matches`
2. For each file, replace import source
3. Verify no `useOpencode()` context calls remain

**Test:** Run `bun run typecheck` after each batch of 10 files.

---

### Step 6: Remove useOpencode() Context Calls

**Pattern:** Remove any remaining `useOpencode()` calls (if present).

**Before:**
```tsx
const { ready, sync } = useOpencode()

useEffect(() => {
  if (ready) {
    sync(sessionID)
  }
}, [ready, sessionID, sync])
```

**After:**
```tsx
const session = useSession(sessionID)

// useSession handles sync internally - no manual sync needed
```

**Search:** `rg "useOpencode\(\)" apps/web/src --files-with-matches`

**Rationale:**
- Factory pattern removes need for context consumption
- `useSession` facade handles sync internally (see `use-session-facade.ts`)

---

## Test Specifications (Exact Test Cases)

### Unit Tests (NOT NEEDED - Factory Pattern Tested in Phase 3)

The factory pattern (`generateOpencodeHelpers`) is tested in Phase 3.  
Web app just imports and uses the factory output - no new logic to test.

### Integration Tests

**Test 1: SSR Plugin Injects Config**

```tsx
// Test file: apps/web/src/app/layout.test.tsx

import { render } from "@testing-library/react"
import RootLayout from "./layout"

test("injects OpenCode config via SSR plugin", () => {
  const { container } = render(<RootLayout><div>Test</div></RootLayout>)
  
  // Check for injected script tag (from OpencodeSSRPlugin)
  const scripts = container.querySelectorAll("script")
  const configScript = Array.from(scripts).find(s => 
    s.innerHTML.includes("window.__OPENCODE")
  )
  
  expect(configScript).toBeTruthy()
  expect(configScript?.innerHTML).toContain("baseUrl")
  expect(configScript?.innerHTML).toContain("/api/opencode/4056")
})
```

**Test 2: Hooks Import Works**

```tsx
// Test file: apps/web/src/app/hooks.test.ts

import { useSession, useSendMessage } from "./hooks"

test("exports all expected hooks", () => {
  expect(useSession).toBeDefined()
  expect(useSendMessage).toBeDefined()
  expect(typeof useSession).toBe("function")
  expect(typeof useSendMessage).toBe("function")
})
```

**Test 3: Component Uses Factory Hooks**

```tsx
// Test file: apps/web/src/components/ai-elements/message.test.tsx

import { renderHook } from "@testing-library/react"
import { useSession } from "@/app/hooks"

test("useSession hook available from factory", () => {
  // Mock globalThis.__OPENCODE (normally injected by SSR plugin)
  globalThis.__OPENCODE = { baseUrl: "/api/opencode/4056", directory: "/tmp" }
  
  const { result } = renderHook(() => useSession("test-session-id"))
  
  // Hook should not throw (validates factory wiring)
  expect(result.error).toBeUndefined()
})
```

### Manual Testing Checklist

- [ ] App loads without console errors
- [ ] No "useOpencode must be used within provider" errors
- [ ] Session list loads (data flows through factory hooks)
- [ ] SSE events update UI in real-time
- [ ] Mobile/Tailscale: Same-origin requests work (no CORS)
- [ ] Deprecation warning appears once in console (if using old provider)

---

## Success Criteria (Verifiable Checklist)

### Code Changes

- [ ] `apps/web/src/app/hooks.ts` exists and exports all hooks
- [ ] `apps/web/src/app/layout.tsx` uses `<OpencodeSSRPlugin>`
- [ ] `apps/web/src/app/providers.tsx` shows deprecation warning
- [ ] `packages/react/src/providers/opencode-provider.tsx` shows deprecation warning
- [ ] All component imports updated to use `@/app/hooks`
- [ ] No remaining `useOpencode()` context calls

### Type Safety

- [ ] `bun run typecheck` passes (no type errors)
- [ ] IDE autocomplete works for hooks from `@/app/hooks`
- [ ] No TypeScript errors in components

### Runtime Behavior

- [ ] App runs in browser with no console errors
- [ ] Session data loads correctly
- [ ] SSE events update UI in real-time
- [ ] Mobile/Tailscale: CORS errors eliminated (same-origin proxy works)
- [ ] Deprecation warnings appear in console (expected, non-blocking)

### Tests

- [ ] `bun run test` passes (all existing tests)
- [ ] New integration tests pass (SSR plugin, hooks import)
- [ ] UBS scan passes (`ubs_scan(path="apps/web")`)

---

## Dependencies (Phases 1-3)

### Phase 1: SSE Proxy (✅ COMPLETE)

**File:** `apps/web/src/app/api/sse/[port]/route.ts`

**What it does:** Proxies SSE streams through Next.js to avoid CORS.

**How Phase 4 uses it:** Factory hooks use `/api/sse/4056` for SSE connections.

**Validation:** Check file exists and exports GET handler.

---

### Phase 2: API Proxy (⏳ REQUIRED)

**File:** `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts`

**What it does:** Proxies ALL API calls through Next.js (same-origin).

**How Phase 4 uses it:** 
- `OpencodeSSRPlugin` config uses `baseUrl: "/api/opencode/4056"`
- Factory hooks make API calls to same-origin proxy

**Validation:** 
```tsx
// In hooks.ts, config should use proxy URL
const config = { baseUrl: "/api/opencode/4056", directory: "/path" }
```

**If Phase 2 incomplete:** Use direct localhost URL as fallback:
```tsx
const config = { baseUrl: "http://localhost:4056", directory: "/path" }
// NOTE: Mobile/Tailscale will have CORS errors until Phase 2 completes
```

---

### Phase 3: Factory + SSR Plugin (⏳ REQUIRED)

**Files:**
- `packages/react/src/factory.ts` - `generateOpencodeHelpers<TRouter>()`
- `packages/react/src/next-ssr-plugin.tsx` - `OpencodeSSRPlugin`

**What it does:**
- Factory creates all hooks without provider wrapper
- SSR plugin injects config via `window.__OPENCODE`

**How Phase 4 uses it:**
```tsx
// app/hooks.ts
import { generateOpencodeHelpers } from "@opencode-vibe/react"
export const { useSession } = generateOpencodeHelpers()

// app/layout.tsx
import { OpencodeSSRPlugin } from "@opencode-vibe/react/next-ssr-plugin"
<OpencodeSSRPlugin config={{ baseUrl, directory }} />
```

**Validation:**
1. Check `packages/react/src/factory.ts` exports `generateOpencodeHelpers`
2. Check `packages/react/src/next-ssr-plugin.tsx` exports `OpencodeSSRPlugin`
3. Run `bun run typecheck` in packages/react

**If Phase 3 incomplete:**
- BLOCK Phase 4 - cannot proceed without factory pattern
- Factory is the foundation - no workaround available

---

## Estimated Time

| Task | Estimate |
|------|----------|
| Create `app/hooks.ts` | 5 min |
| Update `app/layout.tsx` | 10 min |
| Update `app/providers.tsx` | 5 min |
| Add deprecation warning to `opencode-provider.tsx` | 5 min |
| Update component imports (batch of 50 files) | 30 min |
| Remove `useOpencode()` calls (if any) | 10 min |
| Write integration tests | 20 min |
| Manual testing (browser + mobile) | 15 min |
| Fix any issues discovered | 15 min |
| **TOTAL** | **~2 hours** |

**Assumptions:**
- Phases 1-3 complete (no blockers)
- No unexpected type errors
- No complex component refactoring needed

---

## Rollback Plan

### If Phase 4 Fails Mid-Migration

**Scenario:** Component imports updated, but factory hooks fail at runtime.

**Rollback Steps:**

1. **Revert layout.tsx:**
   ```bash
   git checkout HEAD -- apps/web/src/app/layout.tsx
   ```

2. **Revert providers.tsx:**
   ```bash
   git checkout HEAD -- apps/web/src/app/providers.tsx
   ```

3. **Delete hooks.ts:**
   ```bash
   rm apps/web/src/app/hooks.ts
   ```

4. **Revert all component imports:**
   ```bash
   # Find files that import from @/app/hooks
   rg "from \"@/app/hooks\"" apps/web/src --files-with-matches | \
     xargs git checkout HEAD --
   ```

5. **Verify app works:**
   ```bash
   bun dev
   # Open browser, check session list loads
   ```

**Time to rollback:** ~5 minutes (git operations only)

---

### If Factory Pattern Has Bugs

**Scenario:** Phase 3 incomplete or factory has runtime bugs.

**Fallback Strategy:**

1. **Keep old provider pattern working:**
   - Do NOT remove `OpenCodeProvider` implementation
   - Keep deprecation warning only
   - Document: "Factory pattern experimental, use provider for stability"

2. **Parallel migration:**
   - Migrate non-critical components to factory
   - Keep critical components on provider
   - Test in production with gradual rollout

3. **Communicate to users:**
   ```tsx
   // In OpencodeProvider
   console.info(
     "[OpenCode] Using stable provider pattern. " +
     "Factory pattern available but experimental. " +
     "See docs/adr/013-unified-same-origin-architecture.md"
   )
   ```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Type errors after import changes** | Medium | High | Run typecheck after each batch of 10 files |
| **Factory hooks fail at runtime** | Low | Critical | Rollback plan (5 min), keep provider as fallback |
| **SSE reconnection breaks** | Low | High | Test on mobile before commit, verify `/api/sse` proxy works |
| **Phase 2 incomplete (no API proxy)** | Medium | Medium | Use localhost URL as fallback (document CORS limitation) |
| **Phase 3 incomplete (no factory)** | Low | Blocker | BLOCK Phase 4, implement Phase 3 first |
| **Component logic breaks** | Low | Medium | Manual testing checklist, comprehensive E2E tests |

---

## Follow-Up Tasks (Post-Migration)

### Immediate (Week 1)

- [ ] Monitor production for deprecation warnings
- [ ] Update documentation (README, ADR-013)
- [ ] Announce migration path to users
- [ ] Create migration guide for external consumers

### Short-Term (Month 1)

- [ ] Gather feedback on factory pattern DX
- [ ] Fix any edge cases discovered in production
- [ ] Add E2E tests for mobile/Tailscale scenarios

### Long-Term (v2.0.0)

- [ ] Remove `OpenCodeProvider` entirely
- [ ] Remove `SSEProvider` (redundant with factory)
- [ ] Remove `Providers` component (theme + toast can be inlined)
- [ ] Publish breaking change notice

---

## References

### ADRs

- **ADR-013:** Unified Same-Origin Architecture (parent)
- **ADR-011:** SSE Proxy Architecture (Phase 1)
- **ADR-012:** Provider-Free Architecture (inspirational, subsumed by ADR-013)

### Pattern Comparison

- **013-pattern-comparison.md:** uploadthing factory + SSR plugin analysis
- **Hivemind mem-19fd842c49c5756e:** UploadThing architecture insights

### Implementation Files

| Phase | File | Status |
|-------|------|--------|
| Phase 1 | `apps/web/src/app/api/sse/[port]/route.ts` | ✅ Complete |
| Phase 2 | `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts` | ⏳ Pending |
| Phase 3 | `packages/react/src/factory.ts` | ⏳ Pending |
| Phase 3 | `packages/react/src/next-ssr-plugin.tsx` | ⏳ Pending |
| Phase 4 | `apps/web/src/app/hooks.ts` | ⏳ This spec |

### Key Learnings

- **Provider elimination:** Factory pattern > Context API for SDK wrappers
- **SSR optimization:** `useServerInsertedHTML` > client-side config fetch
- **Same-origin:** Proxy pattern > CORS headers for mobile compatibility
- **Type safety:** Generic binding at factory call > runtime config strings

---

## Sign-Off

This spec is **COMPLETE** and **SELF-CONTAINED**.

An agent following these steps should be able to:

1. ✅ Understand context (ADR-013 unified architecture)
2. ✅ Know which files to create/modify/delete
3. ✅ Make exact changes (code snippets provided)
4. ✅ Write tests (integration test specs provided)
5. ✅ Verify success (checklist + manual testing)
6. ✅ Handle dependencies (validation steps for Phases 1-3)
7. ✅ Estimate time (~2 hours)
8. ✅ Rollback if needed (5 min git operations)

**Ready for execution.** No ambiguity. No missing steps.

**Estimated delivery:** 2 hours (assuming Phases 1-3 complete)

**Blocker dependencies:** Phase 3 (factory + SSR plugin) MUST exist before starting.
