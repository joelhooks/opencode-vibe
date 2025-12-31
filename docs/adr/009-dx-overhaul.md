# ADR 009: Developer Experience Overhaul

**Status:** In Progress  
**Date:** 2025-12-31 (Updated)  
**Deciders:** Joel Hooks, Architecture Team  
**Affected Components:** React package, web app, SDK integration  
**Related ADRs:** ADR-001 (Next.js Rebuild), ADR-010 (Store Architecture)

---

## Executive Summary

Overhaul opencode-vibe's React DX to match uploadthing-level simplicity:
- **11 hooks → 1 hook** per session page
- **150 lines → 15 lines** to render a session
- **30+ exports → 9 exports** in public API

---

## Completed Work

### Store Architecture (ADR-010) - COMPLETE

The Zustand store is fully implemented and working:

```
packages/react/src/store/
├── store.ts      # 25KB Zustand + Immer store
├── store.test.ts # 16 tests passing
├── types.ts      # DirectoryState types
└── index.ts      # Exports
```

**Key achievements:**
- SSE events flow to store via `useMultiServerSSE({ onEvent })`
- Hooks are pure selectors (no local state)
- Binary search for O(log n) updates
- 688 tests passing, no infinite loops

**Lessons learned (stored in Hivemind):**
1. Never use `.map()/.filter()` inside Zustand selectors - use `useMemo`
2. Wire SSE to store at provider level, not in components
3. Use `getState()` for actions in effects to avoid infinite loops

### Phase 1: Delete Zombie Re-export Layer - COMPLETE ✅

**PR:** [#4](https://github.com/joelhooks/opencode-vibe/pull/4)

- Migrated 14 files from `@/react` to `@opencode-vibe/react`
- Deleted `apps/web/src/react/` directory (index.ts + README.md)
- ONE import path now: `@opencode-vibe/react`

### Phase 2: Delete Dead Code - COMPLETE ✅

**PR:** [#5](https://github.com/joelhooks/opencode-vibe/pull/5)

- Updated `PromptInput.tsx` to import from `@opencode-vibe/core/utils`
- Deleted `apps/web/src/lib/prompt-parsing.ts` (dead re-export)

### Phase 3: Move Internal Hooks - COMPLETE ✅

**PR:** [#6](https://github.com/joelhooks/opencode-vibe/pull/6)

- Created `packages/react/src/hooks/internal/` directory
- Moved 13 hooks + their test files to internal/
- Created `internal/index.ts` barrel export
- Maintained backward compatibility via re-exports with `@internal` JSDoc
- Public API reduced from 30+ to ~10 exports

**New directory structure:**
```
packages/react/src/hooks/
├── internal/
│   ├── index.ts              # Barrel export
│   ├── use-messages.ts
│   ├── use-parts.ts
│   ├── use-messages-with-parts.ts
│   ├── use-session-status.ts
│   ├── use-context-usage.ts
│   ├── use-compaction-state.ts
│   ├── use-subagent-sync.ts
│   ├── use-subagent.ts
│   ├── use-subagents.ts
│   ├── use-sse.ts
│   ├── use-multi-server-sse.ts
│   ├── use-live-time.ts
│   ├── use-provider.ts
│   └── *.test.ts files
├── use-session.ts            # PUBLIC
├── use-session-list.ts       # PUBLIC
├── use-servers.ts            # PUBLIC
├── use-providers.ts          # PUBLIC
├── use-send-message.ts       # PUBLIC
├── use-create-session.ts     # PUBLIC
├── use-file-search.ts        # PUBLIC
├── use-commands.ts           # PUBLIC
├── use-projects.ts           # PUBLIC
└── index.ts                  # Re-exports public + internal (for compat)
```

---

## Remaining Work (3 Phases)

Each phase is designed to fit in a single agent context (~30-60 min each).

### Phase 4: Update Web App Imports (45 min)

**Goal:** Web app uses internal hooks via relative imports

After Phase 3, web app imports will break. Fix them:

```typescript
// BEFORE (broken after Phase 3)
import { useMessagesWithParts } from "@opencode-vibe/react"

// AFTER (internal import)
import { useMessagesWithParts } from "@opencode-vibe/react/hooks/internal/use-messages-with-parts"

// OR re-export from web app's own internal layer
// apps/web/src/hooks/internal.ts
export { useMessagesWithParts } from "@opencode-vibe/react/hooks/internal/use-messages-with-parts"
```

**Alternative:** Keep internal hooks exported but mark as `@internal` in JSDoc.

**Success criteria:**
- [ ] All web app imports working
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] App runs without errors

---

### Phase 5: Create Facade Hook (1 hour)

**Goal:** Single `useSession()` that wraps all internal hooks

**New file:** `packages/react/src/hooks/use-session-facade.ts`

```typescript
export function useSession(sessionId: string, options?: {
  directory?: string
  onMessage?: (msg: Message) => void
  onError?: (err: Error) => void
}) {
  const { directory: contextDir } = useOpencode()
  const dir = options?.directory ?? contextDir

  // Internal hooks (hidden from consumer)
  const session = useSessionData(sessionId)
  const messages = useMessagesWithParts(sessionId)
  const status = useSessionStatus(sessionId)
  const sender = useSendMessage({ sessionId, directory: dir })
  const contextUsage = useContextUsage(sessionId)
  const compaction = useCompactionState(sessionId)

  return {
    data: session,
    messages,
    running: status === "running",
    isLoading: sender.isLoading,
    error: sender.error,
    sendMessage: sender.sendMessage,
    queueLength: sender.queueLength,
    contextUsage,
    compacting: compaction.isCompacting,
  }
}
```

**Success criteria:**
- [ ] Facade hook created with tests
- [ ] Returns unified API
- [ ] `bun run test` passes

---

### Phase 6: Migrate SessionLayout to Facade (1 hour)

**Goal:** Replace 7 hooks with 1 in SessionLayout

**Before (current):**
```tsx
export function SessionLayout({ sessionId }) {
  const { directory } = useOpencode()
  useSubagentSync({ sessionId })
  const session = useSession(sessionId)
  const status = useSessionStatus(sessionId)
  const messages = useMessages(sessionId)
  const { sendMessage } = useSendMessage({ sessionId, directory })
  // ... 150 lines
}
```

**After (target):**
```tsx
export function SessionLayout({ sessionId }) {
  const session = useSession(sessionId, {
    onError: (err) => toast.error(err.message)
  })

  return (
    <div>
      <h1>{session.data?.title}</h1>
      <SessionMessages messages={session.messages} />
      <ContextUsageBar usage={session.contextUsage} />
      <PromptInput onSubmit={session.sendMessage} />
    </div>
  )
}
```

**Success criteria:**
- [ ] SessionLayout uses facade hook
- [ ] Child components receive props (no duplicate hooks)
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] App works in browser

---

## Future Work (Not in Scope)

These are nice-to-haves for later:

1. **Remove Provider Requirement** - Auto-discovery pattern
2. **SSR Plugin** - `globalThis` hydration for zero client fetches
3. **Builder API** - Fluent chainable config like uploadthing
4. **Framework Adapters** - `@opencode-vibe/react/next` entry point

---

## Success Metrics

| Metric | Before | After Phase 6 | Target |
|--------|--------|---------------|--------|
| Lines to render session | 150 | 15 | 15 |
| Hooks per session page | 11 | 1 | 1 |
| Public API exports | 30+ | 10 | 9 |
| Import paths | 2 | 1 | 1 |

---

## Phase Execution Order

```
Phase 1: Delete zombie re-export layer (30 min) ✅ PR #4
    ↓
Phase 2: Delete dead code (15 min) ✅ PR #5
    ↓
Phase 3: Move internal hooks (45 min) ✅ PR #6
    ↓
Phase 4: Update web app imports (45 min) ⏳
    ↓
Phase 5: Create facade hook (1 hour) ⏳
    ↓
Phase 6: Migrate SessionLayout (1 hour) ⏳
```

**Progress:** 3/6 phases complete (~50%)

**Remaining time:** ~2.5 hours across 3 focused sessions

Each phase is independent and can be done in a single agent context without losing track.

---

## References

- **ADR-010:** Store Architecture (COMPLETE)
- **Hivemind memories:** Zustand selector patterns, SSE wiring patterns
- **uploadthing:** Reference implementation for DX patterns
