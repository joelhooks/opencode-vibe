import { NextRequest, NextResponse } from "next/server"

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

	try {
		const response = await fetch(`http://127.0.0.1:${portNum}/global/event`, {
			headers: {
				Accept: "text/event-stream",
				"Cache-Control": "no-cache",
			},
		})

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
