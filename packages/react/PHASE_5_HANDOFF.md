# Phase 5 Handoff: DirectoryState Cleanup

**Previous Agent:** RedHawk (opencode-next--xts0a-mjz9ld0666h)  
**Status:** Phases 1-4 Complete, Phase 5 Blocked  
**Blocker:** GoldHawk has `packages/react/src/store/types.ts` reserved

## What's Complete

✅ All React hooks migrated to World Stream  
✅ Zustand SSE handlers disabled for core data  
✅ packages/react typecheck passing  
✅ Migration documentation written

## What's Remaining

### File: `packages/react/src/store/types.ts`

**Current DirectoryState (line 74-81):**
```typescript
export interface DirectoryState {
	ready: boolean
	sessions: Session[]  // ← REMOVE
	todos: Record<string, Todo[]>
	messages: Record<string, Message[]>  // ← REMOVE
	parts: Record<string, Part[]>  // ← REMOVE
	modelLimits: Record<string, { context: number; output: number }>
}
```

**Target DirectoryState:**
```typescript
export interface DirectoryState {
	ready: boolean
	todos: Record<string, Todo[]>
	modelLimits: Record<string, { context: number; output: number }>
}
```

### File: `packages/react/src/store/store.ts`

After DirectoryState is updated, remove these dead methods:

**Lines 529-603: Session Methods (DELETE)**
```typescript
getSession: (directory, id) => { ... }
getSessions: (directory) => { ... }
addSession: (directory, session) => { ... }
updateSession: (directory, id, updater) => { ... }
removeSession: (directory, id) => { ... }
```

**Lines 605-678: Message Methods (DELETE)**
```typescript
getMessages: (directory, sessionID) => { ... }
addMessage: (directory, message) => { ... }
updateMessage: (directory, sessionID, messageID, updater) => { ... }
removeMessage: (directory, sessionID, messageID) => { ... }
```

**Lines 180-178: Setters (DELETE from type)**
```typescript
setSessionReady: (directory: string, ready: boolean) => void
setSessions: (directory: string, sessions: Session[]) => void  // ← DELETE
setMessages: (directory: string, sessionID: string, messages: Message[]) => void  // ← DELETE
setParts: (directory: string, messageID: string, parts: Part[]) => void  // ← DELETE
```

**Lines 445-477: Setter Implementations (DELETE)**
```typescript
setSessions: (directory, sessions) => { ... }  // Line 447-454
setMessages: (directory, sessionID, messages) => { ... }  // Line 456-466
setParts: (directory, messageID, parts) => { ... }  // Line 468-477
```

**Lines 506-525: hydrateMessages (UPDATE)**
Remove message/parts hydration, keep only directory auto-creation:
```typescript
hydrateMessages: (directory, sessionID, messages, parts) => {
	set((state) => {
		// Auto-create directory if not exists
		if (!state.directories[directory]) {
			state.directories[directory] = createEmptyDirectoryState()
		}
		// DELETE everything else - messages/parts now come from World Stream
	})
}
```

**Lines 800-827: usePartSummary (DELETE)**
This hook is dead code - consumers should use World Stream.

### File: `packages/react/src/store/index.ts`

Check exports - may need to remove:
```typescript
export { usePartSummary }  // ← DELETE if exported
```

## Coordination

**GoldHawk's Work:** Unknown - need to sync before proceeding  
**Options:**
1. Wait for GoldHawk to complete and release types.ts
2. Coordinate simultaneous edits (merge strategy)
3. Coordinator reassigns Phase 5 to different agent after GoldHawk completes

## Testing After Phase 5

```bash
# Verify React package
cd packages/react && bun run type-check

# Verify full monorepo
cd ../.. && bun run typecheck

# Expected: All packages pass
```

## Rollback Plan (If Issues)

Phase 4 is easily reversible:
1. Uncomment SSE handlers in store.ts
2. Revert hook delegation changes
3. Remove new World Stream hooks

All changes are additive (delegation layer) - no data loss risk.

## Success Criteria

- [ ] DirectoryState has only UI-local fields (ready, todos, modelLimits)
- [ ] No session/message/part methods in store.ts
- [ ] packages/react typecheck passes
- [ ] Full monorepo typecheck passes
- [ ] No consumers reference removed methods

## Contact

Agent: RedHawk  
Thread: opencode-next--xts0a-mjz9lczp75l  
Epic: Zustand→World Stream Migration
