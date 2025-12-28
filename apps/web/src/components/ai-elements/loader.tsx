import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "react"

export type LoaderProps = HTMLAttributes<HTMLDivElement>

/**
 * Surfer loader - rides the waves while waiting
 * Subtle up/down bobbing animation
 */
export const Loader = ({ className, ...props }: LoaderProps) => (
	<div className={cn("inline-flex items-center justify-center text-2xl", className)} {...props}>
		<span className="animate-surf" role="img" aria-label="Loading">
			🏄‍♂️
		</span>
	</div>
)
