# opencode-next

```
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║     ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗   ║
    ║    ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔═══██╗  ║
    ║    ██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║   ██║  ║
    ║    ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║   ██║  ║
    ║    ╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗╚██████╔╝  ║
    ║     ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝   ║
    ║                                                           ║
    ║              Next.js 16 Web UI for OpenCode               ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
```

Next.js 16 rebuild of the OpenCode web application. Real-time chat UI with streaming message display, SSE sync, and React Server Components.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+ (required - we don't use npm/pnpm)
- [OpenCode CLI](https://github.com/sst/opencode) running locally

### 1. Install Dependencies

```bash
bun install
```

### 2. Start OpenCode Backend

In a **separate terminal**, navigate to your project directory and start the OpenCode server:

```bash
# Navigate to the project you want to work on
cd /path/to/your/project

# Start OpenCode server on port 4056 (default for web UI)
opencode serve -p 4056
```

> **Important:** The `opencode serve` command starts the HTTP/SSE server that the web UI connects to. This is different from the interactive `opencode` TUI - you need the server mode for the web UI to work.

**Common port configurations:**

```bash
# Default setup (recommended)
opencode serve -p 4056

# Custom port (update NEXT_PUBLIC_OPENCODE_URL to match)
opencode serve -p 5000
```

### 3. Start the Web UI

```bash
# From the opencode-next root directory
bun dev
```

This starts the Next.js dev server on **port 8423**.

### 4. Open in Browser

Navigate to: **http://localhost:8423**

You should see the OpenCode web interface with your sessions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Next.js Web UI (port 8423)                 │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │    │
│  │  │   Session   │  │   Message   │  │   SSE Provider  │  │    │
│  │  │    List     │  │   Display   │  │   (real-time)   │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              │ HTTP + SSE                        │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │            OpenCode Backend (port 4056)                 │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │    │
│  │  │   Session   │  │   Message   │  │   AI Provider   │  │    │
│  │  │   Manager   │  │   Handler   │  │   (Anthropic)   │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component            | Port | Purpose                                             |
| -------------------- | ---- | --------------------------------------------------- |
| **OpenCode Backend** | 4056 | AI chat backend, session management, tool execution |
| **Next.js Web UI**   | 8423 | Browser interface, real-time message display        |

---

## Configuration

### Environment Variables

Create a `.env.local` file in `apps/web/` to customize:

```bash
# OpenCode backend URL (default: http://localhost:4056)
NEXT_PUBLIC_OPENCODE_URL=http://localhost:4056

# Project directory to sync (optional - uses OpenCode's current directory)
NEXT_PUBLIC_OPENCODE_DIRECTORY=/path/to/your/project
```

### Custom Ports

**Change OpenCode port:**

```bash
opencode serve -p 5000
```

Then update your `.env.local`:

```bash
NEXT_PUBLIC_OPENCODE_URL=http://localhost:5000
```

Then update your `.env.local`:

```bash
NEXT_PUBLIC_OPENCODE_URL=http://localhost:5000
```

**Change Web UI port:**

```bash
# Edit apps/web/package.json "dev" script, or:
bun --cwd apps/web next dev --port 3000
```

---

## Development

### Project Structure

```
opencode-next/
├── apps/
│   └── web/                    # Next.js 16 application
│       ├── src/
│       │   ├── app/            # App Router pages
│       │   │   ├── page.tsx    # Session list
│       │   │   └── session/
│       │   │       └── [id]/   # Session detail view
│       │   ├── components/     # UI components
│       │   │   ├── ai-elements/  # Chat UI components
│       │   │   └── ui/           # Shared UI primitives
│       │   ├── core/           # SDK client setup
│       │   ├── lib/            # Utilities
│       │   └── react/          # React hooks & providers
│       │       ├── provider.tsx      # OpenCodeProvider
│       │       ├── store.ts          # Zustand store
│       │       ├── use-sse.tsx       # SSE connection hook
│       │       ├── use-session.ts    # Session data hook
│       │       ├── use-messages.ts   # Messages hook
│       │       └── use-send-message.ts # Send message hook
│       └── package.json
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── guides/                 # Implementation guides
├── package.json                # Root package.json
└── turbo.json                  # Turborepo config
```

### Available Scripts

```bash
# Development
bun dev                 # Start Next.js dev server (port 8423)
bun build               # Production build
bun start               # Start production server

# Code Quality
bun lint                # Run oxlint
bun format              # Format with Biome
bun format:check        # Check formatting

# Testing
bun test                # Run tests
bun test --watch        # Watch mode
```

### React Hooks

The web UI provides several hooks for interacting with OpenCode:

```tsx
import {
  useSession, // Get session data
  useMessages, // Get messages for a session
  useSendMessage, // Send a message
  useSessionStatus, // Get session status (idle/busy/error)
  useProviders, // List available AI providers
} from "@/react";

// Example: Display session messages
function SessionView({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const messages = useMessages(sessionId);
  const { send, isPending } = useSendMessage(sessionId);
  const status = useSessionStatus(sessionId);

  return (
    <div>
      <h1>{session?.title}</h1>
      <div>Status: {status}</div>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      <input
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            send(e.currentTarget.value);
          }
        }}
        disabled={isPending}
      />
    </div>
  );
}
```

---

## Troubleshooting

### "Failed to connect to OpenCode"

1. **Check OpenCode is running:**

   ```bash
   curl http://localhost:4056/health
   ```

   Should return `{"status":"ok"}`

2. **Check the port matches:**
   - OpenCode default: `4056`
   - Web UI expects: `NEXT_PUBLIC_OPENCODE_URL` (default `http://localhost:4056`)

3. **Restart OpenCode:**

   ```bash
   # Kill existing process
   pkill -f "opencode serve"

   # Start fresh
   cd /your/project && opencode serve -p 4056
   ```

### "No sessions showing"

1. OpenCode needs an active project directory
2. Make sure you started OpenCode from within a project folder
3. Check the browser console for SSE connection errors

### "Messages not updating in real-time"

1. Check SSE connection in browser DevTools → Network → EventStream
2. Look for `/_next/...` SSE connections
3. Verify no CORS errors in console

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
| **State**      | Zustand               | Lightweight state management        |
| **SDK**        | @opencode-ai/sdk      | OpenCode API client                 |

---

## Documentation

- [ADR 001: Next.js Rebuild](docs/adr/001-nextjs-rebuild.md) - Architecture rationale
- [Sync Implementation Guide](docs/guides/SYNC_IMPLEMENTATION.md) - SSE sync details
- [Subagent Display Guide](docs/guides/SUBAGENT_DISPLAY.md) - Rendering subagent messages
- [Mobile Client Guide](docs/guides/MOBILE_CLIENT_IMPLEMENTATION.md) - Mobile considerations

---

## Contributing

1. Use Bun (not npm/pnpm)
2. Follow TDD: RED → GREEN → REFACTOR
3. Run `bun format` before committing
4. Check `bun lint` passes

---

## License

MIT
