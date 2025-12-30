/**
 * Projects API - Promise-based wrapper
 *
 * Promise-based API for project operations.
 * Wraps ProjectAtom Effect programs with Effect.runPromise.
 *
 * @module api/projects
 */

import { Effect } from "effect"
import { ProjectAtom, type Project } from "../atoms/projects.js"

/**
 * Project API namespace
 *
 * Promise-based wrappers around ProjectAtom.
 */
export const projects = {
	/**
	 * Fetch all projects
	 *
	 * @returns Promise that resolves to Project array
	 *
	 * @example
	 * ```typescript
	 * const projects = await projects.list()
	 * console.log(projects.length)
	 * ```
	 */
	list: (): Promise<Project[]> => Effect.runPromise(ProjectAtom.list()),

	/**
	 * Get the current project
	 *
	 * @returns Promise that resolves to Project or null
	 *
	 * @example
	 * ```typescript
	 * const project = await projects.current()
	 * if (project) {
	 *   console.log(project.worktree)
	 * }
	 * ```
	 */
	current: (): Promise<Project | null> => Effect.runPromise(ProjectAtom.current()),
}

// Export types for consumers
export type { Project }
