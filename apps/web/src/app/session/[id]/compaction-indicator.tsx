"use client"

import { useCompactionState } from "@opencode-vibe/react"
import { Loader } from "@/components/ai-elements/loader"
import { cn } from "@/lib/utils"

interface CompactionIndicatorProps {
	sessionId: string
}

/**
 * CompactionIndicator - Display compaction status with spinner
 *
 * Shows during compaction with:
 * - Spinner (surfer emoji 🏄‍♂️)
 * - Text: "Compacting context..." or "Auto-compacting context..."
 * - Progress states: pending -> generating -> complete
 *
 * Updates automatically via SSE through useCompactionState hook.
 * Only renders when isCompacting is true.
 *
 * @example
 * ```tsx
 * <CompactionIndicator sessionId="sess_123" />
 * ```
 */
export function CompactionIndicator({ sessionId }: CompactionIndicatorProps) {
	const { isCompacting, isAutomatic, progress } = useCompactionState(sessionId)

	// Don't render when not compacting
	if (!isCompacting) {
		return null
	}

	// Determine text based on automatic flag and progress
	const getStatusText = () => {
		const prefix = isAutomatic ? "Auto-compacting" : "Compacting"
		switch (progress) {
			case "pending":
				return `${prefix} context...`
			case "generating":
				return `${prefix} context...`
			case "complete":
				return `${prefix} complete`
			default:
				return `${prefix} context...`
		}
	}

	return (
		<div className="shrink-0 flex items-center justify-center gap-2 py-2 px-4 border-t border-border/50">
			{/* Loader spinner */}
			<Loader size="sm" className="text-ctp-blue" />

			{/* Status text */}
			<span className={cn("text-xs text-muted-foreground")}>{getStatusText()}</span>
		</div>
	)
}
