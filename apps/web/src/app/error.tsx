"use client"

import { useEffect } from "react"
import { OpenCodeLogo } from "@/components/opencode-logo"
import { ThemeToggle } from "@/components/theme-toggle"

/**
 * Error boundary for the dashboard
 *
 * Catches errors from server components and displays user-friendly error screen.
 * Special handling for NoServersDiscoveredError.
 */
export default function ErrorBoundary({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	useEffect(() => {
		// Log to console in development
		console.error("Dashboard error:", error)
	}, [error])

	const isNoServersError = error.name === "NoServersDiscoveredError"

	return (
		<div className="min-h-screen bg-background flex flex-col">
			{/* Header */}
			<header className="shrink-0 z-10 backdrop-blur-sm bg-background/80 border-b border-border/50">
				<div className="max-w-4xl mx-auto px-4 py-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1.5">
							<OpenCodeLogo width={100} height={18} className="text-foreground" />
							<span className="text-foreground/60 text-xs font-medium">|</span>
							<span className="text-foreground font-semibold text-sm tracking-wide">VIBE</span>
						</div>
						<ThemeToggle />
					</div>
				</div>
			</header>

			{/* Error content */}
			<div className="flex-1 flex items-center justify-center p-8">
				<div className="max-w-2xl w-full">
					{isNoServersError ? (
						<div className="space-y-6">
							<div className="space-y-2">
								<h1 className="text-3xl font-bold text-foreground">No OpenCode Servers Running</h1>
								<p className="text-lg text-foreground/70">
									OpenCode Vibe couldn't find any running OpenCode servers.
								</p>
							</div>

							<div className="bg-muted/50 border border-border rounded-lg p-6 space-y-4">
								<div className="space-y-2">
									<h2 className="text-sm font-semibold text-foreground/90">
										Start an OpenCode server:
									</h2>
									<pre className="bg-background border border-border rounded px-4 py-3 text-sm overflow-x-auto">
										<code className="text-foreground/90">opencode</code>
									</pre>
								</div>

								<div className="space-y-2">
									<h2 className="text-sm font-semibold text-foreground/90">
										Or start a server for a specific project:
									</h2>
									<pre className="bg-background border border-border rounded px-4 py-3 text-sm overflow-x-auto">
										<code className="text-foreground/90">
											cd /path/to/your/project{"\n"}opencode
										</code>
									</pre>
								</div>
							</div>

							<button
								type="button"
								onClick={() => reset()}
								className="w-full sm:w-auto px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
							>
								Retry Discovery
							</button>

							<div className="pt-4 border-t border-border">
								<details className="space-y-2">
									<summary className="text-sm font-medium text-foreground/70 cursor-pointer hover:text-foreground/90">
										Technical Details
									</summary>
									<div className="pt-2 text-sm text-foreground/60 font-mono">
										<p>Error: {error.message}</p>
										{error.digest && <p className="mt-1">Digest: {error.digest}</p>}
									</div>
								</details>
							</div>
						</div>
					) : (
						<div className="space-y-6">
							<div className="space-y-2">
								<h1 className="text-3xl font-bold text-foreground">Something went wrong</h1>
								<p className="text-lg text-foreground/70">
									An error occurred while loading the dashboard.
								</p>
							</div>

							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 space-y-2">
								<h2 className="text-sm font-semibold text-destructive">Error Details:</h2>
								<p className="text-sm text-foreground/80 font-mono">{error.message}</p>
								{error.digest && (
									<p className="text-xs text-foreground/60">Digest: {error.digest}</p>
								)}
							</div>

							<button
								type="button"
								onClick={() => reset()}
								className="w-full sm:w-auto px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
							>
								Try Again
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
