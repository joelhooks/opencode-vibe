/**
 * @opencode-vibe/core/client
 *
 * Client routing utilities and SDK factory for OpenCode
 *
 * Provides routing logic and SDK client factory.
 *
 * For SSR (Server Components), use createClientSSR from main package:
 * ```typescript
 * import { createClientSSR } from "@opencode-vibe/core"
 * const client = await createClientSSR(directory)
 * ```
 */

export {
	getClientUrl,
	OPENCODE_URL,
	createClient,
	globalClient,
	runWithDiscovery,
	type RoutingContext,
	type OpencodeClient,
} from "./client.js"
