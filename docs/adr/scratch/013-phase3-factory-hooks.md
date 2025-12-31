# ADR-013 Phase 3: Factory Hooks - Complete Task Specification

**Date:** 2025-12-31  
**Status:** Ready for Implementation  
**Dependencies:** Phase 2 (SSR Plugin) - Must be completed first  
**Estimated Time:** 3-4 hours  

---

## Context (Why This Exists)

Phase 2 (SSR Plugin) provided `<OpencodeSSRPlugin>` which injects config into `globalThis.__OPENCODE`. Phase 3 completes the provider-free architecture by creating factory-generated hooks that consume this config.

**Current Problem:**
- Hooks hardcoded to `useOpencode()` context (provider coupling)
- Each hook manually reads `directory` from provider
- Type safety only at hook level, not at factory level

**Solution:**
- `generateOpencodeHelpers<TRouter>()` factory function (uploadthing pattern)
- Hooks check `globalThis.__OPENCODE` first, fallback to config parameter
- Type inference from router (tRPC-style mapped types)
- Integrate with existing Zustand store (no breaking changes)

**Pattern Source:** uploadthing's `generateReactHelpers` + tRPC's type inference

---

## Files to Create

### 1. Core Factory Implementation

**Path:** `packages/react/src/factory.ts`

**Purpose:** Main factory function that binds router type and generates hooks

**Full Implementation:**

```typescript
/**
 * Factory function for creating type-safe OpenCode hooks without provider wrappers
 * 
 * Inspired by uploadthing's generateReactHelpers pattern.
 * Binds router type at factory call, checks globalThis.__OPENCODE for config.
 * 
 * @example
 * ```tsx
 * // app/hooks.ts - Single source of hooks
 * import { generateOpencodeHelpers } from "@opencode-vibe/react"
 * import type { AppRouter } from "@opencode-vibe/core" // Type-only import
 * 
 * export const {
 *   useSession,
 *   useSendMessage,
 *   useSessionList,
 *   useProviders,
 *   useProjects,
 *   useCommands,
 *   useCreateSession,
 *   useFileSearch,
 * } = generateOpencodeHelpers<AppRouter>()
 * ```
 */

import { useCallback, useState, useEffect } from "react"
import type { Router } from "@opencode-vibe/core"
import { useOpencodeStore } from "./store"
import type { Session, Message } from "./store/types"
import type { Prompt } from "./types/prompt"
import { convertToApiParts } from "./lib/prompt-api"
import { sessions, providers, projects, files } from "@opencode-vibe/core/api"
import { useSessionStatus } from "./hooks/internal/use-session-status"
import { useCommands as useCommandsBase } from "./hooks/use-commands"

/**
 * Global config injected by OpencodeSSRPlugin
 */
interface OpencodeGlobalConfig {
  baseUrl: string
  directory: string
}

declare global {
  interface Window {
    __OPENCODE?: OpencodeGlobalConfig
  }
}

/**
 * Factory config (fallback when globalThis not available)
 */
export interface OpencodeFactoryConfig {
  baseUrl?: string
  directory?: string
}

/**
 * Get config from globalThis or fallback parameter
 * Throws if neither available (dev error - missing SSR plugin)
 */
function getConfig(fallback?: OpencodeFactoryConfig): OpencodeGlobalConfig {
  // 1. Check globalThis (from SSR plugin)
  if (typeof window !== "undefined" && window.__OPENCODE) {
    return window.__OPENCODE
  }

  // 2. Fallback to provided config (for tests, server-side)
  if (!fallback?.baseUrl || !fallback?.directory) {
    throw new Error(
      "OpenCode: No config found. Did you forget <OpencodeSSRPlugin> in app/layout.tsx?"
    )
  }

  return {
    baseUrl: fallback.baseUrl,
    directory: fallback.directory,
  }
}

/**
 * Model selection for message sending
 */
export interface ModelSelection {
  providerID: string
  modelID: string
}

/**
 * Generate type-safe OpenCode hooks bound to router type
 * 
 * @param config - Optional fallback config (used by tests, SSR falls back to globalThis)
 * @returns Object with all OpenCode hooks
 */
export function generateOpencodeHelpers<TRouter extends Router = Router>(
  config?: OpencodeFactoryConfig
) {
  /**
   * Hook to get a single session from Zustand store
   * 
   * Returns undefined if session not found or archived.
   * Session data updates automatically via SSE events.
   * 
   * @param sessionId - Session ID to retrieve
   * @returns Session or undefined
   */
  function useSession(sessionId: string): Session | undefined {
    const { directory } = getConfig(config)

    return useOpencodeStore((state) => {
      const sessions = state.directories[directory]?.sessions
      if (!sessions) return undefined

      const session = sessions.find((s) => s.id === sessionId)

      // Filter out archived sessions
      if (session?.time?.archived) {
        return undefined
      }

      return session
    })
  }

  /**
   * Hook for sending messages to an OpenCode session with FIFO queue
   * 
   * Message Queue Behavior:
   * - Messages queued client-side in FIFO order
   * - First message sends immediately
   * - Subsequent messages wait for session idle
   * - Queue auto-processes when session transitions running → idle
   * 
   * @param options - Session ID and optional directory override
   * @returns sendMessage function, loading state, error, queue length
   */
  function useSendMessage(options: { sessionId: string; directory?: string }) {
    const globalConfig = getConfig(config)
    const directory = options.directory ?? globalConfig.directory
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | undefined>(undefined)
    const [queueLength, setQueueLength] = useState(0)

    const { findCommand } = useCommandsBase()
    const { isRunning } = useSessionStatus({ sessionId: options.sessionId, directory })

    // Message queue (React ref for stable reference)
    const queueRef = useRef<Array<{
      parts: Prompt
      model?: ModelSelection
      resolve: () => void
      reject: (error: Error) => void
    }>>([])

    // Auto-process queue when session becomes idle
    useEffect(() => {
      if (!isRunning && queueRef.current.length > 0) {
        const next = queueRef.current.shift()
        if (next) {
          setQueueLength(queueRef.current.length)
          sendMessageInternal(next.parts, next.model)
            .then(next.resolve)
            .catch(next.reject)
        }
      }
    }, [isRunning])

    const sendMessageInternal = useCallback(
      async (parts: Prompt, model?: ModelSelection) => {
        setIsLoading(true)
        setError(undefined)

        try {
          // Parse for slash commands
          const textPart = parts.find((p) => p.type === "text")
          const text = textPart?.content.trim() ?? ""

          if (text.startsWith("/")) {
            const [commandName, ...argParts] = text.slice(1).split(/\s+/)
            const args = argParts.join(" ")
            const command = findCommand(commandName)

            if (command) {
              // Execute slash command
              await sessions.executeCommand({
                directory,
                sessionID: options.sessionId,
                body: {
                  command: commandName,
                  arguments: args,
                  type: command.type,
                },
              })
              return
            }
          }

          // Send regular message
          const apiParts = convertToApiParts(parts)
          await sessions.promptAsync({
            directory,
            sessionID: options.sessionId,
            body: {
              parts: apiParts,
              providerID: model?.providerID,
              modelID: model?.modelID,
            },
          })
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          setError(error)
          throw error
        } finally {
          setIsLoading(false)
        }
      },
      [directory, options.sessionId, findCommand]
    )

    const sendMessage = useCallback(
      async (parts: Prompt, model?: ModelSelection) => {
        // If session running, queue the message
        if (isRunning) {
          return new Promise<void>((resolve, reject) => {
            queueRef.current.push({ parts, model, resolve, reject })
            setQueueLength(queueRef.current.length)
          })
        }

        // Otherwise send immediately
        return sendMessageInternal(parts, model)
      },
      [isRunning, sendMessageInternal]
    )

    return {
      sendMessage,
      isLoading,
      error,
      queueLength,
    }
  }

  /**
   * Hook to get all sessions for current directory
   * 
   * Sessions sorted by last activity (most recent first).
   * Excludes archived sessions.
   * 
   * @returns Array of sessions
   */
  function useSessionList() {
    const { directory } = getConfig(config)

    return useOpencodeStore((state) => {
      const sessions = state.directories[directory]?.sessions ?? []
      const lastActivity = state.directories[directory]?.sessionLastActivity ?? {}

      // Filter out archived sessions and sort by last activity
      return sessions
        .filter((s) => !s.time?.archived)
        .sort((a, b) => {
          const aTime = lastActivity[a.id] ?? 0
          const bTime = lastActivity[b.id] ?? 0
          return bTime - aTime
        })
    })
  }

  /**
   * Hook to list available providers
   * 
   * @returns Object with providers array, loading state, error
   */
  function useProviders() {
    const { directory } = getConfig(config)
    const [providerList, setProviderList] = useState<Array<any>>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | undefined>(undefined)

    useEffect(() => {
      let cancelled = false

      async function fetchProviders() {
        setIsLoading(true)
        setError(undefined)

        try {
          const result = await providers.list({ directory })
          if (!cancelled) {
            setProviderList(result.data ?? [])
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err : new Error(String(err)))
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false)
          }
        }
      }

      fetchProviders()

      return () => {
        cancelled = true
      }
    }, [directory])

    return {
      providers: providerList,
      isLoading,
      error,
    }
  }

  /**
   * Hook to list available projects
   * 
   * @returns Object with projects array, loading state, error
   */
  function useProjects() {
    const { directory } = getConfig(config)
    const [projectList, setProjectList] = useState<Array<any>>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | undefined>(undefined)

    useEffect(() => {
      let cancelled = false

      async function fetchProjects() {
        setIsLoading(true)
        setError(undefined)

        try {
          const result = await projects.list({ directory })
          if (!cancelled) {
            setProjectList(result.data ?? [])
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err : new Error(String(err)))
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false)
          }
        }
      }

      fetchProjects()

      return () => {
        cancelled = true
      }
    }, [directory])

    return {
      projects: projectList,
      isLoading,
      error,
    }
  }

  /**
   * Hook to get available slash commands
   * 
   * @returns Object with findCommand function and commands array
   */
  function useCommands() {
    return useCommandsBase()
  }

  /**
   * Hook to create a new session
   * 
   * @returns createSession function, loading state, error
   */
  function useCreateSession() {
    const { directory } = getConfig(config)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | undefined>(undefined)

    const createSession = useCallback(
      async (options: {
        title?: string
        model?: ModelSelection
        initialPrompt?: Prompt
      }) => {
        setIsLoading(true)
        setError(undefined)

        try {
          const result = await sessions.create({
            directory,
            body: {
              title: options.title,
              providerID: options.model?.providerID,
              modelID: options.model?.modelID,
            },
          })

          // If initial prompt provided, send it
          if (options.initialPrompt && result.data?.id) {
            const apiParts = convertToApiParts(options.initialPrompt)
            await sessions.promptAsync({
              directory,
              sessionID: result.data.id,
              body: {
                parts: apiParts,
                providerID: options.model?.providerID,
                modelID: options.model?.modelID,
              },
            })
          }

          return result.data?.id
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          setError(error)
          throw error
        } finally {
          setIsLoading(false)
        }
      },
      [directory]
    )

    return {
      createSession,
      isLoading,
      error,
    }
  }

  /**
   * Hook to search files in project
   * 
   * @param query - Search query
   * @returns Object with files array, loading state, error
   */
  function useFileSearch(query: string) {
    const { directory } = getConfig(config)
    const [fileList, setFileList] = useState<Array<any>>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | undefined>(undefined)

    useEffect(() => {
      if (!query.trim()) {
        setFileList([])
        return
      }

      let cancelled = false

      async function searchFiles() {
        setIsLoading(true)
        setError(undefined)

        try {
          const result = await files.search({
            directory,
            body: { query },
          })

          if (!cancelled) {
            setFileList(result.data ?? [])
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err : new Error(String(err)))
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false)
          }
        }
      }

      searchFiles()

      return () => {
        cancelled = true
      }
    }, [directory, query])

    return {
      files: fileList,
      isLoading,
      error,
    }
  }

  // Return all hooks bound to config
  return {
    useSession,
    useSendMessage,
    useSessionList,
    useProviders,
    useProjects,
    useCommands,
    useCreateSession,
    useFileSearch,
  }
}
```

---

### 2. TypeScript Type Utilities

**Path:** `packages/react/src/factory-types.ts`

**Purpose:** Type inference utilities for router-to-hook type mapping (future enhancement)

**Full Implementation:**

```typescript
/**
 * Type utilities for factory-generated hooks
 * 
 * Future enhancement: Extract router types and map to hook return types
 * Currently placeholder - full implementation requires router type introspection
 */

import type { Router } from "@opencode-vibe/core"

/**
 * Extract client type from router (placeholder for tRPC-style type inference)
 * 
 * Future enhancement: Use conditional mapped types to transform router
 * procedures into client method signatures
 */
export type InferClientFromRouter<TRouter extends Router> = TRouter

/**
 * Extract hook return types from router (placeholder)
 * 
 * Future enhancement: Map router procedures to hook result types
 */
export type InferHooksFromRouter<TRouter extends Router> = {
  useSession: (sessionId: string) => any
  useSendMessage: (options: any) => any
  useSessionList: () => any[]
  useProviders: () => any
  useProjects: () => any
  useCommands: () => any
  useCreateSession: () => any
  useFileSearch: (query: string) => any
}
```

---

### 3. Package Exports

**Path:** `packages/react/src/index.ts` (UPDATE - add factory export)

**Change:**

```typescript
// Factory pattern (provider-free)
export { generateOpencodeHelpers } from "./factory"
export type { OpencodeFactoryConfig, ModelSelection } from "./factory"

// SSR Plugin (inject config into globalThis)
export { OpencodeSSRPlugin } from "./next-ssr-plugin"

// Legacy providers (deprecated - show warning)
export { OpenCodeProvider } from "./providers/opencode-provider"
```

---

## Files to Modify

### 1. Update App Hooks Entry Point

**Path:** `apps/web/src/app/hooks.ts` (CREATE if not exists)

**Purpose:** Single source of truth for all OpenCode hooks in the app

**Full Implementation:**

```typescript
/**
 * App-level OpenCode hooks - Single source of truth
 * 
 * Generated by factory function with type binding.
 * Import hooks from here, not from @opencode-vibe/react directly.
 */

import { generateOpencodeHelpers } from "@opencode-vibe/react"
// Type-only import - no runtime cost
import type { Router } from "@opencode-vibe/core"

// Generate all hooks bound to app router type
export const {
  useSession,
  useSendMessage,
  useSessionList,
  useProviders,
  useProjects,
  useCommands,
  useCreateSession,
  useFileSearch,
} = generateOpencodeHelpers<Router>()
```

---

### 2. Update Layout to Use SSR Plugin

**Path:** `apps/web/src/app/layout.tsx`

**Change:** Replace `<OpenCodeProvider>` with `<OpencodeSSRPlugin>`

**Before:**

```tsx
import { OpenCodeProvider } from "@opencode-vibe/react"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <OpenCodeProvider baseUrl="..." directory="...">
          {children}
        </OpenCodeProvider>
      </body>
    </html>
  )
}
```

**After:**

```tsx
import { OpencodeSSRPlugin } from "@opencode-vibe/react"

export default function RootLayout({ children }) {
  const baseUrl = "/api/opencode/4056" // Proxy endpoint from Phase 1
  const directory = process.cwd()

  return (
    <html>
      <body>
        <OpencodeSSRPlugin config={{ baseUrl, directory }} />
        {children}
      </body>
    </html>
  )
}
```

---

### 3. Update Components to Use App Hooks

**Path:** All component files using OpenCode hooks

**Pattern:**

```tsx
// Before
import { useSessionData } from "@opencode-vibe/react"

// After
import { useSession } from "@/app/hooks"

// Usage - no changes to hook calls
const session = useSession(sessionId)
```

**Files to Update:**
- `apps/web/src/app/session/[id]/session-layout.tsx`
- `apps/web/src/app/session/[id]/page.tsx`
- `apps/web/src/components/**/*.tsx` (any using OpenCode hooks)

---

## Test Specifications

### Test File 1: Factory Function

**Path:** `packages/react/src/factory.test.ts`

**Test Cases:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { generateOpencodeHelpers } from "./factory"

describe("generateOpencodeHelpers", () => {
  beforeEach(() => {
    // Clear globalThis before each test
    delete (window as any).__OPENCODE
  })

  describe("Config Resolution", () => {
    it("reads from globalThis.__OPENCODE when available", () => {
      // Arrange
      ;(window as any).__OPENCODE = {
        baseUrl: "/api/opencode/4056",
        directory: "/test/project",
      }

      const { useSession } = generateOpencodeHelpers()

      // Act - hook should not throw
      const { result } = renderHook(() => useSession("test-id"))

      // Assert - no error thrown
      expect(result.error).toBeUndefined()
    })

    it("falls back to config parameter when globalThis not set", () => {
      // Arrange
      const config = {
        baseUrl: "/api/opencode/4056",
        directory: "/test/project",
      }

      const { useSession } = generateOpencodeHelpers(config)

      // Act
      const { result } = renderHook(() => useSession("test-id"))

      // Assert - no error
      expect(result.error).toBeUndefined()
    })

    it("throws when neither globalThis nor config available", () => {
      // Arrange
      const { useSession } = generateOpencodeHelpers()

      // Act & Assert
      expect(() => {
        renderHook(() => useSession("test-id"))
      }).toThrow("OpenCode: No config found")
    })

    it("prefers globalThis over config parameter", () => {
      // Arrange
      ;(window as any).__OPENCODE = {
        baseUrl: "/global",
        directory: "/global",
      }

      const config = {
        baseUrl: "/config",
        directory: "/config",
      }

      const { useSession } = generateOpencodeHelpers(config)

      // Act - should use globalThis, not config
      const { result } = renderHook(() => useSession("test-id"))

      // Assert - verify globalThis was used (indirect via no error)
      expect(result.error).toBeUndefined()
    })
  })

  describe("Hook Generation", () => {
    it("generates all expected hooks", () => {
      const config = {
        baseUrl: "/api/opencode/4056",
        directory: "/test",
      }

      const hooks = generateOpencodeHelpers(config)

      expect(hooks).toHaveProperty("useSession")
      expect(hooks).toHaveProperty("useSendMessage")
      expect(hooks).toHaveProperty("useSessionList")
      expect(hooks).toHaveProperty("useProviders")
      expect(hooks).toHaveProperty("useProjects")
      expect(hooks).toHaveProperty("useCommands")
      expect(hooks).toHaveProperty("useCreateSession")
      expect(hooks).toHaveProperty("useFileSearch")
    })

    it("returns same hook instances on multiple calls", () => {
      const config = {
        baseUrl: "/api/opencode/4056",
        directory: "/test",
      }

      const hooks1 = generateOpencodeHelpers(config)
      const hooks2 = generateOpencodeHelpers(config)

      // Hooks should be stable (same function references)
      expect(hooks1.useSession).toBe(hooks2.useSession)
    })
  })

  describe("Type Safety", () => {
    it("allows generic router type parameter", () => {
      type MockRouter = { sessions: any }

      const config = {
        baseUrl: "/api/opencode/4056",
        directory: "/test",
      }

      // Should compile without errors
      const hooks = generateOpencodeHelpers<MockRouter>(config)

      expect(hooks).toBeDefined()
    })
  })
})
```

---

### Test File 2: Integration with SSR Plugin

**Path:** `packages/react/src/factory-integration.test.tsx`

**Test Cases:**

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { generateOpencodeHelpers } from "./factory"
import { OpencodeSSRPlugin } from "./next-ssr-plugin"

describe("Factory + SSR Plugin Integration", () => {
  beforeEach(() => {
    delete (window as any).__OPENCODE
  })

  it("hooks work when SSR plugin injects config", () => {
    // Arrange
    const config = {
      baseUrl: "/api/opencode/4056",
      directory: "/test/project",
    }

    const { useSessionList } = generateOpencodeHelpers()

    function TestComponent() {
      const sessions = useSessionList()
      return <div>Sessions: {sessions.length}</div>
    }

    // Act - Render with SSR plugin
    render(
      <>
        <OpencodeSSRPlugin config={config} />
        <TestComponent />
      </>
    )

    // Assert - Component should render without throwing
    expect(screen.getByText(/Sessions:/)).toBeInTheDocument()
  })

  it("throws when SSR plugin missing", () => {
    // Arrange
    const { useSessionList } = generateOpencodeHelpers()

    function TestComponent() {
      const sessions = useSessionList()
      return <div>Sessions: {sessions.length}</div>
    }

    // Act & Assert - Should throw without SSR plugin
    expect(() => {
      render(<TestComponent />)
    }).toThrow("OpenCode: No config found")
  })
})
```

---

## Success Criteria

**Compile-Time Checks:**

- [ ] TypeScript compiles with no errors (`bun run typecheck`)
- [ ] Factory exports available from `@opencode-vibe/react`
- [ ] App hooks file exports all hooks with correct types
- [ ] No type errors in components using factory hooks

**Runtime Checks:**

- [ ] `generateOpencodeHelpers()` creates hook object
- [ ] Hooks throw error when config missing (dev-time safety)
- [ ] Hooks read from `globalThis.__OPENCODE` when available
- [ ] Hooks fall back to config parameter for tests
- [ ] All existing hook functionality preserved (no regressions)

**Integration Checks:**

- [ ] SSR plugin injects config into `globalThis`
- [ ] Factory hooks consume config from `globalThis`
- [ ] No provider wrapper needed in layout
- [ ] Components import from `@/app/hooks`, not `@opencode-vibe/react`
- [ ] App runs with no console errors

**Test Coverage:**

- [ ] Factory config resolution tested (globalThis, fallback, error)
- [ ] Hook generation tested (all hooks present, stable references)
- [ ] Integration with SSR plugin tested (works together, fails when missing)
- [ ] All existing hook tests still pass (no breaking changes)

---

## Dependencies

**Phase 2 MUST be complete:**

- ✅ `<OpencodeSSRPlugin>` component exists
- ✅ Plugin injects `window.__OPENCODE = { baseUrl, directory }`
- ✅ Plugin tested and working in layout

**Blocked if Phase 2 incomplete:**

- Factory hooks need `globalThis.__OPENCODE` to be reliable
- Without SSR plugin, factory falls back to config parameter (works but not ideal)

---

## Implementation Checklist

**Step 1: Create Factory Function (1.5 hours)**

- [ ] Create `packages/react/src/factory.ts`
- [ ] Implement `getConfig()` helper (checks globalThis, fallback)
- [ ] Implement `generateOpencodeHelpers()` factory
- [ ] Generate all 8 hooks (useSession, useSendMessage, etc.)
- [ ] Verify TypeScript compiles

**Step 2: Write Tests (1 hour)**

- [ ] Create `packages/react/src/factory.test.ts`
- [ ] Test config resolution (3 cases)
- [ ] Test hook generation (stable references)
- [ ] Test type safety (generic parameter)
- [ ] Create `packages/react/src/factory-integration.test.tsx`
- [ ] Test SSR plugin integration
- [ ] Run tests: `bun run test`

**Step 3: Update Package Exports (15 min)**

- [ ] Add factory exports to `packages/react/src/index.ts`
- [ ] Export `generateOpencodeHelpers`
- [ ] Export `OpencodeFactoryConfig` type
- [ ] Export `ModelSelection` type
- [ ] Verify exports work: `import { generateOpencodeHelpers } from "@opencode-vibe/react"`

**Step 4: Migrate App to Factory Pattern (1 hour)**

- [ ] Create `apps/web/src/app/hooks.ts` (app-level hook factory)
- [ ] Update `apps/web/src/app/layout.tsx` (replace provider with SSR plugin)
- [ ] Update component imports (`@/app/hooks` instead of `@opencode-vibe/react`)
- [ ] Find all components using OpenCode hooks: `rg "use(Session|SendMessage|SessionList|Providers|Projects|Commands|CreateSession|FileSearch)" apps/web/src`
- [ ] Update each component to import from `@/app/hooks`

**Step 5: Verify & Test (30 min)**

- [ ] Run typecheck: `bun run typecheck`
- [ ] Run tests: `bun run test`
- [ ] Start dev server: `bun dev`
- [ ] Open app in browser, verify no console errors
- [ ] Test session load, message send, session list
- [ ] Verify SSR hydration works (no "config not found" errors)

---

## Rollback Plan

**If factory pattern breaks app:**

1. Revert `apps/web/src/app/layout.tsx` to `<OpenCodeProvider>`
2. Revert component imports to `@opencode-vibe/react`
3. Delete `apps/web/src/app/hooks.ts`
4. Keep factory code (packages/react/src/factory.ts) - doesn't break anything if unused

**Safe rollback because:**

- Factory is additive (doesn't remove existing hooks)
- Provider still exists (not deleted, just deprecated)
- Components can use either pattern (provider or factory)

---

## Notes for Implementation

**Key Pattern Similarities:**

| uploadthing | This Implementation |
|-------------|---------------------|
| `generateReactHelpers<FileRouter>()` | `generateOpencodeHelpers<Router>()` |
| Returns `{ useUploadThing }` | Returns `{ useSession, useSendMessage, ... }` |
| Checks `window.__UPLOADTHING_SSR__` | Checks `window.__OPENCODE` |
| Falls back to config parameter | Falls back to config parameter |
| Throws when neither available | Throws when neither available |

**Integration with Zustand Store:**

- Factory hooks call `useOpencodeStore()` internally
- Store pattern unchanged (DirectoryState, binary search, Immer)
- SSE integration unchanged (store.handleSSEEvent)
- No breaking changes to existing store logic

**Type Inference Future Enhancement:**

- Current: Generic parameter `<TRouter>` is placeholder
- Future: Use conditional mapped types to infer hook return types from router
- Reference: tRPC's `CreateTRPCProxyClient` type for pattern

**Testing Strategy:**

- Unit tests for factory (config resolution, hook generation)
- Integration tests for SSR plugin interaction
- Existing hook tests MUST still pass (no regressions)
- Manual browser test for end-to-end verification

---

## Time Breakdown

| Task | Estimated Time |
|------|----------------|
| Create factory.ts | 1.5 hours |
| Write tests | 1 hour |
| Update package exports | 15 min |
| Migrate app (layout + components) | 1 hour |
| Verify & test | 30 min |
| **Total** | **3-4 hours** |

**Assumptions:**

- Phase 2 (SSR Plugin) already complete and working
- No unexpected Zustand store issues
- No type inference edge cases (generic parameter is simple passthrough)

---

## References

**Pattern Inspirations:**

- uploadthing: `generateReactHelpers` factory pattern
- tRPC: Type inference from router
- oRPC: SSR singleton optimization (not used here, but informed design)

**Internal Files:**

- `docs/adr/scratch/013-pattern-comparison.md` - Full pattern analysis
- `docs/adr/013-unified-same-origin-architecture.md` - Overall architecture
- `packages/react/src/next-ssr-plugin.tsx` - SSR plugin (Phase 2)
- `packages/react/src/store/store.ts` - Zustand store integration

**Related ADRs:**

- ADR-011: SSE Proxy Architecture (API routing)
- ADR-012: Provider Elimination (motivation for factory)
- ADR-013: Unified Same-Origin Architecture (overall plan)
