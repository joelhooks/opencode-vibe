"use client"

/**
 * Client-side providers for the app
 *
 * Wraps the app with necessary context providers:
 * - ThemeProvider: SSR-safe theme switching (next-themes)
 * - SSEProvider: Real-time event subscriptions
 * - Toaster: Toast notifications (sonner)
 */

import type { ReactNode } from "react"
import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"
import { SSEProvider } from "@opencode-vibe/react"
import { OPENCODE_URL } from "@/lib/client"

interface ProvidersProps {
	children: ReactNode
}

/**
 * App providers wrapper
 *
 * Must be a client component to use context providers.
 */
export function Providers({ children }: ProvidersProps) {
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<SSEProvider url={OPENCODE_URL}>
				{children}
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
			</SSEProvider>
		</ThemeProvider>
	)
}
