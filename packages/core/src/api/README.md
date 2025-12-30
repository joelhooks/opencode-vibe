# Promise API

Promise-based API for OpenCode operations. This is the default API for `@opencode-vibe/core`.

## Usage

```typescript
import { sessions, messages, parts } from "@opencode-vibe/core"
// or: import { sessions, messages, parts } from "@opencode-vibe/core/api"

// Fetch sessions
const sessionList = await sessions.list("/my/project")
console.log(sessionList.length)

// Get a specific session
const session = await sessions.get("ses_123")
if (session) {
  console.log(session.title)
}

// Fetch messages for a session
const messageList = await messages.list("ses_123")
console.log(messageList.length)

// Get a specific message
const message = await messages.get("ses_123", "msg_456")
if (message) {
  console.log(message.role)
}
```

## Available APIs

### Sessions

```typescript
import { sessions } from "@opencode-vibe/core"

// List all sessions
const sessionList = await sessions.list(directory?)

// Get session by ID
const session = await sessions.get(id, directory?)
```

### Messages

```typescript
import { messages } from "@opencode-vibe/core"

// List messages for a session
const messageList = await messages.list(sessionId, directory?)

// Get message by ID
const message = await messages.get(sessionId, messageId, directory?)
```

### Parts

```typescript
import { parts } from "@opencode-vibe/core"

// List parts for a session
const partList = await parts.list(sessionId, directory?)

// Get part by ID
const part = await parts.get(sessionId, partId, directory?)
```

### Providers

```typescript
import { providers } from "@opencode-vibe/core"

// List all AI providers
const providerList = await providers.list()
```

### Projects

```typescript
import { projects } from "@opencode-vibe/core"

// List all projects
const projectList = await projects.list()

// Get current project
const project = await projects.current()
```

### Servers

```typescript
import { servers } from "@opencode-vibe/core"

// Discover servers
const serverList = await servers.discover()

// Get current server
const server = await servers.currentServer()
```

### SSE

```typescript
import { sse } from "@opencode-vibe/core"
import { Effect, Stream, Schedule, Duration } from "effect"

// Connect to SSE stream
const stream = sse.connect({ url: "http://localhost:4056" })

// Consume events (requires Effect)
await Effect.runPromise(
  Stream.runForEach(stream, (event) =>
    Effect.sync(() => console.log("Event:", event))
  ).pipe(Effect.retry(Schedule.exponential(Duration.seconds(3))))
)
```

### Subagents

```typescript
import { subagents } from "@opencode-vibe/core"

// Create subagent state
const stateRef = await subagents.create()

// Register a subagent session
await subagents.registerSubagent(
  stateRef,
  "child-123",
  "parent-456",
  "part-789",
  "TestAgent"
)

// Get sessions
const sessions = await subagents.getSessions(stateRef)
```

### Prompt Utilities

```typescript
import { prompt } from "@opencode-vibe/core"

// Insert file part
const { parts, cursor } = prompt.insertFilePart(
  currentParts,
  "src/file.ts",
  position,
  replaceLength
)

// Navigate autocomplete
const newIndex = prompt.navigateAutocomplete(currentIndex, "up", itemsLength)
```

## Effect API

For power users who want to work directly with Effect programs, use the `/effect` subpath:

```typescript
import { SessionAtom, MessageAtom, PartAtom } from "@opencode-vibe/core/effect"
import { Effect } from "effect"

// Effect programs
const program = Effect.gen(function* () {
  const sessions = yield* SessionAtom.list("/my/project")
  const messages = yield* MessageAtom.list(sessions[0].id)
  return { sessions, messages }
})

// Execute
const result = await Effect.runPromise(program)
```

## Architecture

- **Promise API** (`/api`) - Default, simple Promise-based API
- **Effect API** (`/effect`) - Power user API with Effect programs
- **Atoms** (`/atoms`) - Internal Effect atoms (same as `/effect`)

The Promise API wraps Effect atoms with `Effect.runPromise` for simplicity.
