/**
 * Discovery Browser Layer
 *
 * Browser-safe implementation of the Discovery service using fetch to
 * /api/opencode/servers endpoint. Supports full DiscoveryOptions via query params.
 *
 * @module discovery
 */

import { Effect, Layer } from "effect"
import { Discovery, type DiscoveredServer, type DiscoveryOptions } from "./types.js"

/**
 * Type guard for DiscoveredServer
 */
function isValidServer(data: unknown): data is DiscoveredServer {
	if (!data || typeof data !== "object") return false
	const obj = data as Record<string, unknown>
	return (
		typeof obj.port === "number" && typeof obj.pid === "number" && typeof obj.directory === "string"
	)
}

/**
 * Build query string from DiscoveryOptions
 */
function buildQueryString(options?: DiscoveryOptions): string {
	if (!options) return ""

	const params = new URLSearchParams()
	if (options.includeSessions) params.set("includeSessions", "true")
	if (options.includeSessionDetails) params.set("includeSessionDetails", "true")
	if (options.includeProjects) params.set("includeProjects", "true")
	if (options.timeout !== undefined) params.set("timeout", String(options.timeout))

	const query = params.toString()
	return query ? `?${query}` : ""
}

/**
 * Create Discovery implementation with injectable fetch
 */
function makeDiscovery(fetchFn: typeof fetch = fetch) {
	return {
		discover: (options?: DiscoveryOptions) =>
			Effect.gen(function* () {
				// Build endpoint URL with query params
				const queryString = buildQueryString(options)
				const url = `/api/opencode/servers${queryString}`

				// Fetch from API endpoint
				const response = yield* Effect.tryPromise({
					try: () => fetchFn(url),
					catch: () => new Error("Failed to fetch servers"),
				})

				// Check response status
				if (!response.ok) {
					return []
				}

				// Parse JSON
				const data = yield* Effect.tryPromise({
					try: () => response.json(),
					catch: () => new Error("Failed to parse JSON"),
				})

				// Validate and filter
				if (!Array.isArray(data)) {
					return []
				}

				const servers = data.filter(isValidServer)
				return servers
			}).pipe(
				// On ANY error, return empty array (graceful degradation)
				Effect.catchAll(() => Effect.succeed([])),
			),
	}
}

/**
 * DiscoveryBrowserLive Layer
 *
 * Provides Discovery service using browser fetch.
 * Use in browser/Next.js app.
 */
export const DiscoveryBrowserLive = Layer.succeed(Discovery, makeDiscovery())

/**
 * Default export for backwards compatibility
 */
export const Default = DiscoveryBrowserLive

/**
 * Create a test layer with custom fetch implementation
 * @internal
 */
export const makeTestLayer = (fetchFn: typeof fetch) =>
	Layer.succeed(Discovery, makeDiscovery(fetchFn))
