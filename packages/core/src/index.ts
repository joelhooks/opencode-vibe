/**
 * @opencode-vibe/core - The OpenCode Engine
 *
 * Core package providing atoms, discovery, SSE, client, and utilities.
 * This is the main entry point - for specific modules, import from subpaths:
 *
 * - @opencode-vibe/core/atoms - State atoms
 * - @opencode-vibe/core/discovery - Server discovery
 * - @opencode-vibe/core/sse - SSE streaming
 * - @opencode-vibe/core/client - API client
 * - @opencode-vibe/core/utils - Utilities
 * - @opencode-vibe/core/types - Type definitions
 */

// Enable Zod→Effect bridge (adds .effect methods to Zod schemas)
import "@zod-plugin/effect"

// Re-export main modules
export * from "./atoms/index.js"
export * from "./discovery/index.js"
export * from "./sse/index.js"
export * from "./client/index.js"
export * from "./utils/index.js"
export * from "./types/index.js"
