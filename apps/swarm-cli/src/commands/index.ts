/**
 * Command registry
 *
 * Each command provides:
 * - description: Short help text
 * - run: Async function that executes the command
 */

import type { OutputConfig } from "../output.js"
import * as statusCmd from "./status.js"
import * as watchCmd from "./watch.js"
import * as listCmd from "./list.js"

export interface CommandContext {
	args: string[]
	output: OutputConfig
}

export interface Command {
	description: string
	run: (context: CommandContext) => Promise<void>
}

/**
 * Command registry
 *
 * Commands: status (observe), watch (monitor), list (projects→sessions).
 * Progressive discovery: tools teach by doing, not front-loaded complexity.
 */
export const commands: Record<string, Command> = {
	status: {
		description: statusCmd.description,
		run: statusCmd.run,
	},
	watch: {
		description: watchCmd.description,
		run: watchCmd.run,
	},
	list: {
		description: listCmd.description,
		run: listCmd.run,
	},
}

/**
 * Show help text for all commands
 */
export function showHelp(): void {
	console.log(`
╔═════════════════════════════════════════╗
║      🐝 SWARM CLI - Agent Control 🐝     ║
╚═════════════════════════════════════════╝

Agent-friendly CLI for OpenCode swarm coordination.

Usage:
  swarm-cli <command> [options]

Commands:`)

	const maxLen = Math.max(...Object.keys(commands).map((k) => k.length), 8)
	for (const [name, cmd] of Object.entries(commands)) {
		console.log(`  ${name.padEnd(maxLen)}  ${cmd.description}`)
	}

	console.log(`
Options:
  --json              NDJSON output (machine-readable)
  --pretty            Human-readable output (default)
  --cursor-file PATH  Persist cursor to file
  --help, -h          Show this message

Output Modes:
  JSON mode outputs newline-delimited JSON for streaming.
  Pretty mode outputs human-readable formatted text.

Progressive Discovery:
  JSON output includes _links for next actions.
  Pretty mode shows "Next steps" in help.

Examples:
  swarm-cli --help                    # Show this help
  swarm-cli status --json             # Get status as NDJSON
  swarm-cli watch --cursor-file .cur  # Watch with cursor persistence

Run 'swarm-cli <command> --help' for command-specific help.
`)
}

/**
 * Parse global options from args
 * Returns { options, remainingArgs }
 */
export function parseGlobalOptions(args: string[]): {
	output: OutputConfig
	remainingArgs: string[]
} {
	const output: OutputConfig = {
		mode: "pretty",
	}

	const remainingArgs: string[] = []

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]

		if (arg === "--json") {
			output.mode = "json"
		} else if (arg === "--pretty") {
			output.mode = "pretty"
		} else if (arg === "--cursor-file") {
			output.cursorFile = args[++i]
		} else {
			remainingArgs.push(arg!)
		}
	}

	return { output, remainingArgs }
}
