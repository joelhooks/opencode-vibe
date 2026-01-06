"use client"

import { use } from "react"
import { OpencodeSSRPlugin } from "@opencode-vibe/react"

/**
 * Client-side wrapper for OpencodeSSRPlugin
 *
 * This component exists because OpencodeSSRPlugin uses client-only hooks
 * (useServerInsertedHTML) and cannot be imported directly in Server Components.
 *
 * The plugin injects the OpenCode config into window.__OPENCODE during SSR
 * so client-side hooks can access it immediately without flicker.
 *
 * CRITICAL: Uses React.use() to unwrap searchParams promise BEFORE discoveredInstances
 * This marks the route as dynamic before Effect's Date.now() is called, preventing
 * Next.js 16 prerendering error: "Route used Date.now() before accessing uncached data"
 */

interface OpencodeInstance {
	port: number
	directory: string
	baseUrl: string
}

interface SSRConfigInjectorProps {
	searchParamsPromise: Promise<{ dir?: string }>
	discoveredInstancesPromise: Promise<OpencodeInstance[]>
}

export function SSRConfigInjector({
	searchParamsPromise,
	discoveredInstancesPromise,
}: SSRConfigInjectorProps) {
	// CRITICAL ORDER: unwrap searchParams FIRST to mark route as dynamic
	const searchParams = use(searchParamsPromise)

	// NOW we can safely unwrap discoveredInstances (which used Effect/Date.now())
	const instances = use(discoveredInstancesPromise)

	const config = {
		baseUrl: "/api/opencode",
		directory: searchParams.dir || "",
		instances,
	}

	return <OpencodeSSRPlugin config={config} />
}
