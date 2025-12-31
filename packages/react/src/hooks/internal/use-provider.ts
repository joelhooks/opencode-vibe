/**
 * useProvider - Hook for fetching and managing OpenCode providers
 *
 * Fetches the list of available AI providers, their connection status,
 * and default model mappings.
 *
 * Usage:
 * ```tsx
 * function ProviderList() {
 *   const { data, loading, error, refetch } = useProvider()
 *
 *   if (loading) return <div>Loading providers...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <div>
 *       <h2>Connected: {data.connected.length}</h2>
 *       {data.all.map(provider => (
 *         <div key={provider.id}>{provider.name}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */

import { useCallback, useEffect, useState } from "react"
import { globalClient } from "@opencode-vibe/core/client"

/**
 * Model definition from SDK
 */
export interface Model {
	id: string
	name: string
	[key: string]: unknown
}

/**
 * Provider definition from SDK
 */
export interface Provider {
	id: string
	name: string
	source?: string
	env: string[]
	models: Record<string, Model>
}

/**
 * Provider list response shape from API
 */
export interface ProviderData {
	/** All available providers */
	all: Provider[]
	/** IDs of connected/configured providers */
	connected: string[]
	/** Default model ID per provider (providerId -> modelId) */
	defaults: Record<string, string>
}

/**
 * Hook return type with loading/error states
 */
export interface UseProviderResult {
	/** Provider data (null during initial load) */
	data: ProviderData | null
	/** Loading state (true during initial fetch and refetch) */
	loading: boolean
	/** Error state (null if no error) */
	error: Error | null
	/** Manually refetch provider data */
	refetch: () => Promise<void>
}

/**
 * useProvider hook for fetching AI provider information
 *
 * @returns Provider data with loading/error states and refetch function
 *
 * @example Basic usage
 * ```tsx
 * const { data, loading, error } = useProvider()
 *
 * if (loading) return <Spinner />
 * if (error) return <ErrorMessage error={error} />
 * if (!data) return null
 *
 * return <ProviderSelector providers={data.all} />
 * ```
 *
 * @example With manual refresh
 * ```tsx
 * function ProviderManager() {
 *   const { data, loading, refetch } = useProvider()
 *
 *   return (
 *     <div>
 *       <button onClick={refetch}>Refresh</button>
 *       {data?.all.map(p => <ProviderCard key={p.id} {...p} />)}
 *     </div>
 *   )
 * }
 * ```
 */
export function useProvider(): UseProviderResult {
	const [data, setData] = useState<ProviderData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	// Fetch provider data
	const fetchProviders = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			const response = await globalClient.provider.list()

			// SDK wraps response in { data: ... }
			// API returns { all, connected, default } but we normalize to "defaults"
			const normalized: ProviderData = {
				all: (response.data?.all ?? []) as unknown as Provider[],
				connected: response.data?.connected ?? [],
				defaults: response.data?.default ?? {},
			}

			setData(normalized)
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
			setError(error)
			console.error("Failed to fetch providers:", error)
		} finally {
			setLoading(false)
		}
	}, [])

	// Initial fetch on mount
	useEffect(() => {
		fetchProviders()
	}, [fetchProviders])

	return {
		data,
		loading,
		error,
		refetch: fetchProviders,
	}
}
