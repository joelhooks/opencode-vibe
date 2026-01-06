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
		// Use request.signal to detect client disconnect (page refresh/navigation)
		// This ensures the backend fetch is aborted when the client goes away
		const response = await fetch(`http://127.0.0.1:${portNum}/global/event`, {
			headers: {
				Accept: "text/event-stream",
				"Cache-Control": "no-cache",
			},
			signal: request.signal, // Next.js provides this - aborts when client disconnects
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

		// Return the stream with proper SSE headers
		// When client disconnects, request.signal aborts the fetch, which closes response.body
		return new NextResponse(response.body, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		})
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return NextResponse.json({ error: "Connection aborted" }, { status: 499 })
		}
		return NextResponse.json(
			{
				error: "Failed to connect to OpenCode server",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 503 },
		)
	}
}
