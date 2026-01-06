/**
 * Status command - world state snapshot
 *
 * Shows current swarm status with aggregated world state.
 * Uses createWorldStream from core for SSE-wired atom-based state.
 */

import { createMergedWorldStream } from "@opencode-vibe/core/world"
import { DiscoveryNodeLive } from "@opencode-vibe/core/world/discovery/node"
import type { CommandContext } from "./index.js"
import { write, withLinks } from "../output.js"
import { formatWorldState, type ProjectState } from "../world-state.js"

export async function run(context: CommandContext): Promise<void> {
	const { output } = context

	if (output.mode === "pretty") {
		console.log("🔍 Discovering servers...\n")
	}

	// Create world stream - use Node.js discovery for CLI
	const stream = createMergedWorldStream({ discoveryLayer: DiscoveryNodeLive })

	try {
		// Wait a moment for bootstrap to complete
		await new Promise((resolve) => setTimeout(resolve, 1000))

		// Get snapshot
		const world = await stream.getSnapshot()

		// Check if we found any sessions
		if (world.stats.total === 0) {
			if (output.mode === "json") {
				const data = withLinks(
					{ servers: 0, discovered: [], world: null },
					{
						start: "cd ~/project && opencode",
						retry: "swarm-cli status",
					},
				)
				write(output, data)
			} else {
				console.log("✗ No OpenCode servers found")
				console.log("\nTo connect to a server:")
				console.log("  1. Start OpenCode:  cd ~/project && opencode")
				console.log("  2. Then run:        swarm-cli status")
				console.log("\nTIP: OpenCode must be running in a project directory")
			}
			await stream.dispose()
			return
		}

		if (output.mode === "json") {
			// Convert byDirectory to projects array for JSON output
			const projects: ProjectState[] = []
			for (const [directory, sessions] of world.byDirectory) {
				const sortedSessions = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
				projects.push({
					directory,
					sessions: sortedSessions,
					activeCount: sortedSessions.filter((s) => s.isActive).length,
					totalMessages: sortedSessions.reduce((sum, s) => sum + s.messages.length, 0),
					lastActivityAt: Math.max(...sortedSessions.map((s) => s.lastActivityAt)),
				})
			}

			const data = withLinks(
				{
					servers: world.byDirectory.size,
					world: {
						projects: projects.map((p) => ({
							directory: p.directory,
							sessionCount: p.sessions.length,
							activeCount: p.activeCount,
							totalMessages: p.totalMessages,
							sessions: p.sessions.slice(0, 5).map((s) => ({
								id: s.id,
								status: s.status,
								messageCount: s.messages.length,
								isStreaming: s.messages.some((m) => m.isStreaming),
							})),
						})),
						totalSessions: world.stats.total,
						activeSessions: world.stats.active,
						streamingSessions: world.stats.streaming,
					},
				},
				{
					watch: "swarm-cli watch",
					watchLive: "swarm-cli watch --cursor-file .cursor",
				},
			)
			write(output, data)
		} else {
			// Pretty output with world state visualization
			console.log(formatWorldState(world))
			console.log("")
			console.log("Next steps:")
			console.log("  swarm-cli watch                    # Stream live events")
			console.log("  swarm-cli watch --cursor-file .cur # Persist cursor for resumption")
			console.log("  swarm-cli status --json            # Machine-readable output")
		}

		// Cleanup
		await stream.dispose()
	} catch (error) {
		if (output.mode === "pretty") {
			console.log(
				`⚠️  Failed to get world state: ${error instanceof Error ? error.message : "unknown error"}`,
			)
		}
		await stream.dispose()
	}
}

export const description = "Show world state snapshot from all servers"
