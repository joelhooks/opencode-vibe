# @opencode-vibe/core

## 0.2.1

### Patch Changes

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

## 0.2.0

### Minor Changes

- [`e5b8ed2`](https://github.com/joelhooks/opencode-vibe/commit/e5b8ed26a29f0df1399ce75c08ec78fdb65ecbcd) Thanks [@joelhooks](https://github.com/joelhooks)! - Initial release of OpenCode Vibe packages

  - `@opencode-vibe/core`: Framework-agnostic SDK with router, atoms, SSE, and discovery
  - `@opencode-vibe/react`: React bindings with hooks and providers
