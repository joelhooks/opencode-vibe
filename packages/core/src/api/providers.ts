/**
 * Providers API - Promise-based wrapper
 *
 * Promise-based API for AI provider operations.
 * Wraps ProviderAtom Effect programs with Effect.runPromise.
 *
 * @module api/providers
 */

import { Effect } from "effect"
import { ProviderAtom, type Provider, type Model } from "../atoms/providers.js"

/**
 * Provider API namespace
 *
 * Promise-based wrappers around ProviderAtom.
 */
export const providers = {
	/**
	 * Fetch all AI providers with their models
	 *
	 * @returns Promise that resolves to Provider array
	 *
	 * @example
	 * ```typescript
	 * const providers = await providers.list()
	 * console.log(providers.length)
	 * ```
	 */
	list: (): Promise<Provider[]> => Effect.runPromise(ProviderAtom.list()),
}

// Export types for consumers
export type { Provider, Model }
