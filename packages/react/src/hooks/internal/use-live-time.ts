/**
 * useLiveTime - Triggers re-renders at regular intervals
 *
 * Returns a tick counter that increments every `interval` milliseconds.
 * Components using this hook will re-render when the tick changes, allowing
 * relative time displays (e.g., "2 minutes ago") to update live.
 *
 * @param interval - Milliseconds between ticks (default: 60000 = 1 minute)
 * @returns Tick counter (starts at 0, increments each interval)
 *
 * @example
 * ```tsx
 * function RelativeTime({ timestamp }: { timestamp: number }) {
 *   const tick = useLiveTime() // Re-render every minute
 *   return <span>{formatRelativeTime(timestamp)}</span>
 * }
 * ```
 */

import { useEffect, useState } from "react"

export function useLiveTime(interval = 60000): number {
	const [tick, setTick] = useState(0)

	useEffect(() => {
		const timer = setInterval(() => {
			setTick((prev) => prev + 1)
		}, interval)

		return () => clearInterval(timer)
	}, [interval])

	return tick
}
