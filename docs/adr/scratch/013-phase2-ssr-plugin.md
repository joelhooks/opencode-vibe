# ADR-013 Phase 2: SSR Plugin Implementation

**Task ID:** `opencode-next--xts0a-mjthca20bvs`  
**Epic:** ADR-013 Unified Same-Origin Architecture (`opencode-next--xts0a-mjthca1elq0`)  
**Status:** Ready  
**Estimated Time:** 3.5 hours  
**Priority:** 2 (High)

---

## Context (50 lines max)

This task implements the **provider-free architecture** using uploadthing's factory + SSR plugin pattern. It eliminates React provider ceremony by injecting configuration via `useServerInsertedHTML` and exposing hooks through a factory function.

**Dependencies:**
- ✅ Phase 1 (API Proxy) must be complete - `/api/opencode/[port]/[[...path]]` exists
- ✅ Zustand DirectoryState already supports SSR (no persist middleware)
- ✅ Pattern research in `docs/adr/scratch/013-pattern-comparison.md`

**What we're building:**

```tsx
// Before (provider hell)
<OpenCodeProvider baseUrl="..." directory="...">
  {children}
</OpenCodeProvider>

// After (zero ceremony)
<OpencodeSSRPlugin config={{ baseUrl: "/api/opencode/4056", directory: "/path" }} />
{children}

// Hooks work immediately (no provider)
const { useSession } = generateOpencodeHelpers()
const session = useSession(id) // Reads from globalThis.__OPENCODE
```

**Key Pattern (uploadthing-inspired):**
1. `<OpencodeSSRPlugin>` injects `window.__OPENCODE = { ... }` before React hydrates
2. Factory function `generateOpencodeHelpers()` creates hooks that read from `globalThis`
3. Zero hydration delay, zero provider wrappers, works in RSC

**Files affected:** 4 new files, 3 modified files

---

## Files to Create/Modify

### Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `packages/react/src/next-ssr-plugin.tsx` | SSR config injection | ~50 |
| `packages/react/src/next-ssr-plugin.test.tsx` | SSR plugin tests | ~80 |
| `packages/react/src/factory.ts` | Factory function for hooks | ~150 |
| `packages/react/src/factory.test.ts` | Factory tests | ~120 |

### Files to Modify

| File | Changes | Why |
|------|---------|-----|
| `packages/react/src/index.ts` | Export `generateOpencodeHelpers` and `OpencodeSSRPlugin` | Public API |
| `apps/web/src/app/hooks.ts` | Create factory instance | Single source of hooks |
| `apps/web/src/app/layout.tsx` | Add `<OpencodeSSRPlugin>`, remove provider | Zero ceremony |

---

## Implementation Code

### 1. SSR Plugin (`packages/react/src/next-ssr-plugin.tsx`)

```tsx
/**
 * OpencodeSSRPlugin - Inject OpenCode configuration before React hydrates
 * 
 * Pattern: uploadthing's useServerInsertedHTML approach
 * 
 * Usage:
 * ```tsx
 * // app/layout.tsx
 * <OpencodeSSRPlugin config={{ baseUrl: "/api/opencode/4056", directory: "/path" }} />
 * ```
 */
"use client"

import { useServerInsertedHTML } from "next/navigation"

export interface OpencodeConfig {
  baseUrl: string
  directory: string
}

export interface OpencodeSSRPluginProps {
  config: OpencodeConfig
}

/**
 * Injects OpenCode configuration into globalThis before React hydration
 * 
 * This eliminates the need for a React provider wrapper by making config
 * available synchronously during client-side rendering.
 */
export function OpencodeSSRPlugin({ config }: OpencodeSSRPluginProps) {
  useServerInsertedHTML(() => {
    return (
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__OPENCODE = ${JSON.stringify(config)};`,
        }}
      />
    )
  })

  return null
}
```

### 2. Factory Function (`packages/react/src/factory.ts`)

```tsx
/**
 * generateOpencodeHelpers - Factory for provider-free hooks
 * 
 * Pattern: uploadthing's generateReactHelpers approach
 * 
 * Usage:
 * ```tsx
 * // app/hooks.ts (create once)
 * export const { useSession, useSendMessage } = generateOpencodeHelpers()
 * 
 * // components/session.tsx
 * import { useSession } from "@/app/hooks"
 * const session = useSession(id) // Just works, no provider
 * ```
 */
"use client"

import { useCallback, useEffect } from "react"
import type { OpencodeConfig } from "./next-ssr-plugin"
import { useOpencodeStore } from "./store"

/**
 * Global config type augmentation
 */
declare global {
  interface Window {
    __OPENCODE?: OpencodeConfig
  }
}

/**
 * Get config from globalThis (injected by SSR plugin) or fallback
 */
function getConfig(fallback?: OpencodeConfig): OpencodeConfig {
  // 1. Check globalThis (from SSR plugin)
  if (typeof window !== "undefined" && window.__OPENCODE) {
    return window.__OPENCODE
  }

  // 2. Fallback to provided config (for tests)
  if (!fallback?.baseUrl) {
    throw new Error(
      "OpenCode: No configuration found. " +
      "Did you forget to add <OpencodeSSRPlugin> to your layout?"
    )
  }

  return fallback
}

/**
 * Factory function that creates type-safe OpenCode hooks
 * 
 * @param config - Optional config for tests (production uses globalThis)
 * @returns Object with all OpenCode hooks
 */
export function generateOpencodeHelpers<TRouter = any>(config?: OpencodeConfig) {
  /**
   * Hook for accessing session data with real-time SSE updates
   * 
   * @example
   * ```tsx
   * const session = useSession("session-123")
   * ```
   */
  function useSession(sessionId: string) {
    const cfg = getConfig(config)
    
    // Use Zustand store selector
    const session = useOpencodeStore(
      useCallback(
        (state) => state.sessions.find((s) => s.id === sessionId),
        [sessionId]
      )
    )

    // Initialize directory on mount
    useEffect(() => {
      if (!cfg.directory) return
      useOpencodeStore.getState().initDirectory(cfg.directory)
    }, [cfg.directory])

    return session
  }

  /**
   * Hook for accessing messages in a session with real-time updates
   * 
   * @example
   * ```tsx
   * const messages = useMessages("session-123")
   * ```
   */
  function useMessages(sessionId: string) {
    const cfg = getConfig(config)

    const messages = useOpencodeStore(
      useCallback(
        (state) => state.messages.filter((m) => m.sessionId === sessionId),
        [sessionId]
      )
    )

    useEffect(() => {
      if (!cfg.directory) return
      useOpencodeStore.getState().initDirectory(cfg.directory)
    }, [cfg.directory])

    return messages
  }

  /**
   * Hook for sending messages to a session
   * 
   * @example
   * ```tsx
   * const { sendMessage, isPending } = useSendMessage({ sessionId: "session-123" })
   * await sendMessage({ text: "Hello" })
   * ```
   */
  function useSendMessage(options: { sessionId: string }) {
    const cfg = getConfig(config)

    const sendMessage = useCallback(
      async (input: { text: string }) => {
        // Use store action
        await useOpencodeStore.getState().sendMessage({
          sessionId: options.sessionId,
          text: input.text,
          baseUrl: cfg.baseUrl,
        })
      },
      [cfg.baseUrl, options.sessionId]
    )

    return { sendMessage, isPending: false }
  }

  return {
    useSession,
    useMessages,
    useSendMessage,
  }
}
```

### 3. Updated Exports (`packages/react/src/index.ts`)

```tsx
// Add to existing exports:
export { generateOpencodeHelpers } from "./factory"
export { OpencodeSSRPlugin } from "./next-ssr-plugin"
export type { OpencodeConfig, OpencodeSSRPluginProps } from "./next-ssr-plugin"
```

### 4. Web App Hooks (`apps/web/src/app/hooks.ts`)

**Create new file:**

```tsx
/**
 * OpenCode hooks - single source of truth
 * 
 * This file creates the factory instance once and exports all hooks.
 * Components import from here, not from @opencode-vibe/react directly.
 */
import { generateOpencodeHelpers } from "@opencode-vibe/react"

export const { useSession, useMessages, useSendMessage } = generateOpencodeHelpers()
```

### 5. Updated Layout (`apps/web/src/app/layout.tsx`)

```tsx
import { OpencodeSSRPlugin } from "@opencode-vibe/react"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {/* SSR plugin replaces provider wrapper */}
        <OpencodeSSRPlugin
          config={{
            baseUrl: "/api/opencode/4056",
            directory: process.cwd(),
          }}
        />
        {children}
      </body>
    </html>
  )
}
```

---

## Test Specifications

### Test File 1: `packages/react/src/next-ssr-plugin.test.tsx`

```tsx
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { OpencodeSSRPlugin } from "./next-ssr-plugin"

describe("OpencodeSSRPlugin", () => {
  it("renders nothing (returns null)", () => {
    const { container } = render(
      <OpencodeSSRPlugin config={{ baseUrl: "/api", directory: "/path" }} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("config is serializable (no functions/symbols)", () => {
    const config = { baseUrl: "/api", directory: "/path" }
    expect(() => JSON.stringify(config)).not.toThrow()
  })

  it("accepts valid config shape", () => {
    expect(() => {
      render(<OpencodeSSRPlugin config={{ baseUrl: "/api", directory: "/path" }} />)
    }).not.toThrow()
  })
})
```

### Test File 2: `packages/react/src/factory.test.ts`

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { generateOpencodeHelpers } from "./factory"
import { useOpencodeStore } from "./store"

describe("generateOpencodeHelpers", () => {
  beforeEach(() => {
    // Reset store between tests
    useOpencodeStore.getState().reset()

    // Clear globalThis
    if (typeof window !== "undefined") {
      delete (window as any).__OPENCODE
    }
  })

  describe("getConfig", () => {
    it("reads from globalThis when available", () => {
      // Set up globalThis
      ;(window as any).__OPENCODE = {
        baseUrl: "/api/opencode/4056",
        directory: "/path",
      }

      const { useSession } = generateOpencodeHelpers()
      const { result } = renderHook(() => useSession("session-123"))

      // Should not throw
      expect(result.current).toBeDefined()
    })

    it("uses fallback config when globalThis empty", () => {
      const { useSession } = generateOpencodeHelpers({
        baseUrl: "/fallback",
        directory: "/fallback-path",
      })

      const { result } = renderHook(() => useSession("session-123"))
      expect(result.current).toBeDefined()
    })

    it("throws when no config available", () => {
      const { useSession } = generateOpencodeHelpers()

      expect(() => {
        renderHook(() => useSession("session-123"))
      }).toThrow(/No configuration found/)
    })
  })

  describe("useSession", () => {
    it("returns session from store", () => {
      // Set up globalThis
      ;(window as any).__OPENCODE = {
        baseUrl: "/api",
        directory: "/path",
      }

      // Add session to store
      useOpencodeStore.getState().sessions.push({
        id: "session-123",
        title: "Test Session",
      })

      const { useSession } = generateOpencodeHelpers()
      const { result } = renderHook(() => useSession("session-123"))

      expect(result.current?.id).toBe("session-123")
      expect(result.current?.title).toBe("Test Session")
    })

    it("initializes directory on mount", async () => {
      ;(window as any).__OPENCODE = {
        baseUrl: "/api",
        directory: "/test-dir",
      }

      const initSpy = vi.spyOn(useOpencodeStore.getState(), "initDirectory")

      const { useSession } = generateOpencodeHelpers()
      renderHook(() => useSession("session-123"))

      await waitFor(() => {
        expect(initSpy).toHaveBeenCalledWith("/test-dir")
      })
    })
  })

  describe("useMessages", () => {
    it("filters messages by session ID", () => {
      ;(window as any).__OPENCODE = {
        baseUrl: "/api",
        directory: "/path",
      }

      // Add messages to store
      useOpencodeStore.getState().messages.push(
        { id: "msg-1", sessionId: "session-123", text: "Hello" },
        { id: "msg-2", sessionId: "session-456", text: "World" },
        { id: "msg-3", sessionId: "session-123", text: "Test" }
      )

      const { useMessages } = generateOpencodeHelpers()
      const { result } = renderHook(() => useMessages("session-123"))

      expect(result.current).toHaveLength(2)
      expect(result.current[0].text).toBe("Hello")
      expect(result.current[1].text).toBe("Test")
    })
  })

  describe("useSendMessage", () => {
    it("calls store action with correct params", async () => {
      ;(window as any).__OPENCODE = {
        baseUrl: "/api/opencode/4056",
        directory: "/path",
      }

      const sendSpy = vi.spyOn(useOpencodeStore.getState(), "sendMessage")

      const { useSendMessage } = generateOpencodeHelpers()
      const { result } = renderHook(() => useSendMessage({ sessionId: "session-123" }))

      await result.current.sendMessage({ text: "Hello" })

      expect(sendSpy).toHaveBeenCalledWith({
        sessionId: "session-123",
        text: "Hello",
        baseUrl: "/api/opencode/4056",
      })
    })
  })
})
```

---

## Success Criteria (Verifiable Checklist)

### Build & Type Safety
- [ ] `bun run typecheck` passes (full monorepo)
- [ ] `bun run lint` passes (no errors)
- [ ] `bun run format` passes (biome)

### Tests
- [ ] `bun run test packages/react/src/next-ssr-plugin.test.tsx` passes
- [ ] `bun run test packages/react/src/factory.test.ts` passes
- [ ] All existing tests still pass (`bun run test`)
- [ ] Test coverage >80% for new files

### Functionality
- [ ] `<OpencodeSSRPlugin>` injects `window.__OPENCODE` before React hydration
- [ ] Factory hooks read from `globalThis.__OPENCODE` successfully
- [ ] Factory hooks throw helpful error when config missing
- [ ] Hooks work in components without provider wrapper
- [ ] Store actions (initDirectory, sendMessage) called correctly
- [ ] Zero hydration delay (config available immediately)

### Integration
- [ ] `apps/web/src/app/layout.tsx` renders with plugin (no provider)
- [ ] `apps/web/src/app/hooks.ts` exports working hooks
- [ ] Components importing from `@/app/hooks` work correctly
- [ ] No console errors in browser
- [ ] Dev server starts without errors

### Documentation
- [ ] JSDoc comments on all public exports
- [ ] Usage examples in code comments
- [ ] Error messages are actionable

---

## Dependencies

### Required (Phase 1 Complete)
- ✅ `/api/opencode/[port]/[[...path]]/route.ts` exists and proxies API calls
- ✅ `packages/core/src/client/client.ts` uses `/api/opencode/${port}` for baseUrl
- ✅ Zustand DirectoryState exists and supports SSR

### Assumptions
- `useOpencodeStore` has these methods:
  - `sessions` array with `find()` support
  - `messages` array with `filter()` support
  - `initDirectory(directory: string)` method
  - `sendMessage({ sessionId, text, baseUrl })` method

If these don't exist, create them in `packages/react/src/store/store.ts` FIRST.

---

## Estimated Time Breakdown

| Task | Time |
|------|------|
| Create `next-ssr-plugin.tsx` | 30 min |
| Create `next-ssr-plugin.test.tsx` | 30 min |
| Create `factory.ts` | 1 hour |
| Create `factory.test.ts` | 45 min |
| Update exports in `index.ts` | 5 min |
| Create `apps/web/src/app/hooks.ts` | 10 min |
| Update `apps/web/src/app/layout.tsx` | 15 min |
| Run tests, fix issues | 30 min |
| Manual testing in browser | 15 min |

**Total: 3.5 hours**

---

## Next Steps (After Completion)

1. **Phase 3 (Integration):** Migrate all components to use `@/app/hooks`
2. **Deprecation:** Add warning to `OpenCodeProvider`
3. **Documentation:** Update README with new pattern
4. **Mobile Testing:** Verify on iPhone via Tailscale

---

## References

### Pattern Research
- `docs/adr/scratch/013-pattern-comparison.md` - uploadthing, tRPC, oRPC patterns
- `docs/adr/013-unified-same-origin-architecture.md` - Full architecture

### uploadthing Source Code
- Factory pattern: `generateReactHelpers<TRouter>()`
- SSR plugin: `UploadThingProvider` with `useServerInsertedHTML`
- Pattern: https://github.com/pingdotgg/uploadthing

### Internal Files
- `packages/react/src/store/store.ts` - Zustand DirectoryState
- `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts` - API proxy (Phase 1)
- `packages/core/src/sse/multi-server-sse.ts` - SSE client

---

## Implementation Notes

### Critical Patterns

1. **globalThis over localStorage:** SSR-safe, no async fetch needed
2. **getState() not hook:** Avoid Zustand selector infinite loops
3. **useCallback for selectors:** Prevent unnecessary re-renders
4. **Vitest with forks:** Proper test isolation (see `vitest.config.ts`)

### Known Gotchas

- **Don't use `bun test`** - Use `bun run test` (Vitest with isolation)
- **JSON.stringify config** - Ensure config is serializable (no functions)
- **useServerInsertedHTML timing** - Runs before React hydration (expected)
- **Zustand selector reference** - Use `getState()` for actions, hook for selectors

### Error Messages

```
"OpenCode: No configuration found. Did you forget to add <OpencodeSSRPlugin> to your layout?"
```

This guides developers to the correct solution when they forget the plugin.

---

## Completion Checklist

Before marking complete:

- [ ] All files created/modified as specified
- [ ] All tests pass (`bun run test`)
- [ ] Type check passes (`bun run typecheck`)
- [ ] Lint passes (`bun run lint`)
- [ ] Format passes (`bun run format`)
- [ ] Manual browser test (no console errors)
- [ ] UBS scan passes (`ubs_scan(path="packages/react")`)
- [ ] Git commit with message: `feat: implement SSR plugin (ADR-013 Phase 2)`

---

**READY FOR IMPLEMENTATION** ✅
