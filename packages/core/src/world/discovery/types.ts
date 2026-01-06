/**
 * Unified Discovery Service Interface
 *
 * Defines the contract for server discovery across different implementations
 * (browser-based fetch proxy vs Node.js lsof scanning).
 *
 * Effect Layers provide implementations:
 * - DiscoveryNodeLive: Direct lsof process scanning
 *
 * @module world/discovery/types
 */

import { Effect } from "effect"

/**
 * Session summary for discovery response
 */
export interface DiscoveredSession {
	id: string
	title: string
	updatedAt: number
}

/**
 * Project summary for discovery response
 */
export interface DiscoveredProject {
	id: string
	directory: string
	name: string
}

/**
 * Discovered OpenCode server instance with full optional metadata
 *
 * Base fields (always present):
 * - port: Server port number
 * - pid: Process ID
 * - directory: Project working directory
 *
 * Optional fields (controlled by DiscoveryOptions):
 * - sessions: Session IDs (when includeSessions=true)
 * - sessionDetails: Full session metadata (when includeSessionDetails=true)
 * - project: Project metadata (when includeProjects=true)
 */
export interface DiscoveredServer {
	port: number
	pid: number
	directory: string
	/** Session IDs hosted by this server (when includeSessions=true) */
	sessions?: string[]
	/** Full session details (when includeSessionDetails=true) */
	sessionDetails?: DiscoveredSession[]
	/** Project info (when includeProjects=true) */
	project?: DiscoveredProject
}

/**
 * Server information (simplified - no optional metadata)
 *
 * Used by consumers that only need basic server info + URL.
 * Contrast with DiscoveredServer which supports full metadata.
 */
export interface ServerInfo {
	port: number
	directory: string
	url: string
}

/**
 * Discovery options control what metadata is fetched
 *
 * All fields are optional - implementations provide sensible defaults.
 * More metadata = longer discovery time (additional HTTP requests).
 */
export interface DiscoveryOptions {
	/** Include session IDs for each server (default: false) */
	includeSessions?: boolean
	/** Include full session details: id, title, updatedAt (default: false) */
	includeSessionDetails?: boolean
	/** Include project info: id, directory, name (default: false) */
	includeProjects?: boolean
	/** Timeout for verification requests in ms (default: 500) */
	timeout?: number
}

/**
 * Discovery Effect.Service interface
 *
 * THE contract for server discovery. Implementations provide layers:
 * - DiscoveryNodeLive: Direct lsof process scanning
 *
 * Returns Effect that:
 * - Never fails (graceful degradation to empty array)
 * - Has no dependencies (implementations provide their own)
 * - Respects DiscoveryOptions for metadata fetching
 */
export class Discovery extends Effect.Service<Discovery>()("Discovery", {
	effect: Effect.gen(function* () {
		return {
			/**
			 * Discover running OpenCode servers
			 *
			 * @param options - Controls what metadata to fetch (sessions, projects, etc)
			 * @returns Effect that yields DiscoveredServer[] (never fails, returns [] on error)
			 */
			discover: (options?: DiscoveryOptions): Effect.Effect<DiscoveredServer[]> =>
				Effect.succeed([]),
		}
	}),
}) {}
