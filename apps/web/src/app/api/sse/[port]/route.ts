import { type NextRequest, NextResponse } from "next/server"
import { createAuthorizationHeader, getManualServerByProxyPort } from "@/lib/manual-server-registry"

export async function GET(request: NextRequest, { params }: { params: Promise<{ port: string }> }) {
	const { port } = await params // Next.js 16 requires await

	// Validate port is a number
	if (!port || !/^\d+$/.test(port)) {
		return NextResponse.json({ error: "Invalid port number" }, { status: 400 })
	}

	const portNum = parseInt(port, 10)

	// Validate port is in reasonable range
	if (portNum < 1024 || portNum > 65535) {
		return NextResponse.json({ error: "Port out of valid range" }, { status: 400 })
	}

	// Check if this is a manual (remote) server proxy port
	const manualServer = await getManualServerByProxyPort(portNum)
	const targetUrl = manualServer
		? `${manualServer.url}/global/event`
		: `http://127.0.0.1:${portNum}/global/event`

	const headers = new Headers({
		Accept: "text/event-stream",
		"Cache-Control": "no-cache",
	})
	if (manualServer) {
		const authorization = createAuthorizationHeader(manualServer)
		if (authorization) {
			headers.set("authorization", authorization)
		}
	}

	try {
		const response = await fetch(targetUrl, { headers })

		if (!response.ok) {
			return NextResponse.json(
				{ error: `Server returned ${response.status}` },
				{ status: response.status },
			)
		}

		if (!response.body) {
			return NextResponse.json({ error: "No response body" }, { status: 500 })
		}

		return new NextResponse(response.body, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		})
	} catch (error) {
		console.error(`[SSE Proxy] Failed to connect to port ${port}:`, error)
		return NextResponse.json(
			{
				error: "Failed to connect to OpenCode server",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 503 },
		)
	}
}
