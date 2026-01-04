# ADR 007: Nuclear Migration Plan - Zustand Store Deletion

**Status:** ✅ COMPLETE (Superseded by ADR-018)  
**Date:** 2025-12-29 (Completed: 2025-12-30, Superseded: 2026-01-04)  
**Context:** Post-Effect migration, 46 files changed, 3556 deletions, 677 additions

> **Historical Note (2026-01-01)**: This ADR documents the Zustand store removal (commit 8e40992).
> References to `useDeferredValue` throughout this document describe the OLD architecture.
> Current implementation uses jotai atoms with direct Core API calls - no useDeferredValue needed.
> See `docs/audits/USEDEFERRED_VALUE_AUDIT.md` for details.

> **Migration Complete (2026-01-04)**: Zustand elimination is complete. React hooks now delegate to **World Stream** (ADR-018).
> - `useWorld()`, `useWorldSession()`, `useWorldSessionList()` are the primary APIs
> - Zustand SSE handlers disabled for sessions, messages, parts (core data flows through World Stream)
> - Zustand preserved ONLY for UI-local state: ready flag, todos, model limits
> - See ADR-018 for the push-based reactive architecture that replaced the pull-based Zustand pattern

## Definition of Done

**The migration is COMPLETE when these commands pass from repo root:**

```bash
bun run typecheck  # turbo type-check across all packages
bun run build      # turbo build (includes Next.js build)
```

Both commands must exit 0 with no errors.

---

## Executive Summary

The Zustand store (`packages/react/src/store/store.ts`, 874 lines) has been **DELETED**. This was the god object that managed all state via SSE sync. It's gone. The React package has been gutted - 14 hooks deleted, multiple stores removed. Now we rebuild the harness using **packages/core API** as the engine.

**Net change:** -2,879 lines of code. The React package is 80% smaller.

## Architecture Goal

```
┌─────────────────────────────────────────────────────────┐
│                    apps/web (RSC)                       │
│  - Thin wrapper, Server Components where possible       │
│  - Client components only for interactivity             │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              packages/react (Harness)                   │
│  - React hooks wrapping core API                        │
│  - SSE integration with useSSE                          │
│  - UI state management (local component state)          │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               packages/core (Engine)                    │
│  - Promise API (sessions, messages, parts, etc.)        │
│  - Effect Atoms (pure Effect programs)                  │
│  - Router, Discovery, SSE streams                       │
└─────────────────────────────────────────────────────────┘
```

**Principle:** Core = engine (data, logic), React = harness (hooks, SSE), Web = thin wrapper (UI).

---

## What Was Deleted

### Zustand Store (874 lines)
- `packages/react/src/store/store.ts` - **DELETED**
- `packages/react/src/store/binary.ts` - **DELETED** (84 lines)
- `packages/react/src/store/index.ts` - **DELETED** (17 lines)

**What it did:**
- SSE event handling via `handleSSEEvent()` and `handleEvent()`
- Binary search for messages/parts/sessions (O(log n) updates)
- Session status tracking (`sessionStatus` map)
- Context usage tracking (`contextUsage` map)
- Compaction state (`compaction` map)
- Directory initialization (`initDirectory()`)
- Multi-directory support (`directories` map)

**Why it was deleted:**
- God object anti-pattern (874 lines)
- Mixed concerns (data + SSE + status + context + compaction)
- Immer created new references on every update → React.memo useless
- Binary search clever but created new arrays → re-renders

### Subagent Store (212 lines)
- `packages/react/src/stores/subagent-store.ts` - **DELETED**

**What it did:**
- Tracked subagent sessions by parent part ID
- Managed subagent UI state (expanded/collapsed)
- Stored messages/parts for subagent sessions

### Deleted Hooks (14 hooks)

| Hook | Lines | Purpose | What It Used |
|------|-------|---------|--------------|
| `use-session.ts` | 83 | Get session from store | Zustand store, binary search |
| `use-session-status.ts` | 54 | Track running/idle status | Zustand store `sessionStatus` map |
| `use-context-usage.ts` | 116 | Track token usage | Zustand store `contextUsage` map |
| `use-compaction-state.ts` | 83 | Track compaction progress | Zustand store `compaction` map |
| `use-messages-with-parts.ts` | 93 | Combine messages + parts | Zustand store, useDeferredValue |
| `use-multi-server-sse.ts` | 66 | Subscribe to all servers | Called store.handleEvent() |
| `use-subagent.ts` | 29 | Get subagent by part ID | Subagent store |
| `use-subagent-sync.ts` | 118 | Sync subagent SSE events | Subagent store + Zustand store |
| `use-messages-effect.ts` | 92 | Effect-based message loading | MessageAtom |
| `use-parts-effect.ts` | 92 | Effect-based parts loading | PartAtom |
| `use-projects-effect.ts` | 144 | Effect-based projects loading | ProjectAtom |
| `use-providers-effect.ts` | 92 | Effect-based providers loading | ProviderAtom |
| `use-servers-effect.ts` | 158 | Effect-based server discovery | ServerAtom |
| `use-subagents-effect.ts` | 184 | Effect-based subagents loading | SubagentAtom |

**Total deleted:** 1,404 lines of React hooks

### Deleted Library Code
- `packages/react/src/lib/router-stub.ts` - **DELETED** (10 lines)

---

## What Survived

### Core API - Promise-based wrappers (packages/core/src/api/)

All API modules are Promise-based wrappers around Effect atoms.

#### `sessions` API
```typescript
import { sessions } from "@opencode-vibe/core/api"

sessions.list(directory?: string): Promise<Session[]>
sessions.get(id: string, directory?: string): Promise<Session | null>
sessions.create(title?: string, directory?: string): Promise<Session>
sessions.promptAsync(sessionId: string, parts: unknown[], model?: ModelSelection, directory?: string): Promise<void>
sessions.command(sessionId: string, command: string, args: string, directory?: string): Promise<void>
```

#### `messages` API
```typescript
import { messages } from "@opencode-vibe/core/api"

messages.list(sessionId: string, directory?: string): Promise<Message[]>
messages.get(sessionId: string, messageId: string, directory?: string): Promise<Message | null>
```

#### `parts` API
```typescript
import { parts } from "@opencode-vibe/core/api"

parts.list(sessionId: string, directory?: string): Promise<Part[]>
parts.get(sessionId: string, partId: string, directory?: string): Promise<Part | null>
```

#### `providers` API
```typescript
import { providers } from "@opencode-vibe/core/api"

providers.list(): Promise<Provider[]>
```

#### `projects` API
```typescript
import { projects } from "@opencode-vibe/core/api"

projects.list(): Promise<Project[]>
projects.current(): Promise<Project | null>
```

#### `servers` API
```typescript
import { servers } from "@opencode-vibe/core/api"

servers.discover(): Promise<ServerInfo[]>
servers.currentServer(): Promise<ServerInfo>
```

#### `sse` API (Stream-based)
```typescript
import { sse } from "@opencode-vibe/core/api"
import { Effect, Stream } from "effect"

sse.connect(config: SSEConfig): Stream.Stream<GlobalEvent, Error>
sse.connectOnce(config: SSEConfig): Stream.Stream<GlobalEvent, Error>

// Example usage:
const stream = sse.connect({ url: "http://localhost:4056" })
await Effect.runPromise(
  Stream.runForEach(stream, (event) => Effect.sync(() => console.log(event)))
)
```

#### `subagents` API
```typescript
import { subagents } from "@opencode-vibe/core/api"

subagents.create(): Promise<SubagentStateRef>
subagents.getState(stateRef: SubagentStateRef): Promise<SubagentState>
subagents.registerSubagent(stateRef, childSessionId, parentSessionId, parentPartId, agentName): Promise<void>
subagents.updateParentPartId(stateRef, childSessionId, parentPartId): Promise<void>
subagents.addMessage(stateRef, sessionId, message): Promise<void>
subagents.updateMessage(stateRef, sessionId, message): Promise<void>
subagents.addPart(stateRef, sessionId, messageId, part): Promise<void>
subagents.updatePart(stateRef, sessionId, messageId, part): Promise<void>
subagents.setStatus(stateRef, sessionId, status): Promise<void>
subagents.toggleExpanded(stateRef, partId): Promise<void>
subagents.isExpanded(stateRef, partId): Promise<boolean>
subagents.getByParentPart(stateRef, partId): Promise<SubagentSession | undefined>
subagents.getSessions(stateRef): Promise<Record<string, SubagentSession>>
subagents.getPartToSession(stateRef): Promise<Record<string, string>>
```

#### `commands` API
```typescript
import { commands } from "@opencode-vibe/core/api"

commands.list(directory?: string): Promise<CustomCommand[]>
```

#### `prompt` API (Utility functions)
```typescript
import { prompt } from "@opencode-vibe/core/api"

prompt.insertFilePart(parts, path, atPosition, replaceLength): { parts, cursorPosition }
prompt.navigateAutocomplete(currentIndex, direction, itemsLength): number
```

### Effect Atoms - Pure Effect programs (packages/core/src/atoms/)

All atoms are pure Effect programs. React hooks call the Promise API, which wraps these.

```typescript
import { 
  SessionAtom, 
  MessageAtom, 
  PartAtom, 
  ServerAtom, 
  SSEAtom, 
  ProviderAtom, 
  ProjectAtom, 
  PromptUtil, 
  SubagentAtom, 
  CommandAtom 
} from "@opencode-vibe/core/atoms"

// Example: SessionAtom.list returns Effect.Effect<Session[], Error>
// Promise API wraps it: Effect.runPromise(SessionAtom.list(directory))
```

### React Hooks - What Still Exists

**Migrated hooks (using API pattern):**
- `useSSE` - SSE connection management (lines: ~128, uses `sse.connect()`)
- `useMessages` - Message loading (lines: ~114, uses `messages.list()`)
- `useParts` - Parts loading (uses `parts.list()`)
- `useProjects` / `useCurrentProject` - Project data (uses `projects.list()`, `projects.current()`)
- `useServers` / `useCurrentServer` - Server discovery (uses `servers.discover()`, `servers.currentServer()`)
- `useSessionList` - Session listing (uses `sessions.list()`)
- `useSubagents` - Subagent management (uses `subagents.*` API)

**Legacy hooks (still using old caller pattern, need migration):**
- `useCreateSession` - Session creation
- `useProvider` - Single provider
- `useSendMessage` - Send message with model selection
- `useProviders` - Providers list
- `useFileSearch` - File search
- `useLiveTime` - Live timestamp updates
- `useCommands` - Custom commands

### React Providers
- `OpencodeProvider` - Context provider for directory + baseUrl
- `SSEProvider` - SSE connection context (if needed separately)

---

## Type Errors - Full List (33 errors)

### Category 1: Missing Zustand Store (7 errors)

**Error:** `useOpencodeStore` does not exist (replaced by `useOpencode`)

**Files:**
1. `src/app/projects-list.tsx:15` - imports `useOpencodeStore`
2. `src/app/session/[id]/debug-panel.tsx:4` - imports `useOpencodeStore`
3. `src/app/session/[id]/session-layout.test.tsx:14` - imports `useOpencodeStore`
4. `src/app/session/[id]/session-layout.tsx:16` - imports `useOpencodeStore`
5. `src/app/session/[id]/session-messages.test.tsx:14` - imports `useOpencodeStore`
6. `src/app/session/[id]/session-messages.tsx:5` - imports `useOpencodeStore`

**Error:** `SessionStatusType` does not exist

**Files:**
7. `src/app/projects-list.tsx:16` - imports `SessionStatusType`

### Category 2: Deleted Hooks (9 errors)

**Hook:** `useSession` (deleted)

**Files:**
1. `src/app/session/[id]/session-layout.tsx:9` - imports `useSession`

**Hook:** `useSessionStatus` (deleted)

**Files:**
2. `src/app/session/[id]/session-layout.tsx:13` - imports `useSessionStatus`
3. `src/app/session/[id]/session-messages.tsx:5` - imports `useSessionStatus`
4. `src/app/session/[id]/session-status.tsx:17` - imports `useSessionStatus`

**Hook:** `useMultiServerSSE` (deleted)

**Files:**
5. `src/app/projects-list.tsx:18` - imports `useMultiServerSSE`
6. `src/app/session/[id]/session-layout.tsx:14` - imports `useMultiServerSSE`

**Hook:** `useSubagentSync` (deleted)

**Files:**
7. `src/app/session/[id]/session-layout.tsx:15` - imports `useSubagentSync`

**Hook:** `useSubagent` (deleted)

**Files:**
8. `src/components/ai-elements/tool.tsx:22` - imports `useSubagent`

**Hook:** `useMessagesWithParts` (deleted)

**Files:**
9. `src/app/session/[id]/debug-panel.tsx:4` - imports `useMessagesWithParts`
10. `src/app/session/[id]/session-messages.tsx:5` - imports `useMessagesWithParts`

### Category 3: Other Deleted Features (4 errors)

**Hook:** `useServersEffect` (deleted)

**Files:**
1. `src/app/server-status.tsx:10` - imports `useServersEffect`

**Hook:** `useCompactionState` (deleted)

**Files:**
2. `src/app/session/[id]/compaction-indicator.tsx:3` - imports `useCompactionState`

**Hook:** `useContextUsage` + `formatTokens` (deleted)

**Files:**
3. `src/app/session/[id]/context-usage.tsx:3` - imports `useContextUsage`, `formatTokens`

### Category 4: API Changes (13 errors)

**Error:** `useSSE` API changed - no `subscribe()` method, wrong signature

**Files:**
1. `src/app/projects-list.tsx:327` - calls `subscribe()` on UseSSEReturn (doesn't exist)
2. `src/app/projects-list.tsx:327` - calls `subscribe()` with 0 args (expects 1)
3. `src/app/projects-list.tsx:334` - `event` param has implicit `any` type
4. `src/app/session/[id]/session-status.tsx:32` - calls `subscribe()` on UseSSEReturn
5. `src/app/session/[id]/session-status.tsx:32` - calls `subscribe()` with 0 args

**Error:** `useMessages` API changed - returns object not array, different signature

**Files:**
6. `src/app/session/[id]/debug-panel.tsx:28` - passes string instead of `UseMessagesOptions` object
7. `src/app/session/[id]/debug-panel.tsx:89` - calls `.length` on `UseMessagesReturn` (not array)
8. `src/app/session/[id]/debug-panel.tsx:220` - calls `.length` on `UseMessagesReturn`
9. `src/app/session/[id]/session-layout.tsx:146` - passes string instead of `UseMessagesOptions` object
10. `src/app/session/[id]/session-layout.tsx:194` - calls `.length` on `UseMessagesReturn`

**Error:** `useProviders` API changed - no `isLoading` property

**Files:**
11. `src/app/session/[id]/model-selector.tsx:40` - accesses `.isLoading` on `UseProvidersReturn`

**Error:** Wrong argument count

**Files:**
12. `src/app/projects-list.tsx:217` - calls function with 0 args (expects 1)

---

## Migration Tasks - Granular Checklist

### Phase 1: Rebuild Missing React Hooks (packages/react/src/hooks/)

All new hooks follow the **API pattern**: call Promise API from `@opencode-vibe/core/api`, manage loading/error state locally.

#### Task 1.1: Create `use-session.ts`
**File:** `packages/react/src/hooks/use-session.ts`

**Signature:**
```typescript
export interface UseSessionOptions {
  sessionId: string
  directory?: string
}

export interface UseSessionReturn {
  session: Session | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useSession(options: UseSessionOptions): UseSessionReturn
```

**Implementation:**
1. Call `sessions.get(sessionId, directory)` on mount and when deps change
2. Manage `loading` state (true while fetching)
3. Manage `error` state (null or Error)
4. Return `{ session, loading, error, refetch }`
5. Listen to SSE events for real-time updates (via `useSSE`)
6. Update local state when SSE event matches sessionId

**Core API used:** `sessions.get()`

**Tests:** Create `use-session.test.ts` with:
- Initial load succeeds
- Loading state during fetch
- Error handling
- SSE update triggers re-render
- Refetch works

---

#### Task 1.2: Create `use-session-status.ts`
**File:** `packages/react/src/hooks/use-session-status.ts`

**Signature:**
```typescript
export interface UseSessionStatusOptions {
  sessionId: string
  directory?: string
}

export interface SessionStatus {
  running: boolean
  isLoading: boolean
  status?: "running" | "pending" | "completed" | "error"
}

export function useSessionStatus(options: UseSessionStatusOptions): SessionStatus
```

**Implementation:**
1. Call `sessions.get(sessionId, directory)` to get initial status
2. Subscribe to SSE events filtered by `sessionId` and event type `session.status`
3. Update local state when status changes
4. Return `{ running, isLoading, status }`

**Core API used:** `sessions.get()`, SSE events

**Tests:** Create `use-session-status.test.ts` with:
- Initial status from session.get
- SSE update changes status
- Running state derived from status
- isLoading true until first status

---

#### Task 1.3: Create `use-context-usage.ts`
**File:** `packages/react/src/hooks/use-context-usage.ts`

**Signature:**
```typescript
export interface UseContextUsageOptions {
  sessionId: string
  directory?: string
}

export interface ContextUsageState {
  used: number
  limit: number
  percentage: number
  remaining: number
  isNearLimit: boolean
  tokens: {
    input: number
    output: number
    cached: number
  }
}

export function useContextUsage(options: UseContextUsageOptions): ContextUsageState

export function formatTokens(n: number): string
```

**Implementation:**
1. Subscribe to SSE events filtered by `sessionId` and event type `context.usage`
2. Update local state when context usage changes
3. Calculate derived values: `percentage`, `remaining`, `isNearLimit`
4. Return full `ContextUsageState`
5. Export `formatTokens()` utility (same as old version)

**Core API used:** SSE events only (no Promise API for context usage)

**Default state:**
```typescript
const DEFAULT_STATE: ContextUsageState = {
  used: 0,
  limit: 0,
  percentage: 0,
  remaining: 0,
  isNearLimit: false,
  tokens: { input: 0, output: 0, cached: 0 },
}
```

**Tests:** Create `use-context-usage.test.ts` with:
- Default state before SSE event
- SSE update populates state
- Percentage calculated correctly
- isNearLimit true when >80%
- formatTokens formats correctly

---

#### Task 1.4: Create `use-compaction-state.ts`
**File:** `packages/react/src/hooks/use-compaction-state.ts`

**Signature:**
```typescript
export interface UseCompactionStateOptions {
  sessionId: string
  directory?: string
}

export type CompactionProgress = "pending" | "generating" | "complete"

export interface CompactionState {
  isCompacting: boolean
  isAutomatic: boolean
  progress: CompactionProgress
  startedAt: number
}

export function useCompactionState(options: UseCompactionStateOptions): CompactionState
```

**Implementation:**
1. Subscribe to SSE events filtered by `sessionId` and event type `compaction.*`
2. Update local state when compaction state changes
3. Return `{ isCompacting, isAutomatic, progress, startedAt }`

**Core API used:** SSE events only

**Default state:**
```typescript
const DEFAULT_STATE: CompactionState = {
  isCompacting: false,
  isAutomatic: false,
  progress: "complete",
  startedAt: 0,
}
```

**Tests:** Create `use-compaction-state.test.ts` with:
- Default state before SSE event
- SSE update sets isCompacting
- Progress transitions: pending → generating → complete
- isAutomatic flag

---

#### Task 1.5: Create `use-messages-with-parts.ts`
**File:** `packages/react/src/hooks/use-messages-with-parts.ts`

**Signature:**
```typescript
export interface UseMessagesWithPartsOptions {
  sessionId: string
  directory?: string
}

export interface OpencodeMessage {
  info: Message
  parts: Part[]
}

export function useMessagesWithParts(options: UseMessagesWithPartsOptions): OpencodeMessage[]
```

**Implementation:**
1. Call `useMessages({ sessionId, directory })` to get messages
2. For each message, call `parts.list(sessionId, directory)` to get parts (or subscribe via SSE)
3. Combine into `OpencodeMessage[]` format
4. Use `useMemo` to avoid unnecessary recalculations
5. **PERFORMANCE:** Consider `useDeferredValue` for streaming updates (same as old hook)

**Core API used:** `messages.list()`, `parts.list()`, SSE events

**Tests:** Create `use-messages-with-parts.test.ts` with:
- Combines messages and parts correctly
- Empty parts array when no parts
- Memoization prevents recalculation
- SSE updates trigger re-render

---

#### Task 1.6: Create `use-multi-server-sse.ts`
**File:** `packages/react/src/hooks/use-multi-server-sse.ts`

**Signature:**
```typescript
export function useMultiServerSSE(): void
```

**Implementation:**
1. Call `servers.discover()` to get all servers
2. For each server, call `useSSE({ url: server.url })` (or manage multiple SSE connections)
3. Aggregate events from all servers
4. **ALTERNATIVE:** Use existing `useSSE` and rely on server discovery at network level
5. This hook may be **unnecessary** if `useSSE` already handles multi-server

**Core API used:** `servers.discover()`, `sse.connect()`

**Decision needed:** Is multi-server SSE still required, or does the new architecture handle it differently?

**Tests:** Create `use-multi-server-sse.test.ts` with:
- Discovers multiple servers
- Subscribes to each server
- Events from all servers received

---

#### Task 1.7: Create `use-subagent.ts`
**File:** `packages/react/src/hooks/use-subagent.ts`

**Signature:**
```typescript
export interface UseSubagentOptions {
  partId: string
}

export interface UseSubagentReturn {
  subagent: SubagentSession | undefined
  isExpanded: boolean
  toggleExpanded: () => void
  hasSubagent: boolean
  isRunning: boolean
  isCompleted: boolean
}

export function useSubagent(options: UseSubagentOptions): UseSubagentReturn
```

**Implementation:**
1. Create subagent state ref via `subagents.create()` (or get from context)
2. Call `subagents.getByParentPart(stateRef, partId)` to get subagent session
3. Call `subagents.isExpanded(stateRef, partId)` to get expansion state
4. Return `{ subagent, isExpanded, toggleExpanded, hasSubagent, isRunning, isCompleted }`
5. Derive `hasSubagent`, `isRunning`, `isCompleted` from `subagent`

**Core API used:** `subagents.*` API

**Tests:** Create `use-subagent.test.ts` with:
- Returns undefined when no subagent
- Returns subagent when exists
- toggleExpanded updates state
- Derived values correct

---

#### Task 1.8: Create `use-subagent-sync.ts`
**File:** `packages/react/src/hooks/use-subagent-sync.ts`

**Signature:**
```typescript
export interface UseSubagentSyncOptions {
  sessionId: string
  directory?: string
}

export function useSubagentSync(options: UseSubagentSyncOptions): void
```

**Implementation:**
1. Create subagent state ref via `subagents.create()` (or get from context)
2. Subscribe to SSE events filtered by `sessionId`
3. When subagent events arrive, call appropriate `subagents.*` API methods:
   - `subagents.registerSubagent()` for new subagent
   - `subagents.addMessage()` for new message
   - `subagents.updateMessage()` for message update
   - `subagents.addPart()` for new part
   - `subagents.updatePart()` for part update
   - `subagents.setStatus()` for status change

**Core API used:** `subagents.*` API, SSE events

**Tests:** Create `use-subagent-sync.test.ts` with:
- SSE event registers subagent
- SSE event adds message
- SSE event updates part
- SSE event sets status

---

#### Task 1.9: Migrate `useProviders` to include `isLoading`
**File:** `packages/react/src/hooks/use-providers.ts`

**Current signature:**
```typescript
export interface UseProvidersReturn {
  providers: Provider[]
  models: Model[]
  error: Error | null
}
```

**New signature:**
```typescript
export interface UseProvidersReturn {
  providers: Provider[]
  models: Model[]
  loading: boolean  // ADD THIS
  error: Error | null
}
```

**Implementation:**
1. Add `loading` state (true while fetching)
2. Return `{ providers, models, loading, error }`

**Core API used:** `providers.list()` (already using this)

**Tests:** Update `use-providers.test.ts` with:
- loading true during fetch
- loading false after fetch

---

#### Task 1.10: Create `use-servers-effect.ts` (or rename `use-servers.ts`)
**File:** `packages/react/src/hooks/use-servers-effect.ts` OR update `use-servers.ts`

**Current:** `use-servers.ts` exists and uses Effect atoms

**Issue:** `src/app/server-status.tsx` imports `useServersEffect` but the hook is named `useServers`

**Fix:**
- **Option A:** Export `useServersEffect` as an alias for `useServers`
- **Option B:** Rename `use-servers.ts` to `use-servers-effect.ts`

**Tests:** Ensure existing tests still pass

---

### Phase 2: Fix apps/web Type Errors

#### Task 2.1: Fix `projects-list.tsx`
**File:** `apps/web/src/app/projects-list.tsx`

**Errors:**
1. Line 15: `useOpencodeStore` → `useOpencode`
2. Line 16: `SessionStatusType` → Remove or find replacement
3. Line 18: `useMultiServerSSE` → Import from new location (after Task 1.6)
4. Line 217: Function expects 1 arg → Fix call site
5. Line 327: `subscribe()` doesn't exist on `UseSSEReturn` → Use new SSE API
6. Line 327: `subscribe()` expects 1 arg → Fix call site
7. Line 334: `event` param has implicit `any` type → Add type annotation

**Implementation:**
1. Replace `useOpencodeStore` with `useOpencode`
2. Remove `SessionStatusType` import (or define locally if needed)
3. Import `useMultiServerSSE` from new location
4. Fix SSE subscription to use new API (likely `useSSE` with event filtering)
5. Add type annotation for `event` param

---

#### Task 2.2: Fix `session-layout.tsx`
**File:** `apps/web/src/app/session/[id]/session-layout.tsx`

**Errors:**
1. Line 9: `useSession` → Import from new location (after Task 1.1)
2. Line 13: `useSessionStatus` → Import from new location (after Task 1.2)
3. Line 14: `useMultiServerSSE` → Import from new location (after Task 1.6)
4. Line 15: `useSubagentSync` → Import from new location (after Task 1.8)
5. Line 16: `useOpencodeStore` → `useOpencode`
6. Line 146: `useMessages` signature changed → Pass object not string
7. Line 194: `.length` on `UseMessagesReturn` → Access `.messages.length`

**Implementation:**
1. Import all hooks from new locations
2. Replace `useOpencodeStore` with `useOpencode`
3. Fix `useMessages` call: `useMessages(sessionId)` → `useMessages({ sessionId })`
4. Fix `.length` access: `messages.length` → `messages.messages.length`

---

#### Task 2.3: Fix `session-messages.tsx`
**File:** `apps/web/src/app/session/[id]/session-messages.tsx`

**Errors:**
1. Line 5: `useMessagesWithParts` → Import from new location (after Task 1.5)
2. Line 5: `useSessionStatus` → Import from new location (after Task 1.2)
3. Line 5: `useOpencodeStore` → `useOpencode`

**Implementation:**
1. Import hooks from new locations
2. Replace `useOpencodeStore` with `useOpencode`

---

#### Task 2.4: Fix `debug-panel.tsx`
**File:** `apps/web/src/app/session/[id]/debug-panel.tsx`

**Errors:**
1. Line 4: `useOpencodeStore` → `useOpencode`
2. Line 4: `useMessagesWithParts` → Import from new location (after Task 1.5)
3. Line 28: `useMessages` signature changed → Pass object not string
4. Line 89: `.length` on `UseMessagesReturn` → Access `.messages.length`
5. Line 220: `.length` on `UseMessagesReturn` → Access `.messages.length`

**Implementation:**
1. Replace `useOpencodeStore` with `useOpencode`
2. Import `useMessagesWithParts` from new location
3. Fix `useMessages` call: `useMessages(sessionId)` → `useMessages({ sessionId })`
4. Fix `.length` access

---

#### Task 2.5: Fix `session-status.tsx`
**File:** `apps/web/src/app/session/[id]/session-status.tsx`

**Errors:**
1. Line 17: `useSessionStatus` → Import from new location (after Task 1.2)
2. Line 32: `subscribe()` doesn't exist on `UseSSEReturn` → Use new SSE API
3. Line 32: `subscribe()` expects 1 arg → Fix call site

**Implementation:**
1. Import `useSessionStatus` from new location
2. Fix SSE subscription to use new API

---

#### Task 2.6: Fix `compaction-indicator.tsx`
**File:** `apps/web/src/app/session/[id]/compaction-indicator.tsx`

**Errors:**
1. Line 3: `useCompactionState` → Import from new location (after Task 1.4)

**Implementation:**
1. Import `useCompactionState` from new location

---

#### Task 2.7: Fix `context-usage.tsx`
**File:** `apps/web/src/app/session/[id]/context-usage.tsx`

**Errors:**
1. Line 3: `useContextUsage` → Import from new location (after Task 1.3)
2. Line 3: `formatTokens` → Import from new location (after Task 1.3)

**Implementation:**
1. Import `useContextUsage` and `formatTokens` from new location

---

#### Task 2.8: Fix `model-selector.tsx`
**File:** `apps/web/src/app/session/[id]/model-selector.tsx`

**Errors:**
1. Line 40: `.isLoading` doesn't exist on `UseProvidersReturn` → Use after Task 1.9

**Implementation:**
1. Wait for Task 1.9 to add `isLoading` to `UseProvidersReturn`
2. No code changes needed after that

---

#### Task 2.9: Fix `server-status.tsx`
**File:** `apps/web/src/app/server-status.tsx`

**Errors:**
1. Line 10: `useServersEffect` → Fix after Task 1.10

**Implementation:**
1. Wait for Task 1.10 to export `useServersEffect`
2. No code changes needed after that

---

#### Task 2.10: Fix `tool.tsx`
**File:** `apps/web/src/components/ai-elements/tool.tsx`

**Errors:**
1. Line 22: `useSubagent` → Import from new location (after Task 1.7)

**Implementation:**
1. Import `useSubagent` from new location

---

#### Task 2.11: Fix test files
**Files:**
- `apps/web/src/app/session/[id]/session-layout.test.tsx`
- `apps/web/src/app/session/[id]/session-messages.test.tsx`

**Errors:**
1. Both import `useOpencodeStore` → Replace with `useOpencode` or mock new API

**Implementation:**
1. Update test mocks for new API
2. Replace `useOpencodeStore` with appropriate mocks

---

### Phase 3: Update Package Exports

#### Task 3.1: Update `packages/react/src/index.ts`
**File:** `packages/react/src/index.ts`

**Add exports:**
```typescript
// New hooks from Phase 1
export { useSession, type UseSessionOptions, type UseSessionReturn } from "./hooks/use-session"
export { useSessionStatus, type UseSessionStatusOptions, type SessionStatus } from "./hooks/use-session-status"
export { useContextUsage, type UseContextUsageOptions, type ContextUsageState, formatTokens } from "./hooks/use-context-usage"
export { useCompactionState, type UseCompactionStateOptions, type CompactionState, type CompactionProgress } from "./hooks/use-compaction-state"
export { useMessagesWithParts, type UseMessagesWithPartsOptions, type OpencodeMessage } from "./hooks/use-messages-with-parts"
export { useMultiServerSSE } from "./hooks/use-multi-server-sse"
export { useSubagent, type UseSubagentOptions, type UseSubagentReturn } from "./hooks/use-subagent"
export { useSubagentSync, type UseSubagentSyncOptions } from "./hooks/use-subagent-sync"
export { useServersEffect } from "./hooks/use-servers-effect" // OR update use-servers.ts

// Re-export types that were on store
export type SessionStatusType = "running" | "pending" | "completed" | "error"
```

---

### Phase 4: Testing & Verification

#### Task 4.1: Run typecheck
```bash
bun run typecheck
```

**Success criteria:** 0 type errors

---

#### Task 4.2: Run tests
```bash
bun test
```

**Success criteria:** All tests pass

---

#### Task 4.3: Manual testing
1. Start dev server: `bun dev`
2. Test projects list page
3. Test session view page
4. Test message streaming
5. Test subagent display
6. Test context usage indicator
7. Test compaction indicator
8. Test model selector

---

### Phase 5: Performance Optimization (Post-Migration)

#### Task 5.1: Review useDeferredValue usage
**Consideration:** Old `useMessagesWithParts` used `useDeferredValue` for streaming performance

**Implementation:**
1. Test streaming performance in new `useMessagesWithParts`
2. Add `useDeferredValue` if streaming causes lag
3. Measure re-render count during streaming

---

#### Task 5.2: Review memoization
**Consideration:** Old hooks used `useMemo`, `useShallow` extensively

**Implementation:**
1. Add `useMemo` for expensive computations in new hooks
2. Use `React.memo` for components with stable props
3. Profile with React DevTools

---

#### Task 5.3: Review SSE subscription strategy
**Consideration:** Old store had single SSE subscription, new hooks may subscribe individually

**Implementation:**
1. Ensure only one SSE connection per server
2. Share SSE events across hooks (via context or singleton)
3. Test reconnection logic

---

## Success Criteria

### Type Safety
- ✅ `bun run typecheck` exits 0
- ✅ No type errors in `apps/web`
- ✅ All React hooks have correct signatures

### Functionality
- ✅ Session list loads and updates in real-time
- ✅ Session view displays messages with parts
- ✅ Message streaming works
- ✅ Subagent sessions display correctly
- ✅ Context usage indicator updates
- ✅ Compaction indicator shows progress
- ✅ Model selector shows providers
- ✅ Server status shows discovered servers

### Performance
- ✅ No unnecessary re-renders during streaming
- ✅ SSE reconnection works
- ✅ Message list scrolls smoothly

### Tests
- ✅ All existing tests pass
- ✅ New hooks have test coverage
- ✅ Integration tests for SSE sync

---

## Non-Negotiables

1. **TDD for all new hooks** - Write failing test first, make it pass, refactor
2. **Fix broken shit** - If you encounter type errors, fix them (no "pre-existing issues")
3. **API pattern consistency** - All hooks call Promise API, manage state locally
4. **No premature optimization** - Get it working first, optimize later (Phase 5)
5. **Export everything** - Types, hooks, utilities - make them reusable

---

## Open Questions

### Q1: Multi-server SSE still needed?
**Context:** Old `useMultiServerSSE` discovered all servers and subscribed to each

**Options:**
- A) Keep multi-server pattern (Task 1.6)
- B) Rely on server-side aggregation
- C) Use single server discovery, let router handle multi-server

**Decision:** TBD

### Q2: Subagent state management
**Context:** Old subagent store was separate from main store

**Options:**
- A) Keep subagent state in separate context (using `subagents.create()`)
- B) Integrate subagent state into session state
- C) Use local component state for subagent UI

**Decision:** TBD (Task 1.7/1.8 implementation will clarify)

### Q3: SSE subscription strategy
**Context:** Old store had single SSE subscription, new hooks may subscribe individually

**Options:**
- A) Single SSE connection, events distributed via context
- B) Each hook subscribes independently (multiple connections)
- C) Hybrid: SSE Provider + individual filters

**Decision:** TBD (Task 1.6 implementation will clarify)

---

## Dependencies

### External Packages
- `effect` - Already installed, used by core atoms
- `zustand` - Can be removed after migration (no longer used)
- `@opencode-ai/sdk` - Already installed, used for types

### Internal Packages
- `@opencode-vibe/core` - All Promise API and Effect atoms exist
- `@opencode-vibe/react` - Being rebuilt in this migration

---

## Timeline Estimate

**Phase 1 (Hooks):** 8 tasks × 30min = 4 hours  
**Phase 2 (Fix web):** 11 tasks × 15min = 2.75 hours  
**Phase 3 (Exports):** 1 task × 15min = 15 minutes  
**Phase 4 (Testing):** 3 tasks × 30min = 1.5 hours  
**Phase 5 (Optimization):** 3 tasks × 1hr = 3 hours  

**Total:** ~11.5 hours (1.5 work days)

---

## Notes for Future Agent

**What you're inheriting:**
- Core API is complete and tested
- React package is gutted (only 7 hooks remain)
- 33 type errors in apps/web waiting to be fixed
- No Zustand store to lean on - you're building the harness from scratch

**Strategy:**
1. **Don't read apps/web code first** - it's broken and will confuse you
2. **Start with Phase 1 Task 1.1** - build `useSession` with TDD
3. **Follow the checklist** - each task is granular and independent
4. **Fix type errors as you go** - don't wait for Phase 2
5. **Test in isolation** - each hook should work standalone

**Gotchas:**
- SSE events need filtering by sessionId/directory
- Subagent state is an Effect `Ref` - use Promise API wrappers
- Messages/parts need combining into `OpencodeMessage` format
- Context usage/compaction are SSE-only (no Promise API)
- Session status comes from both `sessions.get()` AND SSE events

**Good luck. The plane is not landed until `bun run typecheck` exits 0.**
