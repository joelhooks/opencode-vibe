/**
 * Atoms index - exports all state atoms
 *
 * All atoms are now pure Effect programs.
 * React hooks are in packages/react/src/hooks/
 *
 * @module atoms
 */

// Batch 1 - COMPLETED (Pure Effect programs)
export { SessionAtom } from "./sessions.js"
export { MessageAtom } from "./messages.js"
export { PartAtom } from "./parts.js"
export { SSEAtom, makeSSEAtom, sseAtom, type SSEConfig } from "./sse.js"

// Batch 2 - COMPLETED (Pure Effect programs / utilities)
export { ProviderAtom, type Provider, type Model } from "./providers.js"
export { ProjectAtom, type Project } from "./projects.js"
export { PromptUtil, type AutocompleteState } from "./prompt.js"

// Batch 3 - COMPLETED (Pure Effect programs)
export {
	SubagentAtom,
	type SubagentSession,
	type SubagentState,
} from "./subagents.js"

// Batch 4 - Commands
export { CommandAtom, type CustomCommand } from "./commands.js"
