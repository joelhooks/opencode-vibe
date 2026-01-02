# @opencode-vibe/react

## 0.4.0

### Minor Changes

- [`5131e7f`](https://github.com/joelhooks/opencode-vibe/commit/5131e7f25100a93f80bf23f0d93858db7049bef9) Thanks [@joelhooks](https://github.com/joelhooks)! - feat(react): implement SSR plugin for provider-free hooks (ADR-013 Phase 2)

  ```
      🦋 THE GREAT PROVIDER PURGE 🦋

          ⋆ ˚｡⋆୨♡୧⋆ ˚｡⋆
      ,.  _~-.,               .
     ~'`~ \/,_. ~=.,,,.,,,   /|,
          /   '-._  /'   '\\=~
         |  \     \|        |
          \  '=.,_/         |
           '-.,_   '~-.,_  /
                '~.,_    '~

      BEFORE:                    AFTER:
      ┌──────────────────┐      ┌──────────────────┐
      │ <Provider>       │      │ <SSRPlugin />    │
      │   <Provider>     │  →   │ {children}       │
      │     <Provider>   │      └──────────────────┘
      │       {children} │
      │     </Provider>  │      Zero ceremony.
      │   </Provider>    │      Zero wrappers.
      │ </Provider>      │      Just works.
      └──────────────────┘
  ```

  > "Simplicity is prerequisite for reliability."
  > — Dijkstra

  Implements uploadthing-inspired factory + SSR plugin pattern:

  - `<OpencodeSSRPlugin>` injects config via `useServerInsertedHTML`
  - `generateOpencodeHelpers()` creates hooks that read from `globalThis`
  - Zero hydration delay, zero provider wrappers, works in RSC

- [`fd68a7d`](https://github.com/joelhooks/opencode-vibe/commit/fd68a7d9417b67caf411806d09cbdcb4b0486c29) Thanks [@joelhooks](https://github.com/joelhooks)! - feat: architecture investigation and multi-directory support

  ```
      ╔═══════════════════════════════════════════════════════════╗
      ║   🏗️ ARCHITECTURE DEEP DIVE COMPLETE 🏗️                   ║
      ╠═══════════════════════════════════════════════════════════╣
      ║                                                           ║
      ║   ┌─────────────────────────────────────────────────┐     ║
      ║   │  ADR-015: Event Architecture Simplification     │     ║
      ║   │  • Router: 4,377 LOC confirmed DEAD             │     ║
      ║   │  • Factory: 1,160 LOC verified                  │     ║
      ║   │  • 8 core gaps identified                       │     ║
      ║   │  • 31% reduction potential (4,971 LOC)          │     ║
      ║   └─────────────────────────────────────────────────┘     ║
      ║                                                           ║
      ║   ┌─────────────────────────────────────────────────┐     ║
      ║   │  ADR-016: Core Layer Responsibility             │     ║
      ║   │  • Model B: Smart Boundary (RECOMMENDED)        │     ║
      ║   │  • Core = Computed APIs + Effect services       │     ║
      ║   │  • React = UI binding only                      │     ║
      ║   │  • Router = DEPRECATED                          │     ║
      ║   └─────────────────────────────────────────────────┘     ║
      ║                                                           ║
      ╚═══════════════════════════════════════════════════════════╝
  ```

  > "The purpose of abstraction is not to be vague, but to create
  > a new semantic level in which one can be absolutely precise."
  > — Dijkstra

  ## Core Layer

  - Enhanced SSE with heartbeat support (mobile Safari 30s timeout fix)
  - Improved connection state management with reconnection logic
  - Added events.ts for SSE event type definitions
  - Directory-scoped client creation

  ## React Layer

  - New multi-directory hooks: `useMultiDirectorySessions`, `useMultiDirectoryStatus`
  - New SSE state hook: `useSSEState`
  - Bootstrap utilities with retry logic
  - Status derivation utilities (3-source session status)
  - Improved factory hook composition
  - Batch update support in store

  ## Documentation

  - ADR-015: Event Architecture Simplification (verified via 5-worker swarm)
  - ADR-016: Core Layer Responsibility Model
  - 8 investigation documents
  - 3 audit documents

- [`8321b6f`](https://github.com/joelhooks/opencode-vibe/commit/8321b6fb905a859c4e316db0d8f92d177906a372) Thanks [@joelhooks](https://github.com/joelhooks)! - feat: ADR-016 Core Layer Responsibility Model - Smart Boundaries

  ```
      ╔══════════════════════════════════════════════════════════════╗
      ║                                                              ║
      ║   ┌─────────────────────────────────────────────────────┐    ║
      ║   │  BEFORE: React does everything                      │    ║
      ║   │  ┌───────────────────────────────────────────────┐  │    ║
      ║   │  │  REACT (bloated 840 LOC business logic)       │  │    ║
      ║   │  │  • Status computation                         │  │    ║
      ║   │  │  • Data joining                               │  │    ║
      ║   │  │  • Token formatting                           │  │    ║
      ║   │  │  • SSE normalization                          │  │    ║
      ║   │  └───────────────────────────────────────────────┘  │    ║
      ║   │                      ▼                              │    ║
      ║   │  ┌───────────────────────────────────────────────┐  │    ║
      ║   │  │  CORE (thin wrapper + 4,377 LOC dead router)  │  │    ║
      ║   │  └───────────────────────────────────────────────┘  │    ║
      ║   └─────────────────────────────────────────────────────┘    ║
      ║                                                              ║
      ║                          ⬇️  ⬇️  ⬇️                           ║
      ║                                                              ║
      ║   ┌─────────────────────────────────────────────────────┐    ║
      ║   │  AFTER: Smart Boundaries                            │    ║
      ║   │  ┌───────────────────────────────────────────────┐  │    ║
      ║   │  │  REACT (lean - UI binding only)               │  │    ║
      ║   │  │  • Hooks call Core APIs                       │  │    ║
      ║   │  │  • Never imports Effect                       │  │    ║
      ║   │  └───────────────────────────────────────────────┘  │    ║
      ║   │                      ▼                              │    ║
      ║   │  ┌───────────────────────────────────────────────┐  │    ║
      ║   │  │  CORE (smart boundary)                        │  │    ║
      ║   │  │  • StatusService     • ContextService         │  │    ║
      ║   │  │  • MessageService    • Format utils           │  │    ║
      ║   │  │  • SSE normalization • Promise APIs           │  │    ║
      ║   │  └───────────────────────────────────────────────┘  │    ║
      ║   └─────────────────────────────────────────────────────┘    ║
      ║                                                              ║
      ║   📉 -4,377 LOC (dead router deleted)                        ║
      ║   📉 -840 LOC moved from React to Core                       ║
      ║   ✅ Effect isolated - React never imports Effect            ║
      ║   ✅ Reusable - CLI/TUI can use Core APIs                    ║
      ║                                                              ║
      ╚══════════════════════════════════════════════════════════════╝
  ```

  > "These responsibilities should tell a story of the high-level purpose
  > and design of your system. Refactor the model so that the responsibilities
  > of each domain object fit neatly within stated responsibility."
  > — Eric Evans, Domain-Driven Design

  ## What Changed

  ### Core Layer (`@opencode-vibe/core`)

  **New Effect Services:**

  - `StatusService` - Session status computation (3-source logic)
  - `MessageService` - Messages + Parts join (eliminates client-side joins)
  - `ContextService` - Token usage computation

  **New APIs:**

  - `sessions.getStatus()` - Computed session status
  - `sessions.listWithStatus()` - Sessions with status pre-joined
  - `messages.listWithParts()` - Messages with parts pre-joined
  - `prompt.convertToApiParts()` - Prompt transformation

  **New Utils:**

  - `formatRelativeTime()` - "5m ago" formatting (SSR-safe)
  - `formatTokens()` - "1.5K" token formatting
  - `normalizeStatus()` - SSE status normalization

  **Deleted:**

  - `packages/core/src/router/` - 4,377 LOC of dead code (0 invocations)

  ### React Layer (`@opencode-vibe/react`)

  **Simplified Hooks:**

  - `useSessionStatus` - Now uses Core's StatusService
  - `useMessagesWithParts` - Reads from SSE-populated store
  - `useContextUsage` - Reads from SSE-populated store
  - `useSendMessage` - Uses Core's prompt.convertToApiParts

  **Effect Isolation:**

  - React NEVER imports Effect types
  - All Effect programs wrapped with `runWithRuntime()`
  - Promise-based APIs at the boundary

  ## Migration

  No breaking changes. Existing code continues to work.

  Internal refactor moves computation from React to Core for:

  - Better reusability (CLI, TUI, mobile can use Core)
  - Better testability (pure Effect programs)
  - Better performance (pre-computed data)

- [`8605599`](https://github.com/joelhooks/opencode-vibe/commit/86055995c0b93c36b42f250ca4a5f85b29bb3f7e) Thanks [@joelhooks](https://github.com/joelhooks)! - feat(react): expand factory pattern with 6 new hooks

  ```
      ╔═══════════════════════════════════════════════════════════╗
      ║                                                           ║
      ║   🏭 THE HOOK FACTORY 🏭                                  ║
      ║                                                           ║
      ║      ┌─────────────────────────────────────────┐          ║
      ║      │  generateOpencodeHelpers()              │          ║
      ║      │  ═══════════════════════════════════    │          ║
      ║      │                                         │          ║
      ║      │  📦 INPUT: globalThis.__OPENCODE        │          ║
      ║      │                                         │          ║
      ║      │  🎣 OUTPUT:                             │          ║
      ║      │    ├── useSession                       │          ║
      ║      │    ├── useMessages                      │          ║
      ║      │    ├── useSendMessage                   │          ║
      ║      │    ├── useSessionList      ✨ NEW       │          ║
      ║      │    ├── useProviders        ✨ NEW       │          ║
      ║      │    ├── useProjects         ✨ NEW       │          ║
      ║      │    ├── useCommands         ✨ NEW       │          ║
      ║      │    ├── useCreateSession    ✨ NEW       │          ║
      ║      │    └── useFileSearch       ✨ NEW       │          ║
      ║      │                                         │          ║
      ║      └─────────────────────────────────────────┘          ║
      ║                                                           ║
      ║   "The purpose of abstraction is not to be vague,         ║
      ║    but to create a new semantic level in which            ║
      ║    one can be absolutely precise."                        ║
      ║                        — Dijkstra                         ║
      ║                                                           ║
      ╚═══════════════════════════════════════════════════════════╝
  ```

  ## ADR-013 Phase 3: Factory Hooks Expansion

  Expands the factory pattern from Phase 2 to include all OpenCode hooks.
  Components now import from `@/app/hooks` instead of `@opencode-vibe/react`.

  ### New Hooks in Factory

  - **useSessionList** - Zustand store selector, filters archived sessions
  - **useProviders** - API fetch with loading/error/refetch pattern
  - **useProjects** - API fetch with loading/error/refetch pattern
  - **useCommands** - Wraps base hook with directory config
  - **useCreateSession** - Async session creation
  - **useFileSearch** - Debounced search with fuzzysort

  ### Migration Pattern

  ```tsx
  // Before
  import { useProviders, useCommands } from "@opencode-vibe/react";

  // After
  import { useProviders, useCommands } from "@/app/hooks";
  ```

  ### Files Changed

  - `packages/react/src/factory.ts` - Added 6 new hooks (9 total)
  - `packages/react/src/factory-types.ts` - Type utilities for router mapping
  - `packages/react/src/factory.test.ts` - 22 tests for all hooks
  - `apps/web/src/app/hooks.ts` - Exports all 9 factory hooks
  - 4 components migrated to `@/app/hooks`

### Patch Changes

- [`e9da5e5`](https://github.com/joelhooks/opencode-vibe/commit/e9da5e5b85b865316c648251fd045ccdec98001c) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: real-time UI updates for sessions and Task cards

  ```
      ╔═════════════════════════════════════════════════════════════╗
      ║   ⚡ REAL-TIME REFRESH RESURRECTION ⚡                       ║
      ╠═════════════════════════════════════════════════════════════╣
      ║                                                             ║
      ║   BEFORE:           AFTER:                                  ║
      ║   ┌─────────┐       ┌─────────┐                             ║
      ║   │ Session │       │ Session │ ← Status updates            ║
      ║   │ ??? lag │   →   │ ✓ LIVE  │   instantly visible!        ║
      ║   └─────────┘       └─────────┘                             ║
      ║                                                             ║
      ║   ┌─────────┐       ┌─────────┐                             ║
      ║   │  Task   │       │  Task   │ ← Metadata.summary          ║
      ║   │ frozen  │   →   │ flowing │   updates flow through      ║
      ║   └─────────┘       └─────────┘                             ║
      ║                                                             ║
      ║   Bug 1: Session status stale on projects-list              ║
      ║   Fix: Bootstrap now fetches SDK status immediately         ║
      ║                                                             ║
      ║   Bug 2: Task cards not updating during sub-agent work      ║
      ║   Fix: Memo now checks _opencode metadata on messages       ║
      ║        + Fixed pending→running state transition logic       ║
      ║                                                             ║
      ╚═════════════════════════════════════════════════════════════╝
  ```

  > "Premature optimization is the root of all evil, but we should
  > not pass up opportunities to make things work correctly."
  > — Paraphrasing Knuth on debugging

  ## Fixes

  ### Session Status Lag (projects-list.tsx)

  - Bootstrap now properly fetches SDK status on initialization
  - Live sessions from SSE events now merge correctly with server-rendered sessions
  - Deduplication uses Map to prefer live data over stale initial data

  ### Task Card Real-Time Updates (tool.tsx)

  - Fixed React.memo comparison for Task tool parts
  - Now correctly handles pending→running state transitions
  - Compares `_opencode` metadata when present on messages
  - Sub-agent activity summaries now update in real-time

  ### MessageRenderer Memo (session-messages.tsx)

  - Added `_opencode` metadata to comparison logic
  - Tool invocations and results now trigger proper re-renders
  - Prevents stale UI during AI streaming

- Updated dependencies [[`963a6e9`](https://github.com/joelhooks/opencode-vibe/commit/963a6e969a10365cb2f3d30bcff8367cb3411dd9), [`fd68a7d`](https://github.com/joelhooks/opencode-vibe/commit/fd68a7d9417b67caf411806d09cbdcb4b0486c29), [`8321b6f`](https://github.com/joelhooks/opencode-vibe/commit/8321b6fb905a859c4e316db0d8f92d177906a372), [`e9da5e5`](https://github.com/joelhooks/opencode-vibe/commit/e9da5e5b85b865316c648251fd045ccdec98001c), [`7b21536`](https://github.com/joelhooks/opencode-vibe/commit/7b215363148c474d838b81cd1560a11282483d4b), [`5e5e4e6`](https://github.com/joelhooks/opencode-vibe/commit/5e5e4e690adf9051b047ee297fcb187bc18a3fff)]:
  - @opencode-vibe/core@0.3.0

## 0.3.0

### Minor Changes

- [`9346b09`](https://github.com/joelhooks/opencode-vibe/commit/9346b09f53fbca49638919bc5325380e60b1d6cc) Thanks [@joelhooks](https://github.com/joelhooks)! - ```
  ╔═══════════════════════════════════════════════════════════════╗
  ║ ║
  ║ "Making a system simpler does not necessarily mean ║
  ║ reducing its functionality; it can also mean ║
  ║ removing accidental complexity." ║
  ║ ║
  ║ — Designing Data-Intensive Applications ║
  ║ ║
  ╚═══════════════════════════════════════════════════════════════╝

                      ┌─────────────────────────────────┐
                      │   BEFORE          AFTER         │
                      ├─────────────────────────────────┤
                      │   useFetch        ───────────── │
                      │   useSSEResource  ───────────── │
                      │   useSSEState     ───────────── │
                      │   useSubscription ───────────── │
                      │   6 wrapper hooks → store       │
                      │   ~1800 lines    → 0 lines      │
                      └─────────────────────────────────┘

  ```

  Consolidate React hooks architecture - remove unused abstractions, simplify exports

  **Breaking Changes:**
  - Removed `useFetch`, `useSSEResource`, `useSSEState`, `useSubscription` hooks (unused abstractions)
  - Simplified hook exports - removed redundant type exports that can be inferred
  - Hooks now use store directly instead of layered abstractions

  **Improvements:**
  - `OpenCodeProvider` now handles SSE events, bootstrap, and sync in one place
  - Removed 6 hook files and their tests (~1800 lines deleted)
  - Hooks are simpler: direct store access instead of wrapper patterns
  - Better TypeScript inference - less explicit type annotations needed

  **Core:**
  - Multi-server SSE improvements for better connection handling

  ```

      "If a system contains adjacent layers with similar abstractions,
       this is a red flag that suggests a problem with the class
       decomposition."
                                      — A Philosophy of Software Design

  ```

  ```

- [`45b6bf8`](https://github.com/joelhooks/opencode-vibe/commit/45b6bf8e289d9e62ad949316e51f763412a016f3) Thanks [@joelhooks](https://github.com/joelhooks)! - Add `useSession()` facade hook - unified API for session management

  **New Features:**

  - `useSession(sessionId, options?)` - Single hook replacing 7 internal hooks
  - Wraps: session data, messages, status, send action, context usage, compaction, subagent sync
  - Supports `onMessage` and `onError` callbacks for side effects
  - Automatic directory resolution from context

  **Breaking Changes:**

  - `useSession` renamed to `useSessionData` (the old simple selector)
  - Import `useSessionData` if you only need session metadata

  **Migration:**

  ```tsx
  // Before (6 hooks)
  const { directory } = useOpencode();
  useSubagentSync({ sessionId });
  const session = useSession(sessionId);
  const status = useSessionStatus(sessionId);
  const messages = useMessages(sessionId);
  const { sendMessage, isLoading, error } = useSendMessage({
    sessionId,
    directory,
  });

  // After (1 hook)
  const { data, messages, running, isLoading, sendMessage } = useSession(
    sessionId,
    {
      onError: (err) => toast.error(err.message),
    }
  );
  ```

  **DX Improvements:**

  - Hooks per session page: 11 → 1
  - Lines to render session: 150 → ~15

### Patch Changes

- Updated dependencies [[`9346b09`](https://github.com/joelhooks/opencode-vibe/commit/9346b09f53fbca49638919bc5325380e60b1d6cc)]:
  - @opencode-vibe/core@0.2.1

## 0.2.0

### Minor Changes

- [`e5b8ed2`](https://github.com/joelhooks/opencode-vibe/commit/e5b8ed26a29f0df1399ce75c08ec78fdb65ecbcd) Thanks [@joelhooks](https://github.com/joelhooks)! - Initial release of OpenCode Vibe packages

  - `@opencode-vibe/core`: Framework-agnostic SDK with router, atoms, SSE, and discovery
  - `@opencode-vibe/react`: React bindings with hooks and providers

### Patch Changes

- Updated dependencies [[`e5b8ed2`](https://github.com/joelhooks/opencode-vibe/commit/e5b8ed26a29f0df1399ce75c08ec78fdb65ecbcd)]:
  - @opencode-vibe/core@0.2.0
