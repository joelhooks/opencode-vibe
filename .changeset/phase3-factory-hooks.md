---
"@opencode-vibe/react": minor
---

feat(react): expand factory pattern with 6 new hooks

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
import { useProviders, useCommands } from "@opencode-vibe/react"

// After
import { useProviders, useCommands } from "@/app/hooks"
```

### Files Changed

- `packages/react/src/factory.ts` - Added 6 new hooks (9 total)
- `packages/react/src/factory-types.ts` - Type utilities for router mapping
- `packages/react/src/factory.test.ts` - 22 tests for all hooks
- `apps/web/src/app/hooks.ts` - Exports all 9 factory hooks
- 4 components migrated to `@/app/hooks`
