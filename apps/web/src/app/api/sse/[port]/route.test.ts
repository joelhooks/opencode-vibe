import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GET } from "./route"
import { NextRequest } from "next/server"

describe("SSE Proxy Route /api/sse/[port]", () => {
	let originalFetch: typeof global.fetch

	beforeEach(() => {
		originalFetch = global.fetch
	})

	afterEach(() => {
		global.fetch = originalFetch
		vi.restoreAllMocks()
	})

	describe("Port Validation", () => {
		it("rejects non-numeric port with 400", async () => {
			const request = new NextRequest("http://localhost:3000/api/sse/invalid")
			const params = Promise.resolve({ port: "invalid" })

			const response = await GET(request, { params })

			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body.error).toBe("Invalid port number")
		})

		it("rejects port below 1024 with 400", async () => {
			const request = new NextRequest("http://localhost:3000/api/sse/80")
			const params = Promise.resolve({ port: "80" })

			const response = await GET(request, { params })

			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body.error).toBe("Port out of valid range")
		})

		it("rejects port above 65535 with 400", async () => {
			const request = new NextRequest("http://localhost:3000/api/sse/70000")
			const params = Promise.resolve({ port: "70000" })

			const response = await GET(request, { params })

			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body.error).toBe("Port out of valid range")
		})

		it("rejects empty port with 400", async () => {
			const request = new NextRequest("http://localhost:3000/api/sse/")
			const params = Promise.resolve({ port: "" })

			const response = await GET(request, { params })

			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body.error).toBe("Invalid port number")
		})
	})

	describe("Server Connection", () => {
		it("returns 503 when server is unreachable", async () => {
			// Mock fetch to simulate connection failure
			global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch

			const request = new NextRequest("http://localhost:3000/api/sse/3000")
			const params = Promise.resolve({ port: "3000" })

			const response = await GET(request, { params })

			expect(response.status).toBe(503)
			const body = await response.json()
			expect(body.error).toBe("Failed to connect to OpenCode server")
			expect(body.message).toBe("ECONNREFUSED")
		})

		it("returns 500 when response has no body", async () => {
			// Mock fetch to return response without body
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				body: null,
			}) as unknown as typeof fetch

			const request = new NextRequest("http://localhost:3000/api/sse/3000")
			const params = Promise.resolve({ port: "3000" })

			const response = await GET(request, { params })

			expect(response.status).toBe(500)
			const body = await response.json()
			expect(body.error).toBe("No response body")
		})

		it("returns server status code when upstream returns error", async () => {
			// Mock fetch to return 404
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
			}) as unknown as typeof fetch

			const request = new NextRequest("http://localhost:3000/api/sse/3000")
			const params = Promise.resolve({ port: "3000" })

			const response = await GET(request, { params })

			expect(response.status).toBe(404)
			const body = await response.json()
			expect(body.error).toBe("Server returned 404")
		})
	})

	describe("SSE Proxying", () => {
		it("proxies successful SSE response with correct headers", async () => {
			// Create a mock ReadableStream
			const mockStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("data: test\n\n"))
					controller.close()
				},
			})

			// Mock fetch to return successful SSE response
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				body: mockStream,
			}) as unknown as typeof fetch

			const request = new NextRequest("http://localhost:3000/api/sse/3000")
			const params = Promise.resolve({ port: "3000" })

			const response = await GET(request, { params })

			expect(response.status).toBe(200)
			expect(response.headers.get("Content-Type")).toBe("text/event-stream")
			expect(response.headers.get("Cache-Control")).toBe("no-cache")
			expect(response.headers.get("Connection")).toBe("keep-alive")
			expect(response.headers.get("X-Accel-Buffering")).toBe("no")
			expect(response.body).toBe(mockStream)

			// Verify fetch was called with correct URL and headers
			expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:3000/global/event", {
				headers: {
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
				},
			})
		})

		it("accepts valid ports within range", async () => {
			const mockStream = new ReadableStream()
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				body: mockStream,
			}) as unknown as typeof fetch

			const request = new NextRequest("http://localhost:3000/api/sse/8080")
			const params = Promise.resolve({ port: "8080" })

			const response = await GET(request, { params })

			expect(response.status).toBe(200)
			expect(global.fetch).toHaveBeenCalledWith(
				"http://127.0.0.1:8080/global/event",
				expect.any(Object),
			)
		})
	})
})
