"use client"

/**
 * Error Boundary for catching React errors
 *
 * Catches errors in child components and displays a fallback UI.
 * Provides a retry button to attempt recovery.
 */

import { Component, type ReactNode } from "react"

interface Props {
	children: ReactNode
	fallback?: ReactNode
}

interface State {
	hasError: boolean
	error: Error | null
}

/**
 * ErrorBoundary - Catches React errors and displays fallback UI
 *
 * @example
 * ```tsx
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("[ErrorBoundary] Caught error:", error, errorInfo)
	}

	handleRetry = () => {
		this.setState({ hasError: false, error: null })
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback
			}

			return (
				<div className="h-dvh flex flex-col items-center justify-center gap-4 p-4">
					<div className="text-destructive font-medium">Something went wrong</div>
					<div className="text-muted-foreground text-sm text-center max-w-md">
						{this.state.error?.message || "An unexpected error occurred"}
					</div>
					<button
						type="button"
						onClick={this.handleRetry}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
					>
						Try Again
					</button>
				</div>
			)
		}

		return this.props.children
	}
}
