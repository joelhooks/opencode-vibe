"use client"

/**
 * Client-side providers for the app
 *
 * Wraps the app with necessary context providers:
 * - SSEProvider: Real-time event subscriptions
 */

import type { ReactNode } from "react"
import { SSEProvider } from "@/react"
import { OPENCODE_URL } from "@/core/client"

interface ProvidersProps {
	children: ReactNode
}

/**
 * App providers wrapper
 *
 * Must be a client component to use context providers.
 */
export function Providers({ children }: ProvidersProps) {
	return <SSEProvider url={OPENCODE_URL}>{children}</SSEProvider>
}
