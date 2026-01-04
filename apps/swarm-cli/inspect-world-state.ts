#!/usr/bin/env bun

/**
 * Inspect WorldState to see actual data shapes
 * Helps understand what createMergedWorldStream() returns
 */

import { createMergedWorldStream } from "@opencode-vibe/core/world"
import { inspect } from "node:util"

console.log("🔍 Inspecting WorldState...\n")

const stream = createMergedWorldStream({ sources: [] })

let unsubscribe: (() => void) | undefined

unsubscribe = stream.subscribe((world) => {
	console.log("📊 WorldState received:")
	console.log("=".repeat(60))

	// Check if statuses map exists
	console.log("\n🗺️  Checking for 'statuses' in WorldState:")
	console.log("  statuses field exists:", "statuses" in world)
	console.log("  WorldState keys:", Object.keys(world))

	// Sample first session
	const sessions = Array.from(world.sessions.values())
	if (sessions.length > 0) {
		const session = sessions[0]
		if (session) {
			console.log("\n📝 First session structure:")
			console.log("  id:", session.id)
			console.log("  title:", session.title)
			console.log("  status field exists:", "status" in session)
			console.log("  status value:", session.status)
			console.log("  status type:", typeof session.status)

			if (typeof session.status === "object" && session.status !== null) {
				console.log("  status.type:", (session.status as any).type)
			}

			console.log("\n  Full session keys:", Object.keys(session))
			console.log("\n  Session.status detailed:")
			console.log(inspect(session.status, { depth: 3, colors: true }))
		}
	}

	// Check byDirectory map
	console.log("\n🗂️  byDirectory structure:")
	console.log("  Type:", world.byDirectory instanceof Map ? "Map" : typeof world.byDirectory)
	console.log("  Size:", world.byDirectory.size)

	// Stats
	console.log("\n📈 Stats:")
	console.log("  Total sessions:", sessions.length)
	console.log("  activeSessionCount:", world.activeSessionCount)
	console.log("  connectionStatus:", world.connectionStatus)

	console.log("\n" + "=".repeat(60))
	console.log("\n✅ Inspection complete. Press Ctrl+C to exit.")

	// Exit after first snapshot in --once mode
	if (unsubscribe) {
		unsubscribe()
	}
	stream.dispose()
	process.exit(0)
})

// Timeout in case no data comes through
setTimeout(() => {
	console.log("\n⏱️  Timeout - no data received after 5 seconds")
	stream.dispose()
	process.exit(1)
}, 5000)
