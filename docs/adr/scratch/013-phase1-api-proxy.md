# Phase 1: API Proxy Implementation - Task Spec

**Status:** Ready for Implementation  
**Parent:** ADR-013 Unified Same-Origin Architecture  
**Estimated Time:** 2-3 hours  
**Complexity:** Medium

---

## Context (What & Why)

OpenCode servers run on `localhost:4056` (or dynamic ports). The React app needs to connect from external devices (iPhone, Tailscale). Direct connections fail due to CORS and `127.0.0.1` resolving to the wrong machine.

**Current State (Partial Fix):**
- ✅ SSE streams proxied via `/api/sse/[port]/route.ts` (ADR-011 Phase 1)
- ❌ Regular API calls (session.list, message.send, etc.) still hit `http://127.0.0.1:${port}` directly
- ❌ Mobile/Tailscale devices get CORS errors

**Goal:**
Proxy ALL OpenCode API traffic through Next.js route handlers so browser sees same-origin requests.

**Success Outcome:**
Mobile Safari on iPhone can load sessions, send messages, and use all OpenCode features via Tailscale without CORS errors.

---

## Files to Create/Modify

### 1. Create: API Proxy Route Handler

**Path:** `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts`

**Purpose:** Catch-all proxy for ALL OpenCode API endpoints

**Pattern:** Follows existing SSE proxy at `api/sse/[port]/route.ts`

### 2. Modify: Client SDK URL Generation

**Path:** `packages/core/src/client/client.ts`

**Changes:**
- Update `getClientUrl()` to return `/api/opencode/${port}` instead of `http://127.0.0.1:${port}`
- Update `createClient()` to use proxy URLs
- Preserve SSE-specific routing (already uses `/api/sse/${port}`)

### 3. Modify: Multi-Server SSE URL Generation

**Path:** `packages/core/src/sse/multi-server-sse.ts`

**Changes:**
- `getBaseUrlForSession()` already returns `/api/sse/${port}` ✅
- `getBaseUrlForDirectory()` already returns `/api/sse/${port}` ✅
- No changes needed (verified in context)

---

## Implementation Code

### 1. API Proxy Route Handler

```typescript
// apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts

import { NextRequest, NextResponse } from "next/server"

/**
 * API Proxy for OpenCode servers
 * 
 * Routes all API calls through Next.js to eliminate CORS issues
 * on mobile/Tailscale. Proxies to http://127.0.0.1:${port}/${path}
 * 
 * Architecture:
 * - Browser: fetch('/api/opencode/4056/session/list') [same-origin]
 * - Next.js: Proxy to http://127.0.0.1:4056/session/list [server-to-server]
 * - Response: Return to browser [same-origin]
 * 
 * Related:
 * - SSE Proxy: /api/sse/[port]/route.ts (handles SSE streams)
 * - ADR-013: Unified Same-Origin Architecture
 * 
 * @example
 * // Client makes same-origin request
 * fetch('/api/opencode/4056/session/list')
 * 
 * // Next.js proxies to
 * http://127.0.0.1:4056/session/list
 * 
 * // Returns response to browser (same-origin)
 */

type RouteContext = {
	params: Promise<{
		port: string
		path?: string[]
	}>
}

/**
 * Validate port number for security
 * - Must be numeric
 * - Must be in range 1024-65535 (user ports)
 */
function validatePort(port: string): { valid: true; port: number } | { valid: false; error: string } {
	if (!port || !/^\d+$/.test(port)) {
		return { valid: false, error: "Invalid port number" }
	}

	const portNum = parseInt(port, 10)

	if (portNum < 1024 || portNum > 65535) {
		return { valid: false, error: "Port out of valid range (1024-65535)" }
	}

	return { valid: true, port: portNum }
}

/**
 * Build target URL for OpenCode server
 * 
 * @param port - Server port number
 * @param path - API path segments (e.g., ['session', 'list'])
 * @returns Full URL to proxy to
 * 
 * @example
 * buildTargetUrl(4056, ['session', 'list'])
 * // => 'http://127.0.0.1:4056/session/list'
 */
function buildTargetUrl(port: number, path: string[] = []): string {
	const pathString = path.length > 0 ? `/${path.join("/")}` : ""
	return `http://127.0.0.1:${port}${pathString}`
}

/**
 * Proxy request to OpenCode server
 * 
 * @param request - Incoming Next.js request
 * @param port - OpenCode server port
 * @param path - API path segments
 * @returns Proxied response
 */
async function proxyRequest(
	request: NextRequest,
	port: number,
	path: string[] = [],
): Promise<NextResponse> {
	const targetUrl = buildTargetUrl(port, path)

	try {
		// Copy headers from incoming request
		const headers = new Headers()
		
		// Preserve OpenCode-specific headers
		const directoryHeader = request.headers.get("x-opencode-directory")
		if (directoryHeader) {
			headers.set("x-opencode-directory", directoryHeader)
		}

		// Preserve content-type for POST/PUT/PATCH
		const contentType = request.headers.get("content-type")
		if (contentType) {
			headers.set("content-type", contentType)
		}

		// Copy body for POST/PUT/PATCH
		let body: ReadableStream | null = null
		if (["POST", "PUT", "PATCH"].includes(request.method)) {
			body = request.body
		}

		// Proxy request to OpenCode server
		const response = await fetch(targetUrl, {
			method: request.method,
			headers,
			body,
			// @ts-expect-error - duplex mode needed for streaming request bodies
			duplex: body ? "half" : undefined,
		})

		// Handle non-2xx responses
		if (!response.ok) {
			return NextResponse.json(
				{
					error: `OpenCode server returned ${response.status}`,
					message: await response.text(),
				},
				{ status: response.status },
			)
		}

		// Return proxied response
		const responseBody = await response.text()
		return new NextResponse(responseBody, {
			status: response.status,
			headers: {
				"Content-Type": response.headers.get("content-type") || "application/json",
			},
		})
	} catch (error) {
		console.error(`[API Proxy] Failed to proxy to ${targetUrl}:`, error)
		return NextResponse.json(
			{
				error: "Failed to connect to OpenCode server",
				message: error instanceof Error ? error.message : "Unknown error",
				port,
				path,
			},
			{ status: 503 },
		)
	}
}

// Route handlers for all HTTP methods
export async function GET(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		return NextResponse.json({ error: validation.error }, { status: 400 })
	}

	return proxyRequest(request, validation.port, path)
}

export async function POST(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		return NextResponse.json({ error: validation.error }, { status: 400 })
	}

	return proxyRequest(request, validation.port, path)
}

export async function PUT(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		return NextResponse.json({ error: validation.error }, { status: 400 })
	}

	return proxyRequest(request, validation.port, path)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		return NextResponse.json({ error: validation.error }, { status: 400 })
	}

	return proxyRequest(request, validation.port, path)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		return NextResponse.json({ error: validation.error }, { status: 400 })
	}

	return proxyRequest(request, validation.port, path)
}
```

### 2. Client SDK URL Generation Updates

```typescript
// packages/core/src/client/client.ts

/**
 * Get the appropriate server URL for a client request
 *
 * Priority: session-specific routing > directory routing > default server
 *
 * NEW: Returns proxy URLs (/api/opencode/${port}) instead of direct URLs
 *
 * @param directory - Optional project directory for scoping
 * @param sessionId - Optional session ID for session-specific routing
 * @param routingContext - Routing context with servers (optional)
 * @returns Server URL to use (proxy format)
 *
 * @example
 * ```ts
 * // Basic usage (routes to default proxy)
 * const url = getClientUrl()
 * // => "/api/opencode/4056"
 *
 * // With directory (routes to directory's server if found)
 * const url = getClientUrl("/path/to/project", undefined, { servers })
 * // => "/api/opencode/4057" (if server found) or default
 *
 * // With session (routes to session's server)
 * const url = getClientUrl("/path/to/project", "ses_123", { servers, sessionToPort })
 * // => routes to cached session server, then directory, then default
 * ```
 */
export function getClientUrl(
	directory?: string,
	sessionId?: string,
	routingContext?: RoutingContext,
): string {
	// No routing context = use default
	if (!routingContext || routingContext.servers.length === 0) {
		// Extract port from OPENCODE_URL and use proxy
		const defaultPort = new URL(OPENCODE_URL).port || "4056"
		return `/api/opencode/${defaultPort}`
	}

	// Priority: session-specific routing > directory routing > default
	let port: number | undefined

	if (sessionId && directory) {
		const sessionUrl = getServerForSession(
			sessionId,
			directory,
			routingContext.servers,
			routingContext.sessionToPort,
		)
		port = extractPort(sessionUrl)
	}

	if (!port && directory) {
		const dirUrl = getServerForDirectory(directory, routingContext.servers)
		port = extractPort(dirUrl)
	}

	// Fallback to default
	if (!port) {
		const defaultPort = new URL(OPENCODE_URL).port || "4056"
		return `/api/opencode/${defaultPort}`
	}

	return `/api/opencode/${port}`
}

/**
 * Extract port number from URL
 * Handles both direct URLs (http://127.0.0.1:4056) and proxy URLs (/api/sse/4056)
 */
function extractPort(url: string): number | undefined {
	// Proxy URL format: /api/sse/4056
	const proxyMatch = url.match(/\/api\/(sse|opencode)\/(\d+)/)
	if (proxyMatch) {
		return parseInt(proxyMatch[2], 10)
	}

	// Direct URL format: http://127.0.0.1:4056
	try {
		const parsed = new URL(url)
		return parsed.port ? parseInt(parsed.port, 10) : undefined
	} catch {
		return undefined
	}
}

/**
 * Create an OpenCode SDK client instance with smart routing
 *
 * Routes to the server that owns the session (if known),
 * otherwise falls back to directory-based routing, then default server.
 *
 * Uses multiServerSSE for routing context (server discovery + session cache).
 *
 * NEW: Uses proxy URLs for same-origin access (CORS elimination)
 *
 * @param directory - Optional project directory for scoping requests
 * @param sessionId - Optional session ID for session-specific routing
 * @returns Configured OpencodeClient with all namespaces
 *
 * @example
 * ```ts
 * const client = createClient()
 * const sessions = await client.session.list()
 * ```
 */
export function createClient(directory?: string, sessionId?: string): OpencodeClient {
	// Priority: session-specific routing > directory routing > default
	let discoveredUrl: string | undefined

	if (sessionId && directory) {
		const sessionUrl = multiServerSSE.getBaseUrlForSession(sessionId, directory)
		if (sessionUrl) {
			// Convert SSE proxy URL to API proxy URL
			// /api/sse/4056 → /api/opencode/4056
			discoveredUrl = sessionUrl.replace("/api/sse/", "/api/opencode/")
		}
	}

	if (!discoveredUrl && directory) {
		const dirUrl = multiServerSSE.getBaseUrlForDirectory(directory)
		if (dirUrl) {
			// Convert SSE proxy URL to API proxy URL
			discoveredUrl = dirUrl.replace("/api/sse/", "/api/opencode/")
		}
	}

	// Fallback to default proxy
	const serverUrl = discoveredUrl ?? `/api/opencode/${new URL(OPENCODE_URL).port || "4056"}`

	return createOpencodeClient({
		baseUrl: serverUrl,
		directory,
	})
}

/**
 * Singleton client for global operations (no directory scoping)
 * Use createClient(directory) for project-scoped operations
 */
export const globalClient = createClient()
```

---

## Test Specifications

### Unit Tests

**File:** `apps/web/src/app/api/opencode/[port]/[[...path]]/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { GET, POST } from "./route"

describe("API Proxy Route", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		fetchSpy = vi.spyOn(global, "fetch")
	})

	afterEach(() => {
		fetchSpy.mockRestore()
	})

	describe("Port Validation", () => {
		it("rejects non-numeric port", async () => {
			const request = new NextRequest("http://localhost/api/opencode/abc/session/list")
			const context = { params: Promise.resolve({ port: "abc", path: ["session", "list"] }) }

			const response = await GET(request, context)
			expect(response.status).toBe(400)

			const body = await response.json()
			expect(body.error).toContain("Invalid port")
		})

		it("rejects port below 1024", async () => {
			const request = new NextRequest("http://localhost/api/opencode/80/session/list")
			const context = { params: Promise.resolve({ port: "80", path: ["session", "list"] }) }

			const response = await GET(request, context)
			expect(response.status).toBe(400)

			const body = await response.json()
			expect(body.error).toContain("out of valid range")
		})

		it("rejects port above 65535", async () => {
			const request = new NextRequest("http://localhost/api/opencode/99999/session/list")
			const context = { params: Promise.resolve({ port: "99999", path: ["session", "list"] }) }

			const response = await GET(request, context)
			expect(response.status).toBe(400)

			const body = await response.json()
			expect(body.error).toContain("out of valid range")
		})

		it("accepts valid port in range", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ sessions: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)

			const request = new NextRequest("http://localhost/api/opencode/4056/session/list")
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "list"] }) }

			const response = await GET(request, context)
			expect(response.status).toBe(200)

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://127.0.0.1:4056/session/list",
				expect.objectContaining({ method: "GET" }),
			)
		})
	})

	describe("Path Construction", () => {
		it("proxies root path correctly", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)

			const request = new NextRequest("http://localhost/api/opencode/4056")
			const context = { params: Promise.resolve({ port: "4056", path: undefined }) }

			const response = await GET(request, context)
			expect(response.status).toBe(200)

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://127.0.0.1:4056",
				expect.objectContaining({ method: "GET" }),
			)
		})

		it("proxies nested path correctly", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ message: "sent" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)

			const request = new NextRequest("http://localhost/api/opencode/4056/session/ses_123/message/send")
			const context = {
				params: Promise.resolve({ port: "4056", path: ["session", "ses_123", "message", "send"] }),
			}

			const response = await POST(request, context)
			expect(response.status).toBe(200)

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://127.0.0.1:4056/session/ses_123/message/send",
				expect.objectContaining({ method: "POST" }),
			)
		})
	})

	describe("Header Preservation", () => {
		it("preserves x-opencode-directory header", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ sessions: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)

			const request = new NextRequest("http://localhost/api/opencode/4056/session/list", {
				headers: {
					"x-opencode-directory": "/path/to/project",
				},
			})
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "list"] }) }

			await GET(request, context)

			expect(fetchSpy).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						get: expect.any(Function),
					}),
				}),
			)

			const callHeaders = fetchSpy.mock.calls[0][1].headers
			expect(callHeaders.get("x-opencode-directory")).toBe("/path/to/project")
		})

		it("preserves content-type for POST", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)

			const request = new NextRequest("http://localhost/api/opencode/4056/session/create", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ prompt: "test" }),
			})
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "create"] }) }

			await POST(request, context)

			const callHeaders = fetchSpy.mock.calls[0][1].headers
			expect(callHeaders.get("content-type")).toBe("application/json")
		})
	})

	describe("Error Handling", () => {
		it("handles server connection errors", async () => {
			fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"))

			const request = new NextRequest("http://localhost/api/opencode/4056/session/list")
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "list"] }) }

			const response = await GET(request, context)
			expect(response.status).toBe(503)

			const body = await response.json()
			expect(body.error).toContain("Failed to connect")
			expect(body.message).toContain("ECONNREFUSED")
		})

		it("handles non-2xx responses from server", async () => {
			fetchSpy.mockResolvedValue(
				new Response("Session not found", {
					status: 404,
					headers: { "Content-Type": "text/plain" },
				}),
			)

			const request = new NextRequest("http://localhost/api/opencode/4056/session/missing")
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "missing"] }) }

			const response = await GET(request, context)
			expect(response.status).toBe(404)

			const body = await response.json()
			expect(body.error).toContain("returned 404")
		})
	})

	describe("HTTP Methods", () => {
		it("proxies GET correctly", async () => {
			fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

			const request = new NextRequest("http://localhost/api/opencode/4056/session/list")
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "list"] }) }

			await GET(request, context)

			expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "GET" }))
		})

		it("proxies POST with body", async () => {
			fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

			const requestBody = JSON.stringify({ prompt: "test" })
			const request = new NextRequest("http://localhost/api/opencode/4056/session/create", {
				method: "POST",
				body: requestBody,
			})
			const context = { params: Promise.resolve({ port: "4056", path: ["session", "create"] }) }

			await POST(request, context)

			expect(fetchSpy).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					method: "POST",
					body: expect.any(ReadableStream),
				}),
			)
		})
	})
})
```

### Integration Tests

**Manual Testing Checklist:**

1. **Session List (GET)**
   ```bash
   # Browser console (mobile or desktop)
   fetch('/api/opencode/4056/session/list').then(r => r.json())
   # Expected: Array of sessions, status 200
   ```

2. **Session Create (POST)**
   ```bash
   # Browser console
   fetch('/api/opencode/4056/session/create', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ prompt: 'test message' })
   }).then(r => r.json())
   # Expected: New session object, status 201
   ```

3. **Directory-Scoped Request (with header)**
   ```bash
   # Browser console
   fetch('/api/opencode/4056/session/list', {
     headers: { 'x-opencode-directory': '/Users/joel/Code/project' }
   }).then(r => r.json())
   # Expected: Sessions filtered by directory
   ```

4. **Error Handling (bad port)**
   ```bash
   # Browser console
   fetch('/api/opencode/9999/session/list').then(r => r.json())
   # Expected: 503 error, "Failed to connect"
   ```

5. **Mobile/Tailscale Test**
   - Connect iPhone to Tailscale network
   - Open app at `http://dark-wizard.tail7af24.ts.net:8423`
   - Check browser console for CORS errors (should be NONE)
   - Load session list, send message
   - Expected: All operations succeed, no CORS errors

---

## Success Criteria (Verifiable Checklist)

- [ ] **File Creation**
  - [ ] `apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts` created
  - [ ] `apps/web/src/app/api/opencode/[port]/[[...path]]/route.test.ts` created
  - [ ] `packages/core/src/client/client.test.ts` updated

- [ ] **Proxy Implementation**
  - [ ] Port validation (1024-65535 range)
  - [ ] Path construction (root and nested paths)
  - [ ] All HTTP methods (GET, POST, PUT, DELETE, PATCH)
  - [ ] Header preservation (`x-opencode-directory`, `content-type`)
  - [ ] Body streaming for POST/PUT/PATCH
  - [ ] Error handling (connection failures, non-2xx responses)

- [ ] **Client SDK Updates**
  - [ ] `getClientUrl()` returns `/api/opencode/${port}` format
  - [ ] `createClient()` uses proxy URLs
  - [ ] SSE routing preserved (still uses `/api/sse/${port}`)
  - [ ] `extractPort()` helper handles both proxy and direct URLs

- [ ] **Testing**
  - [ ] Unit tests pass (`bun run test`)
  - [ ] Integration tests pass (manual browser console checks)
  - [ ] TypeScript check passes (`bun run typecheck`)
  - [ ] Linter passes (`bun lint`)
  - [ ] UBS scan passes (`ubs_scan(staged=true)`)

- [ ] **Mobile/Tailscale Verification**
  - [ ] iPhone Safari loads session list via Tailscale
  - [ ] No CORS errors in browser console
  - [ ] Can send messages via proxy
  - [ ] SSE still works (existing `/api/sse/[port]`)

- [ ] **Behavioral Checks**
  - [ ] Existing direct `http://127.0.0.1:${port}` calls replaced with `/api/opencode/${port}`
  - [ ] No regressions in desktop browser
  - [ ] Server logs show successful proxy requests
  - [ ] Response times acceptable (<100ms added latency)

---

## Dependencies

### Prerequisites
- ✅ SSE proxy already implemented (`/api/sse/[port]/route.ts`)
- ✅ `MultiServerSSE` already using proxy URLs for SSE
- ✅ Next.js 16 route handlers with async params

### Blockers
- None - this is a standalone task

### Dependent Tasks (Downstream)
- Phase 2: Provider-Free Architecture (uses `/api/opencode/${port}` from this phase)
- Phase 3: Integration Testing (validates full same-origin stack)

---

## Implementation Notes

### Port Validation Security
- Port range 1024-65535 prevents privileged port access
- Numeric validation prevents injection attacks
- Error messages don't leak server internals

### Header Preservation Strategy
- Only copy safe headers (`x-opencode-directory`, `content-type`)
- Don't forward cookies, auth tokens (not needed for local servers)
- Preserve custom OpenCode headers for request routing

### URL Construction
- Handle root path: `/api/opencode/4056` → `http://127.0.0.1:4056`
- Handle nested paths: `/api/opencode/4056/session/list` → `http://127.0.0.1:4056/session/list`
- Use `path.join("/")` to avoid double slashes

### Error Handling Philosophy
- Connection errors → 503 Service Unavailable
- Invalid input → 400 Bad Request
- Server errors → Pass through original status code
- Include helpful error messages for debugging

### Testing Strategy
- Unit tests cover edge cases (validation, path construction, errors)
- Integration tests verify real browser behavior
- Mobile tests validate CORS elimination
- No mocking of Next.js internals (use real `NextRequest`/`NextResponse`)

### Known Gotchas
- **Async params:** Next.js 16 requires `await params` (line 4 of SSE proxy example)
- **Body streaming:** Need `duplex: "half"` for request body streaming (TypeScript error suppressed)
- **Error serialization:** Call `response.text()` before returning error (stream consumed)

### Performance Considerations
- Proxy adds ~10-50ms latency (acceptable for mobile use case)
- No caching at proxy layer (OpenCode server handles caching)
- Connection pooling handled by Node.js `fetch` (reuses HTTP connections)

---

## Rollback Plan

If this breaks something:

1. **Revert client URL changes:**
   ```typescript
   // packages/core/src/client/client.ts
   export function getClientUrl(...) {
     return OPENCODE_URL // Direct URL, not proxy
   }
   ```

2. **Keep SSE proxy working:**
   - SSE proxy is independent, won't be affected
   - Mobile SSE will still work

3. **Delete new route file:**
   ```bash
   rm apps/web/src/app/api/opencode/[port]/[[...path]]/route.ts
   ```

4. **Commit revert:**
   ```bash
   git revert <commit-hash>
   git push
   ```

---

## Related ADRs & Documents

- **ADR-013:** Unified Same-Origin Architecture (parent)
- **ADR-011:** SSE Proxy Architecture (Phase 1 complete)
- **docs/adr/scratch/013-pattern-comparison.md:** Pattern research
- **docs/investigations/sse-infinite-loop-2025-12-30.md:** SSE proxy learnings

---

## References

### Existing Code to Study
- `apps/web/src/app/api/sse/[port]/route.ts` - SSE proxy pattern (copy structure)
- `packages/core/src/client/client.ts` - Client URL generation (modify this)
- `packages/core/src/sse/multi-server-sse.ts` - URL routing (already using `/api/sse/${port}`)

### Next.js Documentation
- [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Dynamic Routes](https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes)
- [Catch-all Segments](https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes#catch-all-segments)

### Hivemind Learnings
- `mem-d1f74e7eeef1f849` - SSE proxy route pattern for Next.js 16
- `mem-ca9adda1e0594497` - MultiServerSSE proxy URL migration

---

## Time Estimates

| Task | Estimated Time |
|------|----------------|
| Create proxy route handler | 45 min |
| Update client SDK URL generation | 30 min |
| Write unit tests | 30 min |
| Manual integration testing | 30 min |
| Mobile/Tailscale verification | 15 min |
| Documentation updates | 15 min |
| **Total** | **2h 45min** |

---

## Post-Implementation Checklist

- [ ] Git commit with message: "feat: add API proxy route for same-origin OpenCode access (ADR-013 Phase 1)"
- [ ] Update ADR-013 with completion status
- [ ] Store learnings in hivemind if gotchas discovered
- [ ] Test on real mobile device via Tailscale
- [ ] Notify coordinator of completion
- [ ] Verify zero CORS errors in browser console
- [ ] Measure proxy latency (should be <50ms)

---

**Ready for Implementation:** This spec contains everything needed to implement Phase 1 without additional context.
