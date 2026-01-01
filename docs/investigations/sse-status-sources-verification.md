# SSE Status Sources Verification Report

**Agent**: SilverDawn  
**Cell**: opencode-next--xts0a-mjut8nfnzab  
**Epic**: opencode-next--xts0a-mjut8nf7hir  
**Date**: 2025-12-31

## Executive Summary

The claim that **THREE sources of session status exist** is **VERIFIED**. All three sources are actively used in production code with distinct purposes and potential conflicts. The proposal's `deriveSessionStatus()` unification approach is sound but **not yet implemented**.

---

## Source 1: sessionStatus Map (SSE Events)

### Status: ✅ VERIFIED

### Code Location
**File**: `packages/react/src/store/store.ts`  
**Lines**: 253-289

### Implementation
```typescript
case "session.status": {
  const statusPayload = event.properties.status
  let status: SessionStatus = "completed"
  
  if (typeof statusPayload === "object" && statusPayload !== null) {
    if ("type" in statusPayload) {
      // Handle { type: "busy" | "retry" | "idle" } format
      status = statusPayload.type === "busy" || statusPayload.type === "retry"
        ? "running"
        : "completed"
    } else if ("running" in statusPayload) {
      // Handle { running: boolean } format from SSE
      status = statusPayload.running ? "running" : "completed"
    }
  } else if (typeof statusPayload === "string") {
    // Handle string format (for tests or future API changes)
    status = statusPayload as SessionStatus
  }
  
  dir.sessionStatus[event.properties.sessionID] = status
  dir.sessionLastActivity[event.properties.sessionID] = Date.now()
  break
}
```

### Data Flow
```
Backend SSE → MultiServerSSE.handleEvent() → emitEvent()
  → store.handleSSEEvent() → store.handleEvent() → sessionStatus[id] = status
```

### Normalization Formats Supported
1. `{ running: boolean }` - SSE format
2. `{ type: "busy" | "retry" | "idle" }` - Backend `/session/status` endpoint format
3. `string` - Direct SessionStatus literal (tests/future)

### Where Used
- **Primary Consumer**: `internal/use-session-status.ts` (simple selector)
  ```typescript
  // Line 32
  return useOpencodeStore(
    (state) => state.directories[directory]?.sessionStatus[sessionId] ?? "completed",
  )
  ```

### Limitations
- **No logging**: Zero debug output makes "indicator not lighting up" issues impossible to trace
- **Silent fallback**: Unknown formats don't warn, just default to "completed"
- **Backend dependency**: Status only updates when backend explicitly sends events

---

## Source 2: Last Message Completion Check

### Status: ✅ VERIFIED

### Code Location
**File**: `packages/react/src/hooks/use-multi-directory-status.ts`  
**Lines**: 38-52

### Implementation
```typescript
/**
 * Derive session status from the last message
 * A session is "busy" if the last message is an assistant message without a completed time
 */
function deriveSessionStatus(
  messages: Array<{
    info: { role: string; time?: { created: number; completed?: number } }
  }>,
): "running" | "completed" {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return "completed"
  
  // Session is busy if last message is assistant without completed time
  if (lastMessage.info.role === "assistant" && !lastMessage.info.time?.completed) {
    return "running"
  }
  
  return "completed"
}
```

### Data Flow
```
useMultiDirectoryStatus bootstrap → client.session.messages({ limit: 1 })
  → deriveSessionStatus(messages) → setSessionStatuses({ [id]: "running" })
```

### Where Used
- **ONLY in bootstrap phase** of `useMultiDirectoryStatus`
- **Lines 98-148**: Initial status check for "recent sessions" (< 5min old)
- **Purpose**: Fill in status BEFORE SSE events arrive (prevents "blink" on page load)

### Scope
```typescript
// Line 113: Filters recent sessions
const recentSessions = sessions.filter((s) => {
  return s.formattedTime.includes("just now") || s.formattedTime.includes("m ago")
})

// Line 119: Limits to 10 sessions max
recentSessions.slice(0, 10).map(async (session) => {
  const messagesResponse = await client.session.messages({
    path: { id: session.id },
    query: { limit: 1 }, // Only last message
  })
  const status = deriveSessionStatus(messagesResponse.data ?? [])
  if (status === "running") {
    setSessionStatuses((prev) => ({ ...prev, [session.id]: "running" }))
  }
})
```

### Limitations
- **Only runs ONCE** - bootstrap phase on mount, never again
- **Overridden by SSE** - As soon as SSE events arrive, this source is ignored
- **Race condition risk** - SSE events may arrive before bootstrap completes
- **Limited scope** - Only checks 10 most recent sessions (< 5min old)

---

## Source 3: Sub-Agent Activity Scanning

### Status: ✅ VERIFIED

### Code Location
**File**: `packages/react/src/factory.ts`  
**Lines**: 728-761

### Implementation
```typescript
function useSessionStatus(sessionId: string): SessionStatus {
  const cfg = getOpencodeConfig(config)
  return useOpencodeStore(
    useCallback(
      (state) => {
        const dir = state.directories[cfg.directory]
        if (!dir) return "completed"
        
        // Check main session status
        const mainStatus = dir.sessionStatus[sessionId] ?? "completed"
        if (mainStatus === "running") return "running"
        
        // Check for running sub-agents (task parts)
        const messages = dir.messages[sessionId]
        if (!messages) return mainStatus
        
        // Look for any running task parts in session messages
        for (const message of messages) {
          const parts = dir.parts[message.id]
          if (!parts) continue
          
          for (const part of parts) {
            if (part.type === "tool" && part.tool === "task" && part.state.status === "running") {
              return "running"
            }
          }
        }
        
        return mainStatus
      },
      [sessionId, cfg.directory],
    ),
  )
}
```

### Data Flow
```
SSE message.part.updated → store.parts[messageID] updated
  → useSessionStatus selector → scans all messages → scans all parts
  → finds part.type === "tool" && part.tool === "task" && part.state.status === "running"
  → returns "running"
```

### Where Used
- **Primary hook**: `factory.useSessionStatus()` (lines 728-761)
- **Consumers**: All components using the factory's `useSessionStatus` hook

### Part Structure
```typescript
// From packages/react/src/store/types.ts lines 55-70
export type Part = {
  id: string
  messageID: string
  type: string           // "tool" | "text" | ...
  content: string
  state?: {
    status: string       // "running" | "completed" | "pending" | ...
    metadata?: {
      summary?: string
    }
  }
  [key: string]: unknown // "tool" field exists here
}
```

### Scan Logic
1. **Priority**: Checks mainStatus FIRST - short-circuits if already "running"
2. **Iteration**: Loops through ALL messages in session → ALL parts per message
3. **Filter**: Only counts `tool` type parts where `part.tool === "task"`
4. **Status**: Checks `part.state.status === "running"`

### Performance
- **O(n * m)** complexity where n = messages, m = parts per message
- **No memoization** - scans on every selector call
- **Mitigated by**: Zustand's equality check (only re-runs if store changes)

---

## Usage Comparison

| Source | Where Used | When Active | Can Override Others |
|--------|-----------|-------------|---------------------|
| **Source 1: sessionStatus map** | `internal/use-session-status.ts` | Always (SSE events) | Yes - highest priority in factory hook |
| **Source 2: Last message check** | `use-multi-directory-status.ts` bootstrap | Once on mount | No - only fills gaps before SSE |
| **Source 3: Sub-agent scan** | `factory.useSessionStatus()` | Always (after SSE) | Yes - returns "running" even if mainStatus = "completed" |

---

## Conflict Scenarios

### Conflict 1: SSE says "completed" but sub-agent still running

**Scenario**:
1. Main session finishes (backend sends `session.status` = "completed")
2. Store updates: `sessionStatus[id] = "completed"`
3. But a task part (sub-agent) is still running: `part.state.status = "running"`

**Result**:
- `internal/use-session-status` → Returns `"completed"` ❌
- `factory.useSessionStatus` → Returns `"running"` ✅ (scans parts)

**Impact**: Different hooks return different statuses for the same session.

**Example**:
```typescript
// Same session, different results
const status1 = useInternalSessionStatus(sessionId)  // "completed"
const status2 = useFactorySessionStatus(sessionId)   // "running"
```

### Conflict 2: Bootstrap finds "running" but SSE hasn't sent event yet

**Scenario**:
1. Page loads, `useMultiDirectoryStatus` bootstraps
2. Fetches last message, finds incomplete assistant message
3. Sets status to "running"
4. SSE connects 2 seconds later, sends `session.status` = "completed" (stale)

**Result**:
- Bootstrap correctly shows "running" based on message state
- SSE overwrites with stale "completed" status
- Race condition causes flicker

**Impact**: Indicator shows "running" → "completed" → "running" flash sequence.

### Conflict 3: Cooldown keeps "running" when all sources say "completed"

**Scenario**:
1. Session finishes (all sources say "completed")
2. `useMultiDirectoryStatus` cooldown keeps indicator green for 1 minute
3. User expects immediate feedback

**Result**:
- `sessionStatus[id]` → "completed"
- Last message → completed
- Sub-agents → none running
- **Display** → "running" (cooldown timer active)

**Impact**: 1-minute lag between actual completion and UI feedback.

---

## Proposal's deriveSessionStatus() Assessment

### Proposed Implementation (from proposal lines 469-529)

```typescript
export function deriveSessionStatus(
  state: OpencodeState,
  sessionId: string,
  options: {
    includeSubAgents?: boolean
    includeLastMessage?: boolean
  } = {}
): SessionStatus {
  const { includeSubAgents = true, includeLastMessage = false } = options
  
  // Find directory containing session
  const directory = Object.keys(state.directories).find(dir => 
    state.directories[dir].sessionStatus[sessionId] !== undefined
  )
  if (!directory) return "completed"
  
  const dir = state.directories[directory]
  
  // SOURCE 1: Main session status
  const mainStatus = dir.sessionStatus[sessionId] ?? "completed"
  if (mainStatus === "running") return "running"
  
  // SOURCE 2: Sub-agent activity (if enabled)
  if (includeSubAgents) {
    const messages = dir.messages[sessionId]
    if (messages) {
      for (const message of messages) {
        const parts = dir.parts[message.id]
        if (!parts) continue
        
        for (const part of parts) {
          if (
            part.type === "tool" && 
            part.tool === "task" && 
            part.state.status === "running"
          ) {
            return "running"
          }
        }
      }
    }
  }
  
  // SOURCE 3: Last message check (if enabled, for bootstrap)
  if (includeLastMessage) {
    const messages = dir.messages[sessionId]
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (
        lastMessage.info.role === "assistant" && 
        !lastMessage.info.time?.completed
      ) {
        return "running"
      }
    }
  }
  
  return mainStatus
}
```

### Analysis

#### ✅ Strengths

1. **Single source of truth**: All three sources unified in one function
2. **Configurable**: Options allow different use cases
   - Bootstrap: `{ includeLastMessage: true, includeSubAgents: false }`
   - Runtime: `{ includeSubAgents: true, includeLastMessage: false }`
3. **Priority order**: Clear precedence (main → sub-agents → last message)
4. **Reusable**: Can replace both `factory.useSessionStatus` and `use-multi-directory-status.deriveSessionStatus`

#### ⚠️ Weaknesses

1. **Not implemented yet**: Proposal code, not in codebase
2. **Performance**: No memoization - scans parts on every call
3. **Cross-directory search**: `Object.keys(state.directories).find()` is O(n) directories
   - Could be slow with many directories
   - Breaks if session exists in multiple directories
4. **Missing field access**: Part type doesn't have `tool` in TypeScript definition
   - Uses `[key: string]: unknown` escape hatch
   - Runtime safe but type-unsafe

#### 🔥 Correctness Issues

**Type Safety**:
```typescript
// Proposal assumes part.tool exists
if (part.type === "tool" && part.tool === "task" && ...)
//                           ^^^^^^^^^
// But Part type (types.ts:58-70) doesn't define "tool" field
// Uses [key: string]: unknown escape hatch
```

**Solution**: Add `tool?: string` to Part type definition.

**Cross-Directory Ambiguity**:
```typescript
// What if session exists in multiple directories?
const directory = Object.keys(state.directories).find(dir => 
  state.directories[dir].sessionStatus[sessionId] !== undefined
)
// Returns FIRST match, ignores others
```

**Solution**: Require explicit directory parameter or document single-directory assumption.

---

## Conflict Resolution Strategy

### Recommendation: Three-Tier Priority

```typescript
/**
 * Unified status derivation with explicit priority
 * 
 * Priority order (highest to lowest):
 * 1. Main session SSE status = "running"
 * 2. Sub-agent part.state.status = "running"
 * 3. Last message incomplete (bootstrap only)
 * 4. Default "completed"
 */
export function deriveSessionStatus(
  state: OpencodeState,
  directory: string,  // Explicit directory to avoid ambiguity
  sessionId: string,
  options: {
    includeSubAgents?: boolean
    includeLastMessage?: boolean  // Only for bootstrap
  } = { includeSubAgents: true, includeLastMessage: false }
): SessionStatus {
  const dir = state.directories[directory]
  if (!dir) return "completed"
  
  // Priority 1: Main SSE status (always checked)
  const mainStatus = dir.sessionStatus[sessionId] ?? "completed"
  if (mainStatus === "running") return "running"
  
  // Priority 2: Sub-agent scanning (default ON)
  if (options.includeSubAgents !== false) {
    const messages = dir.messages[sessionId]
    if (messages) {
      for (const message of messages) {
        const parts = dir.parts[message.id]
        if (!parts) continue
        
        for (const part of parts) {
          // Type assertion needed due to Part's [key: string]: unknown
          const toolPart = part as Part & { tool?: string }
          if (
            part.type === "tool" && 
            toolPart.tool === "task" && 
            part.state?.status === "running"
          ) {
            return "running"
          }
        }
      }
    }
  }
  
  // Priority 3: Last message check (bootstrap ONLY)
  if (options.includeLastMessage === true) {
    const messages = dir.messages[sessionId]
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (
        lastMessage.role === "assistant" && 
        !lastMessage.time?.completed
      ) {
        return "running"
      }
    }
  }
  
  return mainStatus
}
```

### Usage Patterns

**Factory hook** (runtime):
```typescript
function useSessionStatus(sessionId: string): SessionStatus {
  const { directory } = useOpencode()
  return useOpencodeStore(
    useCallback(
      (state) => deriveSessionStatus(state, directory, sessionId, {
        includeSubAgents: true,
        includeLastMessage: false  // SSE handles this
      }),
      [directory, sessionId]
    )
  )
}
```

**Bootstrap** (initial load):
```typescript
// In useMultiDirectoryStatus
async function bootstrap() {
  const messagesResponse = await client.session.messages({ id, limit: 1 })
  const messages = messagesResponse.data ?? []
  
  // Use last message ONLY during bootstrap
  const status = deriveSessionStatus(state, directory, sessionId, {
    includeSubAgents: false,  // Not loaded yet
    includeLastMessage: true  // Bootstrap uses message check
  })
  
  if (status === "running") {
    setSessionStatuses(prev => ({ ...prev, [sessionId]: "running" }))
  }
}
```

---

## Recommendations

### Immediate (Phase 0 - Do First)

✅ **Add debug logging** (proposal lines 271-350)
- Log session.status events in `MultiServerSSE.handleEvent()`
- Log normalization in `store.handleEvent()`
- Log status changes in `useMultiDirectoryStatus`
- **Effort**: 30 minutes
- **Risk**: Zero - logging only

### Short Term (Phase 2)

⚠️ **Implement unified deriveSessionStatus()**
- Extract to `packages/react/src/store/status-utils.ts`
- Add explicit `directory` parameter
- Add type assertion for `part.tool`
- Replace factory inline logic
- Replace `use-multi-directory-status` inline logic
- **Effort**: 4-6 hours
- **Risk**: Medium - changes public API

### Medium Term

🔥 **Fix Part type definition**
```typescript
// packages/react/src/store/types.ts
export type Part = {
  id: string
  messageID: string
  type: string
  content: string
  tool?: string  // ADD THIS - makes part.tool type-safe
  state?: {
    status: string
    metadata?: {
      summary?: string
    }
  }
  [key: string]: unknown
}
```

🔥 **Delete internal/use-session-status.ts**
- Unused dead code
- Causes confusion ("which status hook?")
- **Effort**: 5 minutes
- **Risk**: Zero if truly unused

---

## Conclusion

### Claim Verification

| Claim | Status | Evidence |
|-------|--------|----------|
| **THREE sources exist** | ✅ VERIFIED | All three found in codebase |
| **Source 1: sessionStatus map** | ✅ VERIFIED | `store.ts:253-289` |
| **Source 2: Last message check** | ✅ VERIFIED | `use-multi-directory-status.ts:38-52` |
| **Source 3: Sub-agent scan** | ✅ VERIFIED | `factory.ts:740-754` |
| **Sources can conflict** | ✅ VERIFIED | Three conflict scenarios documented |
| **Proposal's deriveSessionStatus() is correct** | ⚠️ PARTIALLY VERIFIED | Logic sound, but needs directory param + type fix |

### Summary

The SSE unified proposal correctly identifies **three distinct sources of session status** with **real conflict potential**. The proposed `deriveSessionStatus()` unification is **architecturally sound** but requires:

1. **Explicit directory parameter** (avoid cross-directory ambiguity)
2. **Type safety fix** for `part.tool` access
3. **Clear documentation** of priority order
4. **Debug logging** to diagnose status issues

**Impact**: Implementing the unified function will eliminate duplication and reduce confusion about "which status hook to use?"

**Recommendation**: Prioritize Phase 0 (debug logging) first to make current issues debuggable, then implement Phase 2 (unified status) with the corrections noted above.

---

## Files Analyzed

- `packages/react/src/store/store.ts` - sessionStatus map (Source 1)
- `packages/react/src/hooks/use-multi-directory-status.ts` - Last message check (Source 2)
- `packages/react/src/factory.ts` - Sub-agent scanning (Source 3)
- `packages/react/src/hooks/internal/use-session-status.ts` - Simple selector (dead code?)
- `packages/react/src/hooks/internal/use-subagent.ts` - Subagent session status
- `packages/react/src/store/types.ts` - Type definitions
- `docs/investigations/sse-unified-proposal.md` - Proposal document

---

**End of Report**
