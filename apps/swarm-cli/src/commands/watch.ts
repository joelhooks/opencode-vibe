/**
 * Watch command - live event stream with cursor resumption
 *
 * Streams events in real-time using createMergedWorldStream from core.
 * Auto-detects swarm.db at ~/.config/swarm-tools/swarm.db and merges with SSE.
 * Uses atom-based WorldStore for reactive state management.
 *
 * Usage:
 *   swarm-cli watch                           # Watch from now (SSE + auto-detected swarm.db)
 *   swarm-cli watch --cursor-file .cursor     # Persist cursor
 *   swarm-cli watch --sources /path/to/db     # Additional swarm.db sources
 *   swarm-cli watch --json                    # NDJSON output
 */

import {
	createMergedWorldStream,
	createSwarmDbSource,
	type EventSource,
	type SSEEventInfo,
	type WorldState,
} from "@opencode-vibe/core/world"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CommandContext } from "./index.js"
import {
	write,
	writeError,
	saveCursor,
	withLinks,
	formatNextSteps,
	StreamingAggregator,
	GroupedEventLog,
} from "../output.js"
import { formatWorldState, type ProjectState } from "../world-state.js"

interface WatchOptions {
	cursorFile?: string // Persist cursor after each event
	sources?: string[] // Additional swarm.db source paths
}

/**
 * Parse command-line arguments into options
 */
function parseArgs(args: string[]): WatchOptions {
	const options: WatchOptions = {}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]

		switch (arg) {
			case "--cursor-file":
				options.cursorFile = args[++i]
				break
			case "--sources": {
				// Parse comma-separated list of paths
				i++
				const sourcesArg = args[i]
				if (sourcesArg) {
					options.sources = sourcesArg.split(",").map((p) => p.trim())
				}
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
║      👁️  WATCH - Live Stream 👁️          ║
╚═════════════════════════════════════════╝

Stream world state in real-time using atom-based reactive state.
Auto-detects swarm.db at ~/.config/swarm-tools/swarm.db.

Usage:
  swarm-cli watch [options]

Options:
  --cursor-file <path>   Persist cursor after each update
  --sources <paths>      Comma-separated additional swarm.db paths
  --json                 NDJSON output (machine-readable)
  --help, -h             Show this message

SIGINT Handling:
  Press Ctrl+C to gracefully stop the stream.

Examples:
  swarm-cli watch --cursor-file .cursor --json
  swarm-cli watch --sources /custom/swarm.db
  swarm-cli watch --sources /path1/swarm.db,/path2/swarm.db
  swarm-cli watch                    # Watch from now (auto-detect)

Output:
  Shows aggregated world state from SSE and swarm.db sources.
  Events are tagged with [sse] or [swarm-db] source identifiers.
`)
}

/**
 * Run the watch command
 */
export async function run(context: CommandContext): Promise<void> {
	const { args, output } = context
	const options = parseArgs(args)

	// Cursor file can come from global options OR command options
	const cursorFile = output.cursorFile || options.cursorFile

	// Setup graceful shutdown
	let running = true
	let stream: ReturnType<typeof createMergedWorldStream> | null = null

	process.on("SIGINT", async () => {
		running = false
		if (output.mode === "pretty") {
			console.log("\n\nGracefully shutting down...")
		}
		if (stream) {
			await stream.dispose()
		}
		// Don't call process.exit() - let the main loop resolve naturally
		// This prevents "Unhandled Rejection" errors in vitest when SIGINT is emitted
	})

	try {
		if (output.mode === "pretty") {
			console.log("Discovering servers and connecting... (Ctrl+C to stop)\n")
		}

		// Rolling event log buffer (defaults to last 10 events per group)
		const eventLog = new GroupedEventLog()

		// Streaming event aggregator (throttles rapid message.part.updated events)
		const streamingAggregator = new StreamingAggregator({ throttleMs: 2000 })

		// Event count tracking for summary breakdown
		let sessionEventCount = 0
		let messageEventCount = 0
		let partEventCount = 0

		// Build sources array
		const sources: EventSource[] = []

		// Auto-detect swarm.db at default location
		const defaultSwarmDbPath = path.join(os.homedir(), ".config", "swarm-tools", "swarm.db")
		if (existsSync(defaultSwarmDbPath)) {
			sources.push(createSwarmDbSource(defaultSwarmDbPath))
		}

		// Add additional sources from --sources flag
		if (options.sources) {
			for (const sourcePath of options.sources) {
				if (existsSync(sourcePath)) {
					sources.push(createSwarmDbSource(sourcePath))
				}
			}
		}

		// Create merged world stream with event callback
		stream = createMergedWorldStream({
			sources,
			onEvent: (event: SSEEventInfo) => {
				// Track event counts by type prefix
				if (event.type.startsWith("session.")) {
					sessionEventCount++
				} else if (event.type.startsWith("message.")) {
					messageEventCount++
				} else if (event.type.startsWith("part.")) {
					partEventCount++
				}

				// Process through aggregator (handles streaming event throttling)
				const result = streamingAggregator.process(event)
				if (result) {
					eventLog.addEvent(event)
				}
			},
		})

		let updateCount = 0
		let lastWorldUpdate = 0
		const WORLD_UPDATE_INTERVAL = 500 // Update world view at most every 500ms
		let prevWorld: WorldState | undefined

		// Subscribe to world state changes (fires immediately with current state)
		const unsubscribe = stream.subscribe((world) => {
			if (!running) return

			const now = Date.now()

			// Throttle updates to avoid flickering
			// Use time-based throttling only - no blocking after N updates
			const shouldDisplay = now - lastWorldUpdate >= WORLD_UPDATE_INTERVAL

			if (!shouldDisplay) {
				return // Skip this update (rate-limited)
			}

			updateCount++
			lastWorldUpdate = now

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

				const worldWithLinks = withLinks(
					{
						updateCount,
						totalSessions: world.stats.total,
						activeSessions: world.stats.active,
						streamingSessions: world.stats.streaming,
						projects: projects.map((p) => ({
							directory: p.directory,
							sessionCount: p.sessions.length,
							activeCount: p.activeCount,
							totalMessages: p.totalMessages,
						})),
					},
					{
						status: "swarm-cli status",
					},
				)
				write(output, worldWithLinks)
			} else {
				// Clear screen and redraw world state
				console.clear()
				console.log(formatWorldState(world, prevWorld))

				// Event count summary breakdown
				const summary = `\nUpdates received: ${updateCount} (${sessionEventCount} sessions, ${messageEventCount} messages, ${partEventCount} parts)`
				console.log(summary)

				// Display recent events (grouped by source)
				const formattedEvents = eventLog.format()
				if (formattedEvents) {
					console.log("\nRecent Events:")
					console.log(formattedEvents)
				}

				console.log("\nWatching for changes... (Ctrl+C to stop)")
			}

			// Store current world as previous for next iteration
			prevWorld = world

			// Persist cursor if configured
			if (cursorFile) {
				saveCursor(cursorFile, String(updateCount)).catch((err) => {
					console.error(`[cursor] Failed to save: ${err}`)
				})
			}
		})

		// Show initial state
		const initialWorld = await stream.getSnapshot()

		if (output.mode === "pretty") {
			console.log(formatWorldState(initialWorld))
			console.log("\n✓ Connected! Watching for changes...\n")
			console.log(
				formatNextSteps([
					"💾 Persist cursor: swarm-cli watch --cursor-file .cursor",
					"📊 Status: swarm-cli status",
				]),
			)
		}

		// Keep running until SIGINT
		await new Promise<void>((resolve) => {
			const checkInterval = setInterval(() => {
				if (!running) {
					clearInterval(checkInterval)
					unsubscribe()
					resolve()
				}
			}, 100)
		})
	} catch (error) {
		const errorDetails = {
			error: error instanceof Error ? error.message : String(error),
			...(output.mode === "json" && {
				_links: {
					retry: "swarm-cli watch",
					status: "swarm-cli status",
					help: "swarm-cli watch --help",
				},
			}),
		}
		writeError("Stream failed", errorDetails)

		if (output.mode === "pretty") {
			console.error(
				formatNextSteps([
					"🔄 Retry: swarm-cli watch",
					"📡 Check status: swarm-cli status",
					"❓ Get help: swarm-cli watch --help",
				]),
			)
		}
		// Only exit with error code in production - let tests handle errors naturally
		if (process.env.NODE_ENV !== "test") {
			process.exit(1)
		}
		throw error
	}
}

export const description = "Watch live world state stream"
