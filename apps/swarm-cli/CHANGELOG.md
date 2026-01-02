# @opencode-vibe/swarm-cli

## 0.2.0

### Minor Changes

- [`5e5e4e6`](https://github.com/joelhooks/opencode-vibe/commit/5e5e4e690adf9051b047ee297fcb187bc18a3fff) Thanks [@joelhooks](https://github.com/joelhooks)! - feat(world): unify world stream to atoms-only path

  ```
      ╔═══════════════════════════════════════════════════════╗
      ║           🐝 ATOMS ARE THE WAY 🐝                     ║
      ╠═══════════════════════════════════════════════════════╣
      ║                                                       ║
      ║   ┌─────────────┐                                     ║
      ║   │ SSE Events  │──┐                                  ║
      ║   └─────────────┘  │                                  ║
      ║                    ▼                                  ║
      ║   ┌─────────────────────────────────┐                 ║
      ║   │      createWorldStream()        │                 ║
      ║   │  ┌───────────────────────────┐  │                 ║
      ║   │  │      WorldStore           │  │                 ║
      ║   │  │  ┌─────┐ ┌─────┐ ┌─────┐  │  │                 ║
      ║   │  │  │sess │ │msgs │ │parts│  │  │                 ║
      ║   │  │  │Atom │ │Atom │ │Atom │  │  │                 ║
      ║   │  │  └─────┘ └─────┘ └─────┘  │  │                 ║
      ║   │  └───────────────────────────┘  │                 ║
      ║   └─────────────────────────────────┘                 ║
      ║                    │                                  ║
      ║                    ▼                                  ║
      ║   ┌─────────────────────────────────┐                 ║
      ║   │  { subscribe, getSnapshot }     │                 ║
      ║   └─────────────────────────────────┘                 ║
      ║                                                       ║
      ╚═══════════════════════════════════════════════════════╝
  ```

  > "Simplicity is prerequisite for reliability."
  > — Edsger W. Dijkstra

  **Changes:**

  - Remove `--use-atoms` flags from CLI (atoms are THE path now)
  - Delete redundant `consumer.ts` (stream.ts already has SSE-wired createWorldStream)
  - Delete `WorldStateAggregator` class (394 → 196 lines, 50% reduction)
  - CLI uses `createWorldStream` from core directly
  - Single unified path: SSE → WorldStore (atoms) → subscribe/getSnapshot

  **CLI now works:**

  ```
  $ swarm-cli status
  🌍 WORLD STATE 🌍
  Sessions: 89     Active: 0      Streaming: 0
  ```

### Patch Changes

- Updated dependencies [[`963a6e9`](https://github.com/joelhooks/opencode-vibe/commit/963a6e969a10365cb2f3d30bcff8367cb3411dd9), [`fd68a7d`](https://github.com/joelhooks/opencode-vibe/commit/fd68a7d9417b67caf411806d09cbdcb4b0486c29), [`8321b6f`](https://github.com/joelhooks/opencode-vibe/commit/8321b6fb905a859c4e316db0d8f92d177906a372), [`e9da5e5`](https://github.com/joelhooks/opencode-vibe/commit/e9da5e5b85b865316c648251fd045ccdec98001c), [`7b21536`](https://github.com/joelhooks/opencode-vibe/commit/7b215363148c474d838b81cd1560a11282483d4b), [`5e5e4e6`](https://github.com/joelhooks/opencode-vibe/commit/5e5e4e690adf9051b047ee297fcb187bc18a3fff)]:
  - @opencode-vibe/core@0.3.0
