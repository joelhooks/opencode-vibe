/**
 * List command - live hierarchical view of projects→sessions
 *
 * Shows hierarchical 📁 project → 🟢/⚪ session view sorted by activity.
 * Uses createMergedWorldStream().subscribe() pattern from watch.ts.
 *
 * Usage:
 *   swarm-cli list           # Live mode: watch for changes
 *   swarm-cli list --once    # Render once and exit (for agents)
 */

import { createMergedWorldStream, type WorldState } from "@opencode-vibe/core/world"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CommandContext } from "./index.js"
import { writeError } from "../output.js"
import { groupSessionsByProject } from "../transforms/project-groups.js"
import { formatProjectList } from "../formatters/list-formatter.js"

interface ListOptions {
	once?: boolean // Render once and exit (for agents)
	limit?: number // Maximum sessions per project (default 10)
	debug?: boolean // Show debug output (connection status, instance count, etc.)
}

/**
 * Parse command-line arguments into options
 */
function parseArgs(args: string[]): ListOptions {
	const options: ListOptions = {}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		switch (arg) {
			case "--once":
				options.once = true
				break
			case "--debug":
				options.debug = true
				break
			case "--limit": {
				const limitValue = args[i + 1]
				const limit = limitValue ? parseInt(limitValue, 10) : 10
				options.limit = Number.isNaN(limit) ? 10 : limit
				i++ // Skip next arg (the limit value)
				break
			}
			case "--help":
			case "-h":
				showHelp()
				process.exit(0)
		}
	}

	return options
}

/**
 * Show command help
 */
function showHelp(): void {
	console.log(`
╔═════════════════════════════════════════╗
║      📋 LIST - Project Sessions 📋      ║
╚═════════════════════════════════════════╝

Live hierarchical view of projects→sessions sorted by activity.

Usage:
  swarm-cli list [options]

Options:
  --once         Render once and exit (for agents)
  --limit N      Max sessions per project (default: 10)
  --debug        Show debug info (connection status, discovery, etc.)
  --help, -h     Show this message

Modes:
  Live (default): Continuously updates with changes. Press 'q' to quit.
  Once (--once):  Renders current state and exits immediately.

Output Format:
  📁 /path/to/project (N active)
     🟢 Running Session Title   2m ago   45%
     ⚪ Completed Session        5d ago   --

Legend:
  🟢 Active (status: running or pending)
  ⚪ Inactive (status: completed, error, idle)
  % = Context usage (tokens / limit)

Examples:
  swarm-cli list              # Watch for changes (10 sessions/project)
  swarm-cli list --once       # One-shot for agents
  swarm-cli list --limit 5    # Show only 5 most recent per project
`)
}

/**
 * Render world state to console
 *
 * @param world - Current world state
 * @param options - List options (controls footer and limit)
 */
function renderWorld(world: WorldState, options: ListOptions): void {
	// Clear screen only in live mode
	if (!options.once) {
		console.clear()
	}

	// Show discovery indicator during async discovery phase
	if (world.connectionStatus === "discovering") {
		const serverCount = world.instances.length
		if (serverCount === 0) {
			console.log("🔍 Discovering servers...")
		} else {
			console.log(
				`🔍 Found ${serverCount} server${serverCount === 1 ? "" : "s"}, loading sessions...`,
			)
		}
		if (!options.once) {
			console.log("\nwatching... press q to quit")
		}
		return
	}

	// Transform: WorldState → ProjectGroup[]
	const sessions = Array.from(world.sessions.values())
	const limit = options.limit ?? 10
	const groups = groupSessionsByProject(sessions, limit)

	// Format: ProjectGroup[] → string
	const output = formatProjectList(groups)

	// Render output
	if (output) {
		console.log(output)
	} else {
		// Only show "No sessions found" after discovery completes
		const statusMessage =
			world.connectionStatus === "disconnected"
				? "No sessions found. (No servers discovered)"
				: "No sessions found."
		console.log(statusMessage)
	}

	// Footer only in live mode
	if (!options.once) {
		console.log("\nwatching... press q to quit")
	}
}

/**
 * Run the list command
 */
export async function run(context: CommandContext): Promise<void> {
	const { args } = context
	const options = parseArgs(args)

	// Setup exit handling for live mode
	let running = true
	let stream: ReturnType<typeof createMergedWorldStream> | null = null

	// Handle 'q' key press in live mode
	if (!options.once) {
		process.stdin.setRawMode?.(true)
		process.stdin.resume()
		process.stdin.on("data", (key) => {
			if (key.toString() === "q" || key[0] === 3) {
				// 'q' or Ctrl+C
				running = false
			}
		})
	}

	// Handle Ctrl+C
	process.on("SIGINT", async () => {
		running = false
		if (stream) {
			await stream.dispose()
		}
	})

	try {
		// Auto-detect swarm.db at default location
		const defaultSwarmDbPath = path.join(os.homedir(), ".config", "swarm-tools", "swarm.db")
		const sources = []
		if (existsSync(defaultSwarmDbPath)) {
			// Import createSwarmDbSource dynamically to avoid circular deps
			const { createSwarmDbSource } = await import("@opencode-vibe/core/world")
			sources.push(createSwarmDbSource(defaultSwarmDbPath))
		}

		// Create merged world stream
		stream = createMergedWorldStream({ sources })

		// Throttle updates (same pattern as watch.ts)
		let lastUpdate = 0
		const UPDATE_INTERVAL = 500 // Update at most every 500ms
		const TIME_REFRESH_INTERVAL = 30000 // Refresh relative times every 30s

		// Store latest world state for periodic re-render
		let latestWorld: WorldState | null = null

		// Subscribe to world state changes
		let unsubscribe: (() => void) | undefined
		unsubscribe = stream.subscribe((world) => {
			if (!running) return

			// Always store latest world for periodic refresh
			latestWorld = world

			// Debug output
			if (options.debug) {
				const instanceInfo = world.instances.map((i) => `${i.port}:${i.status}`).join(", ")
				console.error(
					`[debug] status=${world.connectionStatus} instances=${world.instances.length} sessions=${world.sessions.length}`,
				)
				if (world.instances.length > 0) {
					console.error(`[debug] instances: ${instanceInfo}`)
				}
			}

			const now = Date.now()

			// Time-based throttling (NO COUNTER - learned from mem-9527414a6105e97e)
			const shouldDisplay = options.once || now - lastUpdate >= UPDATE_INTERVAL

			if (!shouldDisplay) {
				return // Rate-limited
			}

			lastUpdate = now

			// In --once mode, wait for connection to be ready before rendering
			// "discovering" = still scanning for servers
			// "connecting" = found servers, still bootstrapping sessions
			// "connected" = ready to show data
			// "disconnected" = no servers found
			const isReady =
				world.connectionStatus === "connected" || world.connectionStatus === "disconnected"

			if (options.once) {
				if (!isReady) {
					// Still loading - show minimal progress indicator only
					if (world.connectionStatus === "discovering") {
						const serverCount = world.instances.length
						if (serverCount === 0) {
							console.log("🔍 Discovering servers...")
						} else {
							console.log(
								`🔍 Found ${serverCount} server${serverCount === 1 ? "" : "s"}, loading sessions...`,
							)
						}
					}
					return // Don't render full output yet
				}

				// Ready - render once and exit
				renderWorld(world, options)
				running = false
				unsubscribe?.()
				if (stream) {
					stream.dispose()
				}
				process.exit(0)
			}

			// Live mode - render current state
			renderWorld(world, options)
		})

		// Periodic timer to refresh relative times (watch mode only)
		let timeRefreshInterval: ReturnType<typeof setInterval> | undefined
		if (!options.once) {
			timeRefreshInterval = setInterval(() => {
				if (!running || !latestWorld) return
				// Re-render with latest world state to update relative times
				renderWorld(latestWorld, options)
			}, TIME_REFRESH_INTERVAL)
		}

		// Keep running until exit (live mode only)
		if (!options.once) {
			await new Promise<void>((resolve) => {
				const checkInterval = setInterval(() => {
					if (!running) {
						clearInterval(checkInterval)
						if (timeRefreshInterval) {
							clearInterval(timeRefreshInterval)
						}
						unsubscribe?.()
						process.stdin.pause()
						if (stream) {
							stream.dispose()
						}
						resolve()
					}
				}, 100)
			})
			// Clean exit after loop
			process.exit(0)
		} else {
			// In --once mode, wait for first render then exit
			// The subscription callback handles exit
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
	} catch (error) {
		const errorDetails = {
			error: error instanceof Error ? error.message : String(error),
		}
		writeError("List command failed", errorDetails)

		if (process.env.NODE_ENV !== "test") {
			process.exit(1)
		}
		throw error
	}
}

export const description = "List projects and sessions by activity"
