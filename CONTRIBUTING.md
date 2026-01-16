# Contributing to OpenCode Vibe

We focus on speed, precision, and type safety. We use **Bun** for everything.

## Core Philosophy

1.  **Core Owns Computation**: Logic lives in `packages/core`. React only binds UI.
2.  **Push-Based State**: We use `createWorldStream()` via Effect/Atoms.
3.  **Type Safety First**: No `any`. No type assertions unless absolutely necessary.

## Development Setup

**Prerequisites**: [Bun](https://bun.sh) v1.3+

```bash
# Install dependencies
bun install

# Start development server
bun dev
```

## Workflow

### 1. Make Changes
- Follow **TDD**: Write failing tests (Red) → Implement (Green) → Clean up (Refactor).
- Use **Vitest** for testing: `bun test`.

### 2. Verify Quality
Before committing, you **MUST** pass all checks:

```bash
bun format         # Fix formatting (Biome)
bun lint           # Check linting (oxlint)
bun run typecheck  # Check types (Turbo)
```

> **Note**: `bun run typecheck` checks the entire monorepo. Do not skip this.

### 3. Commit & PR
- We use **Changesets** for versioning.
- If your change affects published packages, run:
  ```bash
  bun changeset
  ```
- Follow the prompt to add a summary.

## Monorepo Structure

- **`apps/web/`** - Next.js 16 web application (App Router, RSC, Tailwind)
- **`apps/swarm-cli/`** - CLI for visualizing world state across servers
- **`packages/core/`** - World stream, atoms, Effect services, types
- **`packages/react/`** - React bindings (hooks, providers, store)

## Documentation

- **`apps/web/README.md`** - Web app architecture and patterns
- **`packages/core/README.md`** - Core SDK and world stream documentation
- **`packages/react/README.md`** - React hooks and providers
- **`docs/adr/`** - Architecture Decision Records
  - [ADR-016: Core Layer Responsibility](docs/adr/016-core-layer-responsibility.md) (Core owns computation, React binds UI)
  - [ADR-018: Reactive World Stream](docs/adr/018-reactive-world-stream.md) (`createWorldStream()` is THE API)
- **`docs/guides/`** - Implementation guides (SSE sync, mobile, subagents)
- **`AGENTS.md`** - AI agent conventions and development patterns

## License

By contributing, you agree that your code will be licensed under the MIT License.
