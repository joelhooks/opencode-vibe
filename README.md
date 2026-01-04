# opencode-vibe 🏄‍♂️

```
                                      _      │       _ _
  ___  _ __   ___ _ __   ___ ___   __| | ___ │__   _(_) |__   ___
 / _ \| '_ \ / _ \ '_ \ / __/ _ \ / _` |/ _ \│\ \ / / | '_ \ / _ \
| (_) | |_) |  __/ | | | (_| (_) | (_| |  __/│ \ V /| | |_) |  __/
 \___/| .__/ \___|_| |_|\___\___/ \__,_|\___│  \_/ |_|_.__/ \___|
      |_|                                   │
```

Next.js 16 rebuild of the OpenCode web application. Real-time chat UI with streaming message display, SSE sync, and React Server Components.

> **Warning:** This project uses Next.js 16 canary - bleeding edge. Catppuccin-themed because we're not savages.

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) v1.3+ and [OpenCode CLI](https://github.com/sst/opencode).

1. **Start OpenCode in your project:**
   Navigate to the project you want to work on and keep this running:
   ```bash
   cd /path/to/your/project
   opencode
   ```

2. **Start the Web UI:**
   Clone this repo, install, and run:
   ```bash
   git clone https://github.com/opencode-ai/opencode-vibe.git
   cd opencode-vibe
   bun install
   bun dev
   ```

3. **Open Browser:**
   Go to **http://localhost:8423**

---

## What's Here

**Monorepo structure:**

- **`apps/web/`** - Next.js 16 web application (App Router, RSC, Tailwind)
- **`apps/swarm-cli/`** - CLI for visualizing world state across servers
- **`packages/core/`** - World stream, atoms, Effect services, types
- **`packages/react/`** - React bindings (hooks, providers, store)
- **`docs/`** - Architecture Decision Records and implementation guides

---

## Features

- **World stream architecture** - Push-based reactive state via `createWorldStream()`
- **Multi-server discovery** - Finds all running OpenCode processes automatically via `lsof`
- **Cross-process messaging** - Send from web UI, appears in your TUI
- **Real-time streaming** - Messages stream in as the AI generates them
- **SSE sync** - All updates pushed via Server-Sent Events
- **Slash commands** - Type `/` for actions like `/fix`, `/test`, `/refactor`
- **File references** - Type `@` to fuzzy-search and attach files as context
- **Catppuccin theme** - Latte (light) / Mocha (dark) with proper syntax highlighting

---

## Development

**Available scripts:**

```bash
# Development
bun dev                 # Start Next.js dev server (port 8423 = VIBE)
bun build               # Production build

# Code quality
bun run typecheck       # TypeScript check (via turbo, checks all packages)
bun lint                # Run oxlint
bun format              # Format with Biome

# Testing
bun test                # Run tests (Vitest)
bun test --watch        # Watch mode
```

**CRITICAL:** Always run `bun run typecheck` from repo root before committing. Turbo checks the full monorepo.

---

## Tech Stack

| Layer          | Technology            | Why                                 |
| -------------- | --------------------- | ----------------------------------- |
| **Runtime**    | [Bun](https://bun.sh) | Fast all-in-one runtime             |
| **Framework**  | Next.js 16            | React Server Components, App Router |
| **Bundler**    | Turbopack             | Next-gen bundler                    |
| **Language**   | TypeScript 5+         | Type safety                         |
| **Linting**    | oxlint                | Fast Rust-based linter              |
| **Formatting** | Biome                 | Fast formatter                      |
| **Styling**    | Tailwind CSS          | Utility-first CSS                   |
| **State**      | effect-atom           | Reactive world stream with Effect   |
| **SDK**        | @opencode-ai/sdk      | OpenCode API client                 |

---

## Documentation

- **`apps/web/README.md`** - Web app architecture and patterns
- **`packages/core/README.md`** - Core SDK and world stream documentation
- **`packages/react/README.md`** - React hooks and providers
- **`docs/adr/`** - Architecture Decision Records
  - ADR-016: Core Layer Responsibility (Core owns computation, React binds UI)
  - ADR-018: Reactive World Stream (`createWorldStream()` is THE API)
- **`docs/guides/`** - Implementation guides (SSE sync, mobile, subagents)
- **`AGENTS.md`** - AI agent conventions and development patterns

---

## Contributing

1. Use Bun (not npm/pnpm)
2. Follow TDD: RED → GREEN → REFACTOR
3. Run `bun format` before committing
4. Check `bun lint` and `bun run typecheck` pass

---

## License

MIT
