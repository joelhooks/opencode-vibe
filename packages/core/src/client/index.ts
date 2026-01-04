/**
 * @opencode-vibe/core/client
 *
 * Client routing utilities and SDK factory for OpenCode
 *
 * Provides routing logic and SDK client factory.
 *
 * For SSR (Server Components), use:
 * import { createClientSSR } from "@opencode-vibe/core/client/server"
 */

export {
	getClientUrl,
	OPENCODE_URL,
	createClient,
	globalClient,
	type RoutingContext,
	type OpencodeClient,
} from "./client.js"
