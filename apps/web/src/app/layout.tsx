import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { Geist, Geist_Mono } from "next/font/google"
import { Providers } from "./providers"
import { ErrorBoundary } from "@/components/error-boundary"
import "./globals.css"

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
})

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
})

export const metadata: Metadata = {
	title: "OpenCode",
	description: "AI-powered coding assistant",
	manifest: "/manifest.json",
	appleWebApp: {
		capable: true,
		statusBarStyle: "black-translucent",
		title: "OpenCode",
	},
	formatDetection: {
		telephone: false,
	},
}

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
	userScalable: false,
	viewportFit: "cover",
}

/**
 * Root layout with Catppuccin theming
 *
 * Uses Latte (light) and Mocha (dark) variants.
 * Dark mode is controlled via ThemeProvider (next-themes).
 * suppressHydrationWarning prevents mismatch between server/client theme rendering.
 */
export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* PWA meta tags */}
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
				<meta name="apple-mobile-web-app-title" content="OpenCode" />
				<link rel="apple-touch-icon" href="/icons/icon.svg" />
				<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
				{/* Prevent zoom on input focus (iOS) */}
				<meta name="format-detection" content="telephone=no" />
				{/* Theme color for browser chrome */}
				<meta name="theme-color" content="#1e1e2e" media="(prefers-color-scheme: dark)" />
				<meta name="theme-color" content="#eff1f5" media="(prefers-color-scheme: light)" />
				{/* Screen orientation lock hint */}
				<meta name="screen-orientation" content="portrait" />
			</head>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
			>
				<ErrorBoundary>
					<Suspense
						fallback={
							<div className="h-dvh flex items-center justify-center">
								<div className="text-muted-foreground">Loading...</div>
							</div>
						}
					>
						<Providers>{children}</Providers>
					</Suspense>
				</ErrorBoundary>
			</body>
		</html>
	)
}
