/**
 * Project Grouping Transform
 *
 * Transforms flat WorldState sessions into project-grouped hierarchy.
 * Groups sessions by directory, sorts by activity, calculates active counts.
 */

import type { EnrichedSession } from "@opencode-vibe/core/world"

/**
 * Session with hierarchy metadata (children and depth)
 */
export interface HierarchicalSession extends EnrichedSession {
	children?: HierarchicalSession[] // Child sessions (parent→child via parentID)
	depth?: number // Nesting level (0-indexed, max 3 for 4 levels)
}

/**
 * Project group with sessions and metadata
 */
export interface ProjectGroup {
	directory: string // Project path (e.g., /Users/joel/Code/foo)
	sessions: HierarchicalSession[] // Sessions in this project, sorted by updated desc
	lastActivity: Date // Most recent session.time.updated in this project
	activeCount: number // Count of sessions with status running or pending
}

/**
 * Group sessions by project directory
 *
 * @param sessions - Flat list of sessions
 * @param limit - Maximum sessions per project (default 10)
 * @returns Project groups sorted by last activity (most recent first)
 */
export function groupSessionsByProject(sessions: EnrichedSession[], limit = 10): ProjectGroup[] {
	if (sessions.length === 0) {
		return []
	}

	const grouped = groupByDirectory(sessions)
	const projects = buildProjectGroups(grouped, limit)
	return sortByLastActivity(projects)
}

/**
 * Group sessions by directory path
 */
function groupByDirectory(sessions: EnrichedSession[]): Map<string, EnrichedSession[]> {
	const grouped = new Map<string, EnrichedSession[]>()

	for (const session of sessions) {
		const existing = grouped.get(session.directory) ?? []
		existing.push(session)
		grouped.set(session.directory, existing)
	}

	return grouped
}

/**
 * Build ProjectGroups from grouped sessions
 */
function buildProjectGroups(
	grouped: Map<string, EnrichedSession[]>,
	limit: number,
): ProjectGroup[] {
	const projects: ProjectGroup[] = []

	for (const [directory, directorySessions] of grouped) {
		const sortedSessions = sortSessionsByUpdated(directorySessions)
		const limitedSessions = sortedSessions.slice(0, limit)

		// Build hierarchy from flat list
		const hierarchicalSessions = buildSessionHierarchy(limitedSessions)

		const lastActivity = getLastActivity(limitedSessions)
		const activeCount = countActiveSessions(limitedSessions)

		projects.push({
			directory,
			sessions: hierarchicalSessions,
			lastActivity,
			activeCount,
		})
	}

	return projects
}

/**
 * Build session hierarchy from flat list using parentID
 * Max depth: 4 levels (0, 1, 2, 3)
 */
function buildSessionHierarchy(sessions: EnrichedSession[]): HierarchicalSession[] {
	const MAX_DEPTH = 3

	// Create lookup map for fast parent resolution
	const sessionMap = new Map<string, HierarchicalSession>()
	for (const session of sessions) {
		sessionMap.set(session.id, { ...session, children: [], depth: 0 })
	}

	// Separate roots from children
	const roots: HierarchicalSession[] = []
	const childSessions: HierarchicalSession[] = []

	for (const session of sessionMap.values()) {
		if (!session.parentID || !sessionMap.has(session.parentID)) {
			// Root session: no parent OR orphaned (parent not in this list)
			roots.push(session)
		} else {
			childSessions.push(session)
		}
	}

	// Attach children to parents recursively
	function attachChildren(parent: HierarchicalSession, currentDepth: number): void {
		if (currentDepth >= MAX_DEPTH) {
			// At max depth, don't attach children
			parent.children = undefined
			return
		}

		const children = childSessions.filter((s) => s.parentID === parent.id)
		if (children.length === 0) {
			parent.children = undefined
			return
		}

		// Sort children by updated timestamp (most recent first)
		const sortedChildren = sortSessionsByUpdated(children) as HierarchicalSession[]

		// Set depth and recursively attach grandchildren
		for (const child of sortedChildren) {
			child.depth = currentDepth + 1
			attachChildren(child, currentDepth + 1)
		}

		parent.children = sortedChildren
	}

	// Build hierarchy from roots
	for (const root of roots) {
		root.depth = 0
		attachChildren(root, 0)
	}

	// Return only top-level sessions (roots)
	return sortSessionsByUpdated(roots) as HierarchicalSession[]
}

/**
 * Sort sessions by time.updated (most recent first)
 */
function sortSessionsByUpdated(sessions: EnrichedSession[]): EnrichedSession[] {
	return [...sessions].sort((a, b) => {
		const aUpdated = a.time?.updated ?? -Infinity
		const bUpdated = b.time?.updated ?? -Infinity
		return bUpdated - aUpdated
	})
}

/**
 * Get last activity timestamp from sessions
 */
function getLastActivity(sessions: EnrichedSession[]): Date {
	const mostRecentTime = sessions[0]?.time?.updated ?? 0
	return new Date(mostRecentTime)
}

/**
 * Count sessions with status running or pending
 * Uses actual backend status from EnrichedSession
 */
function countActiveSessions(sessions: EnrichedSession[]): number {
	return sessions.filter((s) => {
		return s.status === "running" || s.status === "pending"
	}).length
}

/**
 * Sort projects by lastActivity (most recent first)
 */
function sortByLastActivity(projects: ProjectGroup[]): ProjectGroup[] {
	return projects.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
}
