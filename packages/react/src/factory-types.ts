/**
 * Type utilities for factory-generated hooks
 *
 * Future enhancement: Extract router types and map to hook return types
 * Currently placeholder - full implementation requires router type introspection
 */

/**
 * Placeholder router type constraint
 * Future: Import actual Router type when exported from @opencode-vibe/core
 */
type AnyRouter = any

/**
 * Extract client type from router (placeholder for tRPC-style type inference)
 *
 * Future enhancement: Use conditional mapped types to transform router
 * procedures into client method signatures
 */
export type InferClientFromRouter<TRouter extends AnyRouter> = TRouter

/**
 * Extract hook return types from router (placeholder)
 *
 * Future enhancement: Map router procedures to hook result types
 */
export type InferHooksFromRouter<TRouter extends AnyRouter> = {
	useSession: (sessionId: string) => any
	useSendMessage: (options: any) => any
	useSessionList: () => any[]
	useProviders: () => any
	useProjects: () => any
	useCommands: () => any
	useCreateSession: () => any
	useFileSearch: (query: string) => any
}
