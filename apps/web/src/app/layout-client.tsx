"use client"

import type { ReactNode } from "react"
import { Suspense, useEffect } from "react"
import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"
import { Either } from "effect"
import { multiServerSSE, parseSSEEvent } from "@opencode-vibe/core/sse"
import { routeEvent } from "@opencode-vibe/core/world/event-router"
import { getWorldRegistry } from "@opencode-vibe/react/hooks"

interface LayoutClientProps {
	children: ReactNode
}

/**
 * Client-side layout wrapper
 *
 * Includes:
 * - ThemeProvider for dark mode
 * - Toaster for notifications
 * - Global SSE initialization (multiServerSSE.start)
 *
 * Note: OpencodeSSRPlugin is rendered at the page level (session/[id]/page.tsx)
 * where we have access to the directory from URL search params.
 */
export function LayoutClient({ children }: LayoutClientProps) {
	// Start multiServerSSE globally (idempotent, safe to call multiple times)
	// This ensures discovery happens on all pages, not just session pages
	// NOTE: No cleanup function - LayoutClient never unmounts (root layout)
	useEffect(() => {
		console.log("[LayoutClient] Starting multiServerSSE")

		// Wire multiServerSSE events to World Stream atoms via event router
		// Pattern from Hivemind (mem-6e17163913baa692): SSE → parse → route → atoms
		multiServerSSE.onEvent((event) => {
			const registry = getWorldRegistry()
			if (!registry) {
				// Stream not initialized yet - this is OK during early bootstrap
				// World Stream initializes on first useWorld() call
				console.debug("[LayoutClient] Skipping event - registry not ready:", event.payload.type)
				return
			}

			// Map directory to port for event routing
			// Use first port for directory (most common case: 1 server per directory)
			const ports = multiServerSSE.getPortsForDirectory(event.directory)
			const port = ports[0]
			if (!port) {
				console.warn("[LayoutClient] No port found for directory:", event.directory)
				return
			}

			// Parse event payload using Effect Schema validation
			const parsed = parseSSEEvent(event.payload)
			if (Either.isRight(parsed)) {
				// Route to appropriate atom (sessionsAtom, messagesAtom, etc.)
				routeEvent(parsed.right, registry, port)
			} else {
				console.warn("[LayoutClient] Failed to parse SSE event:", event.payload.type, parsed.left)
			}
		})

		multiServerSSE.start()
	}, [])

	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Suspense
				fallback={
					<div className="h-dvh flex items-center justify-center">
						<div className="text-muted-foreground">Loading...</div>
					</div>
				}
			>
				{children}
			</Suspense>
			<Toaster
				position="top-right"
				richColors
				closeButton
				toastOptions={{
					classNames: {
						toast: "font-sans",
					},
				}}
			/>
		</ThemeProvider>
	)
}
