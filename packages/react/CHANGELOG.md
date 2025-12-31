# @opencode-vibe/react

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
