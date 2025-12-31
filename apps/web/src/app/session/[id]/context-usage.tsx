"use client"

import { useContextUsage, formatTokens } from "@opencode-vibe/react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface ContextUsageBarProps {
	sessionId: string
}

/**
 * ContextUsageBar - Display context token usage with progress bar
 *
 * Shows:
 * - Progress bar indicating percentage used
 * - Label: "Context: 156k / 200k (78%)"
 * - Warning state (amber) at 80%+ usage
 *
 * Updates automatically via SSE through useContextUsage hook.
 *
 * @example
 * ```tsx
 * <ContextUsageBar sessionId="sess_123" />
 * ```
 */
export function ContextUsageBar({ sessionId }: ContextUsageBarProps) {
	const { used, limit, percentage, isNearLimit } = useContextUsage(sessionId)

	// Don't render if no limit set (not initialized yet)
	if (limit === 0) {
		return null
	}

	return (
		<div className="flex items-center gap-3">
			{/* Progress bar */}
			<Progress
				value={percentage}
				className={cn(
					"w-32 h-1.5",
					isNearLimit && "bg-ctp-peach/20", // Warning background at 80%+
				)}
				aria-label={`Context usage: ${percentage}%`}
			/>

			{/* Text label */}
			<span
				className={cn(
					"text-xs font-medium whitespace-nowrap",
					isNearLimit ? "text-ctp-peach" : "text-muted-foreground",
				)}
			>
				Context: {formatTokens(used)} / {formatTokens(limit)} ({Math.round(percentage)}%)
			</span>
		</div>
	)
}
