import { NextRequest, NextResponse } from "next/server"

/**
 * API Proxy for OpenCode servers
 *
 * Routes all API calls through Next.js to eliminate CORS issues
 * on mobile/Tailscale. Proxies to http://127.0.0.1:${port}/${path}
 *
 * Architecture:
 * - Browser: fetch('/api/opencode/{port}/session/list') [same-origin]
 * - Next.js: Proxy to http://127.0.0.1:{port}/session/list [server-to-server]
 * - Response: Return to browser [same-origin]
 *
 * Route Priority:
 * Next.js 16 prioritizes static routes (/api/opencode/servers) over dynamic routes ([port])
 * automatically. No explicit reserved segment checking needed - requests to /api/opencode/servers
 * will match the static route first. This catch-all only handles numeric port patterns.
 *
 * Related:
 * - SSE Proxy: /api/sse/[port]/route.ts (handles SSE streams)
 * - ADR-013: Unified Same-Origin Architecture
 * - Static route: /api/opencode/servers/route.ts (server discovery)
 *
 * @example
 * // Client makes same-origin request
 * fetch('/api/opencode/{port}/session/list')
 *
 * // Next.js proxies to
 * http://127.0.0.1:{port}/session/list
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
 * Reserved segments that should not be treated as port numbers
 * These have their own static route handlers (e.g., /api/opencode/servers/route.ts)
 */
const RESERVED_SEGMENTS = new Set(["servers"])

/**
 * Validate port number for security
 * - Must be numeric
 * - Must be in range 1024-65535 (user ports)
 * - Must not be a reserved route segment
 */
function validatePort(
	port: string,
): { valid: true; port: number } | { valid: false; error: string; reserved?: boolean } {
	// Check if this is a reserved route segment
	if (RESERVED_SEGMENTS.has(port)) {
		return { valid: false, error: "Reserved route segment", reserved: true }
	}

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
 * buildTargetUrl({port}, ['session', 'list'])
 * // => 'http://127.0.0.1:{port}/session/list'
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
		// If this is a reserved segment, return 404 so Next.js can try other routes
		// This shouldn't happen in production (static routes should match first)
		// but provides a fallback during development
		const status = validation.reserved ? 404 : 400
		return NextResponse.json({ error: validation.error }, { status })
	}

	return proxyRequest(request, validation.port, path)
}

export async function POST(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		const status = validation.reserved ? 404 : 400
		return NextResponse.json({ error: validation.error }, { status })
	}

	return proxyRequest(request, validation.port, path)
}

export async function PUT(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		const status = validation.reserved ? 404 : 400
		return NextResponse.json({ error: validation.error }, { status })
	}

	return proxyRequest(request, validation.port, path)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		const status = validation.reserved ? 404 : 400
		return NextResponse.json({ error: validation.error }, { status })
	}

	return proxyRequest(request, validation.port, path)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		const status = validation.reserved ? 404 : 400
		return NextResponse.json({ error: validation.error }, { status })
	}

	return proxyRequest(request, validation.port, path)
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
	const { port, path } = await context.params

	const validation = validatePort(port)
	if (!validation.valid) {
		const status = validation.reserved ? 404 : 400
		return NextResponse.json({ error: validation.error }, { status })
	}

	return proxyRequest(request, validation.port, path)
}
