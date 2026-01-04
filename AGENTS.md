# AGENTS.md

## ⚠️ CRITICAL: Chrome DevTools = Subagent ONLY

**NEVER use `chrome-devtools_*` tools directly in the main conversation.**

Chrome DevTools dumps massive snapshots that exhaust context. Always spawn a subagent:

```
Task(subagent_type="explore", description="Debug via Chrome DevTools", prompt="...")
```

---

## ⚠️ STOP: No "instances" Directory

**OpenCode does NOT use `~/.local/state/opencode/instances/` for server discovery.**

This path is a hallucination. Don't check it, don't reference it, it doesn't exist.

Server discovery uses the SDK's discovery service which scans for running processes, NOT a filesystem directory.

---

## Project Overview

**opencode-next** - Next.js 16 rebuild of OpenCode web application.

Turborepo monorepo transitioning from SolidJS to Next.js 16+ with React Server Components. Uses effect-atom based reactive World Stream for state management, with ai-elements chat UI.

**Architecture Philosophy:**
- **Core owns computation, React binds UI** - Smart boundary pattern (ADR-016)
- **World Stream is THE API** - Push-based reactive state via `createWorldStream()` (ADR-018)
- **Router is DELETED** - 4,377 LOC removed, it was solving the wrong problem

**Why Next.js 16?**
- Flat RSC hierarchy (eliminates 13+ nested providers)
- Better mobile patterns (React hooks map to scroll behavior)
- 30-40% code reduction with ai-elements
- React is 10x more common than SolidJS (easier hiring)

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Bun | Fast, 10x faster installs |
| **Testing** | Vitest | Isolated tests, proper ESM support |
| **Framework** | Next.js 16 canary | RSC, App Router, Turbopack |
| **Monorepo** | Turborepo | Incremental builds |
| **Language** | TypeScript 5+ | Type safety |
| **Linting** | oxlint | Fast Rust-based linter |
| **Formatting** | Biome | Fast Prettier replacement |
| **Chat UI** | ai-elements | Battle-tested React chat components |
| **Styling** | Tailwind CSS | Utility-first CSS |

---

## Development Commands

```bash
# Setup
bun install

# Dev
bun dev
bun build

# Type check (MANDATORY - checks full monorepo)
bun run typecheck          # Runs: turbo type-check

# Code quality
bun lint
bun format
bun format:fix

# Testing (use Vitest, NOT bun test - better isolation)
bun run test              # Runs: vitest run
bun run test:watch        # Runs: vitest
bun run test:coverage     # Runs: vitest run --coverage
```

**CRITICAL:** 
- Always `bun run typecheck` from repo root before committing

### Debugging CLI Commands

**Use `--debug` flag** to see what's happening:

```bash
# See connection status, instance discovery, session loading
cd apps/swarm-cli && bun run src/main.ts list --once --debug

# Discovery takes ~10 seconds - be patient!
# Output shows: status=discovering → connecting → connected
```

**Discovery uses `lsof`** to find running OpenCode servers:
```bash
# What discovery actually runs:
lsof -iTCP -sTCP:LISTEN -P -n | grep -E 'bun|opencode'

# Then verifies each port with:
curl http://127.0.0.1:{port}/project/current
```
- Never use `bun test` directly - Vitest has proper isolation, Bun test leaks state

---

## Conventions

### Changesets (Non-Negotiable)

**Every changeset MUST include:**

1. **A relevant quote from pdf-brain** - Search for wisdom related to your change
2. **Sick ASCII art** - Creative, memorable

```bash
# Example changeset:
---
"@opencode-vibe/core": minor
---

feat(api): add session caching layer

```
    ╔═══════════════════════════════════════╗
    ║  🧠 CACHE ME OUTSIDE, HOW BOW DAH 🧠  ║
    ╠═══════════════════════════════════════╣
    ║     ┌─────────┐                       ║
    ║     │ REQUEST │──┐                    ║
    ║     └─────────┘  │  ┌───────┐         ║
    ║                  ├──│ CACHE │         ║
    ║     ┌─────────┐  │  └───────┘         ║
    ║     │ BACKEND │──┘                    ║
    ║     └─────────┘                       ║
    ╚═══════════════════════════════════════╝
```

> "The purpose of abstraction is not to be vague, but to create
> a new semantic level in which one can be absolutely precise."
> — Dijkstra, via pdf-brain

Adds LRU cache for session lookups, reducing backend calls by 80%.
```

**ASCII Art Inspiration:**

```
# The Swarm 🐝
       \   /
    `. _\|/_ .'
    - ( o bg) -    bzzzz
    .' /|\  `.    
       / | \      ╭─────────────╮
      🐝 🐝 🐝    │ HIVE MIND   │
     🐝 🐝 🐝 🐝  │ ACTIVATED   │
    🐝 🐝 🐝 🐝 🐝 ╰─────────────╯

# The Phoenix Refactor 🔥
          ,//
         ///
        ////
       /////
    ,///////
    ////////
     '////'
       '||'
        ||  FROM THE ASHES
        ||  OF LEGACY CODE
       /||\  WE RISE
      //||\\

# The Crab Rave 🦀
    (\/) (°,,°) (\/)
      RUST SAYS:
    "MEMORY SAFE, BB"
    
    ╱|、
  (˚ˎ 。7  
   |、˜〵          
   じしˍ,)ノ

# The Kraken Release 🦑
       ___
    .-'   '-.
   /  .-=-.  \   RELEASE
  |  /     \  |    THE
  | |  O O  | |   KRAKEN
   \|  ___  |/
    '.___.'
   /||||||||\
  //||||||||\\
```

### TDD (Non-Negotiable)

```
RED → GREEN → REFACTOR
```

**Every feature. Every bug fix. No exceptions.**

1. **RED** - Write failing test first
2. **GREEN** - Minimum code to pass
3. **REFACTOR** - Clean up while green

**Bug fixes:** Write test that reproduces bug FIRST, then fix. Prevents regression forever.

**NO DOM TESTING.** If the DOM is in the mix, we already lost.

- `renderHook` and `render` from `@testing-library` are code smells
- Test pure functions and hooks logic directly
- Test state management (Zustand stores) in isolation
- Test API/SDK integration with mocks
- Use E2E tests (Playwright) for actual UI verification

**USE VITEST, NOT BUN TEST.** Bun test has poor isolation - Zustand stores and singletons leak state between tests causing flaky failures.

### Fix Broken Shit (Non-Negotiable)

```
FIND IT → FIX IT → DON'T BLAME OTHERS
```

**If you encounter broken code, fix it. No excuses.**

1. Pre-existing type errors? Fix them.
2. Failing tests unrelated to your task? Fix them or file a cell.
3. Broken imports? Fix them.
4. Dead code? Delete it.

**What NOT to do:**
- ❌ "That's a pre-existing issue" (it's YOUR issue now)
- ❌ "Another agent broke this" (doesn't matter, fix it)
- ❌ "Out of scope" (broken code is always in scope)
- ❌ Leave `// TODO` comments for others (do it yourself)

**The codebase should be BETTER after every session, not just different.**

If you can't fix it immediately, file a hive cell with priority 1.

### Dependency Management

**CRITICAL:** Never edit `package.json` manually.

```bash
# ✅ CORRECT - Use bun CLI
bun add <package>           # Production dependency
bun add -d <package>        # Dev dependency
bun remove <package>        # Uninstall

# ❌ WRONG - Manual edits break lockfile integrity
```

### Bun-First Development

**Use Bun instead of Node.js, npm, pnpm, or vite.**

```bash
# ✅ Use Bun equivalents
bun <file>                  # Instead of node <file>
bun test                    # Instead of jest/vitest
bun build <file.html>       # Instead of webpack/vite
bun install                 # Instead of npm/pnpm install
bunx <package>              # Instead of npx
```

### Network Authentication

**No app-level auth needed.** Tailscale provides network-level authentication.

- No OAuth flows in the web app
- No JWT tokens in cookies
- No user login/logout UI
- Trust the network layer

---

## Architecture Highlights

### AsyncLocalStorage DI Pattern

**Preserved from backend.** Elegant, portable, per-directory instance scoping.

```typescript
// Backend: packages/opencode/src/util/context.ts
export namespace Context {
  export function create<T>(name: string) {
    const storage = new AsyncLocalStorage<T>();
    return {
      use() { return storage.getStore()!; },
      provide<R>(value: T, fn: () => R) { return storage.run(value, fn); }
    };
  }
}

// Usage: Per-directory instance scoping
Instance.provide({ directory: "/path" }, async () => {
  const dir = Instance.directory; // All code has access to directory context
});
```

### Reactive World Stream Architecture (ADR-018)

**Push-based state management with effect-atom. Core derives ALL state, emits complete consistent world snapshots.**

```
SSE events → effect-atom invalidation → derived world state → consumers
```

**The API - `createWorldStream()`:**

```typescript
import { createWorldStream } from "@opencode-vibe/core/world"

const stream = createWorldStream({
  baseUrl: "http://localhost:3000",
  directory: "/path/to/project"
})

// Subscribe pattern (React)
const unsubscribe = stream.subscribe((world) => {
  console.log(world.sessions, world.activeSessionCount)
})

// Async iterator pattern (CLI/TUI)
for await (const world of stream) {
  render(world)
}

// One-shot snapshot
const world = await stream.getSnapshot()
```

**Key Principle:** Core pushes complete world state; consumers just subscribe. No coordination burden on clients.

**Key Files:**
- `packages/core/src/world/merged-stream.ts` - Unified streaming (SSE + pluggable sources)
- `packages/core/src/world/stream.ts` - Public API (delegates to merged-stream)
- `packages/core/src/world/atoms.ts` - World store (effect-atom state)
- `packages/react/src/hooks/use-world.ts` - React binding (calls Core promise APIs)
- `packages/core/src/world/sse.ts` - SSE connection feeds atoms

### Core Layer Responsibility (ADR-016)

**Core owns computation, React binds UI.** This is the smart boundary pattern.

```
┌─────────────────────────────────────────┐
│  REACT LAYER (lean)                     │
│  • UI binding only                      │
│  • Hooks call Core promise APIs         │
│  • NEVER imports Effect                 │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│  CORE (smart boundary)                  │
│  • Computed APIs (pre-joined data)      │
│  • Effect services (internal)           │
│  • Domain logic, status computation     │
│  • Promise APIs (external surface)      │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│  SDK / BACKEND                          │
└─────────────────────────────────────────┘
```

**What Core provides:**
- `sessions.getStatus(id)` - Computed session status
- `sessions.listWithStatus()` - Pre-joined data
- `messages.listWithParts(sessionId)` - Messages with parts embedded
- `format.relativeTime()`, `format.tokens()` - Formatting utils

**What React provides:**
- UI binding via hooks (`useWorld()`, `useSession(id)`)
- Never imports Effect types
- Zustand only for UI-local state (selected session, flags)

### OpenAPI SDK Codegen

**Preserved workflow.** No changes to SDK generation.

```
OpenAPI Spec (openapi.json) → @hey-api/openapi-ts → Generated Types/Client
  → SDK Wrapper (namespaced classes) → createOpencodeClient() → Consumer
```

**Source of truth:** `packages/sdk/openapi.json` (OpenAPI 3.1.1)

### Data Flow Architecture

**High-level:** Backend → SDK → Core → React/CLI

```
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (packages/opencode)                                │
│  • Hono HTTP server                                         │
│  • Filesystem state (~/.local/state/opencode/)              │
│  • SSE event stream (/api/events)                           │
│  • Instance metadata registry                               │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  SDK (packages/sdk)                                         │
│  • OpenAPI-generated client                                 │
│  • Type-safe API surface                                    │
│  • Discovery service (filesystem scan)                      │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CORE (packages/core)                                       │
│  • World Stream (reactive state via effect-atom)            │
│  • SSE connection management                                │
│  • Computed APIs (pre-joined data)                          │
│  • Promise-based external surface                           │
└─────────────────────────────────────────────────────────────┘
                          ▼
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
┌──────────────────┐              ┌──────────────────┐
│  REACT           │              │  CLI             │
│  (packages/react)│              │  (apps/swarm-cli)│
│  • Hooks         │              │  • Commands      │
│  • UI binding    │              │  • TUI           │
└──────────────────┘              └──────────────────┘
```

**Key Patterns:**

1. **Discovery** - Filesystem-based server discovery via `~/.local/state/opencode/instances/`
2. **World Stream** - Push-based reactive state (SSE → effect-atom → subscribers)
3. **Smart Boundary** - Core owns computation, React/CLI bind UI
4. **Single vs Multi** - Web app discovers multiple servers, CLI connects to one

**Data Types:**

- `InstanceMetadata` - Server discovery (directory, pid, port, startTime)
- `WorldState` - Reactive snapshot (sessions, messages, parts)
- `Session`, `Message`, `Part` - SDK types (never hand-roll)

**Key Files:**
- `packages/core/src/discovery/` - Server discovery
- `packages/core/src/world/` - Reactive world stream
- `packages/core/src/client/` - SDK client factory
- `packages/react/src/hooks/` - React bindings
- `apps/swarm-cli/src/world-state.ts` - CLI wrapper

---

## Known Gotchas

### Immer + React.memo

**Problem:** Every store update creates new array/object references, even if content is identical.

**Impact:** `React.memo` with shallow comparison always triggers re-renders because references change.

```typescript
// Even if metadata.summary hasn't changed, this creates new references
set((state) => {
  const partIndex = state.parts.findIndex((p) => p.id === id);
  state.parts[partIndex].state.metadata.summary = newSummary; // New part object
});
```

**Fix:** Content-aware React.memo comparison

```typescript
export const Task = React.memo(TaskComponent, (prev, next) => {
  return (
    prev.part.id === next.part.id &&
    prev.part.state?.metadata?.summary === next.part.state?.metadata?.summary
  );
});
```



### SDK Types (Non-Negotiable)

**ALWAYS use official `@opencode-ai/sdk` types.** Never hand-roll domain types.

```typescript
// ✅ CORRECT - Import from sdk.ts re-export layer
import type { Session, Message, Part } from "@opencode-vibe/core/types/sdk"
import type { Event, EventMessagePartUpdated } from "@opencode-vibe/core/types/sdk"

// ❌ WRONG - Hand-rolled types cause drift
interface Session { id: string; ... }  // DON'T DO THIS
```

**Key files:**
- `packages/core/src/types/sdk.ts` - Central re-export of SDK types
- `packages/core/src/types/domain.ts` - Re-exports SDK types for backwards compat
- `packages/core/src/types/events.ts` - Re-exports SDK event types

**When SDK updates:**
1. Update `@opencode-ai/sdk` version in `packages/core/package.json`
2. Run `bun install`
3. Run `bun run typecheck` - fix any breaking changes
4. Update `sdk.ts` if new types need re-exporting

**SDK Event Shapes:**
- `EventMessagePartUpdated` has `{ type, properties: { part: Part } }` - part is NESTED
- Other events have flat `{ type, properties: { sessionID, ... } }`

### SDK Gotchas

- **No timeout on requests** - AI operations can run for minutes. `req.timeout = false` in client factory.
- **Directory scoping** - `x-opencode-directory` header routes requests to specific project instance.
- **Dual SDK instances** - One for SSE (no timeout), one for requests (10min timeout).

### Backend Gotchas

- **No database** - All data in filesystem (`~/.local/state/opencode/`). No migrations, no transactions.
- **Event bus is global** - `GlobalBus.emit()` broadcasts to ALL clients. No per-client filtering.
- **Instance caching** - `Instance.provide()` caches per directory. Dispose required to clear cache.
- **SSE heartbeat required** - 30s heartbeat prevents WKWebView 60s timeout on mobile Safari.

### State Management Gotchas

- **Binary search everywhere** - Updates use binary search on sorted arrays. Assumes IDs are sortable (they are - ULIDs).
- **Session limit** - UI loads 5 sessions by default + any updated in last 4 hours. Older sessions lazy-loaded.

### effect-atom Gotchas

- **Atoms reset after microtask without subscription** - By default, atoms reset to initial value after `await`/`Promise.resolve()` if no active subscription. Use `Atom.keepAlive` or maintain subscription during assertions.
- **keepAlive is opt-in** - `Atom.make(value)` does NOT persist. Use `Atom.make(value).pipe(Atom.keepAlive)` for persistent atoms.
- **mount() keeps atoms alive** - `registry.mount(atom)` maintains subscription. Call returned cleanup function when done.

---

## Check the Source (RTFM)

**When debugging unexpected library behavior, CHECK THE LIBRARY'S TEST SUITE FIRST.**

Library test suites are the canonical documentation for edge cases, gotchas, and expected behavior. They're often more accurate than docs.

### When to Check the Source

1. **Unexpected behavior** - Library doesn't work as you expect
2. **Missing documentation** - Docs don't cover your use case
3. **Version-specific issues** - Behavior changed between versions
4. **Test failures** - Your tests fail but code looks correct
5. **Integration issues** - Two libraries don't play well together

### How to Check

```bash
# Clone and search the library's test suite
repo-autopsy_clone(repo="owner/library")
repo-autopsy_search(repo="owner/library", pattern="yourFeature")
repo-autopsy_file(repo="owner/library", path="test/feature.test.ts")
```

### Examples

#### effect-atom: keepAlive behavior

**Problem:** Tests pass in subscription callback but fail after `await`.

**Source revealed:** `tim-smart/effect-atom/packages/atom/test/Atom.test.ts` lines 35-42:
```typescript
it("keepAlive false", async () => {
  const counter = Atom.make(0)
  const r = Registry.make()
  r.set(counter, 1)
  expect(r.get(counter)).toEqual(1)
  await new Promise((resolve) => resolve(null))  // microtask!
  expect(r.get(counter)).toEqual(0)  // RESET TO DEFAULT!
})
```

**Learning:** Atoms reset after microtask without `Atom.keepAlive`.

#### @opencode-ai/sdk: Event shapes

**Problem:** Can't access `part` from `EventMessagePartUpdated`.

**Source revealed:** `packages/sdk/openapi.json` shows nested structure:
```json
{ "type": "message.part.updated", "properties": { "part": { ... } } }
```

**Learning:** Part is nested in `properties.part`, not flat like other events.

#### Effect-TS: Service testing patterns

**Problem:** How to test services with dependencies?

**Source revealed:** `kitlangton/effect-solutions/tests/08-testing.test.ts`:
```typescript
// Use Layer.provideMerge to expose both orchestrator AND leaf services
const TestLayer = Layer.provideMerge(
  EventsLive,
  Layer.mergeAll(UsersTest, EmailsTest)
)
```

**Learning:** `Layer.provideMerge` > `Layer.provide` for testing - exposes all services.

### Key Source Repos

| Library | Test Location | Key Patterns |
|---------|--------------|--------------|
| effect-atom | `tim-smart/effect-atom/packages/atom/test/` | keepAlive, mount, subscribe lifecycle |
| Effect-TS | `Effect-TS/effect/packages/effect/test/` | Layer composition, error handling |
| @opencode-ai/sdk | `sst/opencode/packages/sdk/` | Event shapes, API contracts |
| ai-elements | `vercel-labs/ai-elements/` | Chat component props, streaming |

### Store Your Findings

After discovering a gotcha from source, store it:

```typescript
hivemind_store(
  information="<library> <feature>: <what you learned, WHY it matters>",
  tags="<library>, gotcha, <feature>"
)
```

---

## References

### Documentation

- [ADR 001: Next.js Rebuild](docs/adr/001-nextjs-rebuild.md) - Full architecture rationale
- [ADR 016: Core Layer Responsibility](docs/adr/016-core-layer-responsibility.md) - Smart boundary pattern
- [ADR 018: Reactive World Stream](docs/adr/018-reactive-world-stream.md) - Push-based state with effect-atom
- [Bun API Docs](node_modules/bun-types/docs/) - Local Bun reference
- [Next.js Docs](https://nextjs.org/docs) - Next.js 16 App Router
- [ai-elements](https://github.com/vercel-labs/ai-elements) - Chat UI components

### Related Projects

- `packages/opencode` - Backend (Hono server, AsyncLocalStorage DI)
- `packages/sdk` - OpenAPI-generated SDK with 15 namespaces
- `packages/app` - Current SolidJS app (being replaced)

### Key Files

| File | Purpose |
|------|---------|
| `docs/adr/001-nextjs-rebuild.md` | Architecture rationale, migration plan |
| `CLAUDE.md` | AI agent conventions, Bun usage |
| `.hive/issues.jsonl` | Work tracking (git-backed) |
| `package.json` | Bun dependencies |
| `tsconfig.json` | TypeScript configuration |

---

## Questions or Issues?

- **Architecture questions:** See `docs/adr/001-nextjs-rebuild.md`
- **Bun usage:** See `CLAUDE.md`
- **Work tracking:** Check `.hive/issues.jsonl` or run `bd list`
- **SDK reference:** `packages/sdk/openapi.json` (OpenAPI 3.1.1)
