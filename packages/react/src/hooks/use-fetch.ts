/**
 * useFetch - Generic fetch hook with loading/error/data state management
 *
 * Provides a reusable pattern for async data fetching with React state.
 * Used as the foundation for specialized hooks like useSessionList, useProviders, etc.
 *
 * @example
 * ```tsx
 * // Basic usage
 * function UserProfile({ userId }: { userId: string }) {
 *   const { data, loading, error } = useFetch(
 *     async (id: string) => {
 *       const res = await fetch(`/api/users/${id}`)
 *       return res.json()
 *     },
 *     userId
 *   )
 *
 *   if (loading) return <div>Loading...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *   return <div>Hello, {data.name}</div>
 * }
 *
 * // With options
 * function OptionalData({ shouldFetch }: { shouldFetch: boolean }) {
 *   const { data, refetch } = useFetch(
 *     async () => fetch('/api/data').then(r => r.json()),
 *     undefined,
 *     {
 *       enabled: shouldFetch,
 *       initialData: { default: true },
 *       onSuccess: (data) => console.log('Fetched:', data),
 *       onError: (error) => console.error('Failed:', error)
 *     }
 *   )
 *
 *   return (
 *     <div>
 *       <pre>{JSON.stringify(data)}</pre>
 *       <button onClick={refetch}>Refetch</button>
 *     </div>
 *   )
 * }
 * ```
 */

"use client"

import { useState, useEffect, useRef, useCallback } from "react"

export interface UseFetchOptions<T> {
	/** Initial data value (optional) */
	initialData?: T
	/** Whether to enable automatic fetching (default: true) */
	enabled?: boolean
	/** Callback on successful fetch */
	onSuccess?: (data: T) => void
	/** Callback on fetch error */
	onError?: (error: Error) => void
}

export interface UseFetchReturn<T> {
	/** Fetched data */
	data: T
	/** Loading state */
	loading: boolean
	/** Error if fetch failed */
	error: Error | null
	/** Manually trigger refetch */
	refetch: () => void
}

/**
 * Generic fetch hook with loading/error/data state management
 *
 * Uses refs for callbacks and fetcher to avoid infinite loops from
 * unstable function references in dependency arrays.
 *
 * @param fetcher - Async function that returns data
 * @param params - Parameters to pass to fetcher (should be stable or primitive)
 * @param options - Optional configuration
 * @returns Object with data, loading, error, and refetch
 */
export function useFetch<T, P = void>(
	fetcher: (params: P) => Promise<T>,
	params: P,
	options: UseFetchOptions<T> = {},
): UseFetchReturn<T> {
	const { initialData, enabled = true, onSuccess, onError } = options

	const [data, setData] = useState<T>(initialData as T)
	const [loading, setLoading] = useState(enabled)
	const [error, setError] = useState<Error | null>(null)

	// Use refs for unstable references to avoid infinite loops
	// Updated synchronously on each render (not in useEffect to avoid stale closures)
	const fetcherRef = useRef(fetcher)
	const paramsRef = useRef(params)
	const onSuccessRef = useRef(onSuccess)
	const onErrorRef = useRef(onError)

	fetcherRef.current = fetcher
	paramsRef.current = params
	onSuccessRef.current = onSuccess
	onErrorRef.current = onError

	// Serialize params for stable dependency (handles objects/arrays)
	const paramsKey = JSON.stringify(params)

	// Stable fetch function - only depends on `enabled` (primitive)
	const doFetch = useCallback(() => {
		if (!enabled) {
			return
		}

		setLoading(true)
		setError(null)

		fetcherRef
			.current(paramsRef.current)
			.then((result: T) => {
				setData(result)
				setError(null)
				onSuccessRef.current?.(result)
			})
			.catch((err: unknown) => {
				const error = err instanceof Error ? err : new Error(String(err))
				setError(error)
				onErrorRef.current?.(error)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [enabled])

	// Fetch on mount and when enabled/params change
	// biome-ignore lint/correctness/useExhaustiveDependencies: paramsKey intentionally triggers refetch when params change
	useEffect(() => {
		doFetch()
	}, [doFetch, paramsKey])

	return {
		data,
		loading,
		error,
		refetch: doFetch,
	}
}
