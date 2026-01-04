# Zustand→World Stream Migration Status

**Cell:** opencode-next--xts0a-mjz9ld0666h  
**Epic:** opencode-next--xts0a-mjz9lczp75l  
**Date:** 2026-01-04  
**Agent:** RedHawk

## Migration Goal

Eliminate Zustand for core data (sessions, messages, parts). Keep Zustand only for UI-local state.

## What Was Done

### ✅ Phase 1: Create World Stream Hooks

**New Files:**
- `packages/react/src/hooks/use-world-messages-with-parts.ts`
  - Delegates to `useWorld()` for EnrichedMessage[] (messages with parts pre-joined)
  - Pattern matches existing `use-world-messages.ts`

- `packages/react/src/hooks/use-world-session-list.ts`
  - Delegates to `useWorld()` for EnrichedSession[]
  - Returns `world.sessions` directly

### ✅ Phase 2: Migrate Internal Hooks to World Stream

**Modified Files:**

1. **packages/react/src/hooks/internal/use-messages-with-parts.ts**
   - Now delegates to `useWorldMessagesWithParts()`
   - Maintains `OpencodeMessage` interface for backward compat
   - Transforms `EnrichedMessage` → `OpencodeMessage` via useMemo

2. **packages/react/src/hooks/use-session-data.ts**
   - Now delegates to `useWorldSession()`
   - `EnrichedSession` extends `Session`, so type-safe

3. **packages/react/src/hooks/use-session-list.ts**
   - Now delegates to `useWorldSessionList()`
   - `EnrichedSession[]` compatible with `Session[]`

### ✅ Phase 3: Already Complete (Pre-existing)

These hooks were already migrated to World Stream:
- `use-session-status.ts` → delegates to `useWorldSessionStatus`
- `use-context-usage.ts` → delegates to `useWorldContextUsage`
- `use-compaction-state.ts` → delegates to `useWorldCompactionState`

### ✅ Phase 4: Disable Zustand SSE Handlers

**Modified:** `packages/react/src/store/store.ts`

Disabled SSE event handlers for core data (now handled by World Stream):

```typescript
case "session.created":
case "session.updated":
  // DISABLED - World Stream handles this
  console.debug("[store] ignored (handled by World Stream)")
  break

case "session.deleted":
  // DISABLED - World Stream handles this
  break

case "message.updated":
case "message.removed":
  // DISABLED - World Stream handles this
  break

case "message.part.updated":
case "message.part.removed":
  // DISABLED - World Stream handles this
  break
```

Added DEPRECATED markers to `createEmptyDirectoryState()`:
```typescript
sessions: [], // DEPRECATED - use world.sessions
messages: {}, // DEPRECATED - use world.sessions[].messages
parts: {}, // DEPRECATED - use world.sessions[].messages[].parts
```

## What's Remaining

### ⏳ Phase 5: Remove Deprecated Fields from DirectoryState

**File:** `packages/react/src/store/types.ts`  
**Status:** Reserved by GoldHawk (conflict)

**Fields to Remove:**
```typescript
export interface DirectoryState {
  ready: boolean  // KEEP - UI state
  sessions: Session[]  // REMOVE - use world.sessions
  todos: Record<string, Todo[]>  // KEEP - not yet in World Stream
  messages: Record<string, Message[]>  // REMOVE - use world.sessions[].messages
  parts: Record<string, Part[]>  // REMOVE - use world.sessions[].messages[].parts
  modelLimits: Record<string, { context: number; output: number }>  // KEEP - offline cache
}
```

**Final DirectoryState Should Be:**
```typescript
export interface DirectoryState {
  ready: boolean
  todos: Record<string, Todo[]>
  modelLimits: Record<string, { context: number; output: number }>
}
```

### ⏳ Phase 6: Update Store Methods

After DirectoryState is updated, remove methods from `store.ts`:

**Remove these convenience methods:**
- `getSession()`
- `getSessions()`
- `addSession()`
- `updateSession()`
- `removeSession()`
- `getMessages()`
- `addMessage()`
- `updateMessage()`
- `removeMessage()`

**Remove these setters:**
- `setSessions()`
- `setMessages()`
- `setParts()`

**Remove from hydrateMessages:**
- Messages and parts hydration logic (lines 506-525)

## Testing Status

### ✅ Packages Passing Typecheck

- `@opencode-vibe/core` ✓
- `@opencode-vibe/react` ✓
- `@opencode-vibe/swarm-cli` ✓

### ❌ Known Issues (Not in Scope)

**apps/web typecheck failures** - These are pre-existing SDK type issues, not related to this migration:
- `Part.content` property missing (SDK Schema issue)
- `Part.state` property missing (SDK Schema issue)
- OpencodeMessage type mismatches (web app needs update)

**These are separate tasks** - not blocking this migration.

## Data Flow After Migration

```
SSE Events → Core World Stream → effect-atom → World State
                                      ↓
                              useWorld() hook
                                      ↓
                    Derived selector hooks (useWorldSession, etc.)
                                      ↓
                    Internal hooks (useSessionData, useMessagesWithParts)
                                      ↓
                            Facade hook (useSession)
                                      ↓
                                 Components
```

**Old (Eliminated):**
```
SSE Events → Zustand store → useOpencodeStore selectors → hooks
```

## Architecture Compliance

✅ **ADR-016 (Core Layer Responsibility)**
- Core owns computation (World Stream, derived state)
- React binds UI (hooks use useWorld())
- No Effect types in React layer

✅ **ADR-018 (Reactive World Stream)**
- Push-based state via World Stream
- Single source of truth for core data
- Hooks subscribe to World Stream, not Zustand

## Key Learnings

1. **EnrichedSession/EnrichedMessage extend SDK types** - Type-safe delegation without interface adapters
2. **useMemo for transformations** - Prevents infinite loops with useSyncExternalStore
3. **Backward-compatible interfaces** - OpencodeMessage maintained for consumers
4. **Phased migration** - Disable SSE writes first, remove fields last
5. **World Stream already has the data** - Messages with parts, context usage, status all pre-computed

## Next Agent: Finish Phase 5

**Task:** Remove deprecated fields from DirectoryState

**Steps:**
1. Coordinate with GoldHawk on `packages/react/src/store/types.ts`
2. Remove `sessions`, `messages`, `parts` from DirectoryState
3. Update `store.ts` to remove convenience methods
4. Run `bun run typecheck` to verify
5. Update any remaining consumers (should be none - all migrated)

**Files to modify:**
- `packages/react/src/store/types.ts` (DirectoryState interface)
- `packages/react/src/store/store.ts` (remove dead methods)
- `packages/react/src/store/index.ts` (remove exports if needed)
