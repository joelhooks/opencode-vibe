"use client"

import type { ReactNode } from "react"
import { Suspense } from "react"
import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"

interface LayoutClientProps {
	children: ReactNode
}

/**
 * Client-side layout wrapper
 *
 * Includes:
 * - ThemeProvider for dark mode
 * - Toaster for notifications
 *
 * Note: SSE connection management now handled internally by World Stream (ADR-018).
 * World Stream auto-initializes on first useWorld() call and manages SSE connections
 * via createMergedWorldStream. No manual SSE wiring needed.
 *
 * Note: OpencodeSSRPlugin is rendered at the page level (session/[id]/page.tsx)
 * where we have access to the directory from URL search params.
 */
export function LayoutClient({ children }: LayoutClientProps) {
	// World Stream handles SSE internally - no manual initialization needed

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
