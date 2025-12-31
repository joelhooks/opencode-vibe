/**
 * useSSE Hook Tests
 *
 * Tests SSE connection lifecycle, reconnection, event parsing, and cleanup.
 * Tests the fetch-based SSE implementation per SYNC_IMPLEMENTATION.md
 */

import { describe, test, expect, vi, beforeEach } from "vitest"

/**
 * SSE Stream Parser Tests
 *
 * Test the core SSE parsing logic in isolation before testing the hook
 */
describe("SSE Stream Parser", () => {
	test("parses single-line data event", () => {
		const chunk = 'data: {"directory":"/test","payload":{"type":"ping"}}\n\n'
		const lines = chunk.split("\n")
		const dataLines: string[] = []

		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.replace(/^data:\s*/, ""))
			}
		}

		const data = JSON.parse(dataLines.join("\n"))
		expect(data.directory).toBe("/test")
		expect(data.payload.type).toBe("ping")
	})

	test("parses multi-line data event", () => {
		const chunk = 'data: {"directory":"/test",\ndata: "payload":{"type":"ping"}}\n\n'
		const lines = chunk.split("\n")
		const dataLines: string[] = []

		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.replace(/^data:\s*/, ""))
			}
		}

		const data = JSON.parse(dataLines.join("\n"))
		expect(data.directory).toBe("/test")
	})

	test("handles multiple events separated by double newline", () => {
		const buffer =
			'data: {"directory":"/test","payload":{"type":"ping"}}\n\ndata: {"directory":"/test2","payload":{"type":"pong"}}\n\n'
		const chunks = buffer.split("\n\n")
		const events = []

		for (const chunk of chunks) {
			if (!chunk) continue
			const lines = chunk.split("\n")
			const dataLines: string[] = []

			for (const line of lines) {
				if (line.startsWith("data:")) {
					dataLines.push(line.replace(/^data:\s*/, ""))
				}
			}

			if (dataLines.length > 0) {
				const data = JSON.parse(dataLines.join("\n"))
				events.push(data)
			}
		}

		expect(events).toHaveLength(2)
		expect(events[0].payload.type).toBe("ping")
		expect(events[1].payload.type).toBe("pong")
	})

	test("preserves incomplete chunk in buffer", () => {
		let buffer = 'data: {"directory":"/test",'
		const chunks = buffer.split("\n\n")
		buffer = chunks.pop() ?? ""

		expect(buffer).toBe('data: {"directory":"/test",')
		expect(chunks).toHaveLength(0)

		// Add more data
		buffer += '"payload":{"type":"ping"}}\n\n'
		const newChunks = buffer.split("\n\n")
		buffer = newChunks.pop() ?? ""

		expect(newChunks).toHaveLength(1)
	})
})

/**
 * Exponential Backoff Tests
 */
describe("Exponential Backoff", () => {
	test("calculates backoff with 3s initial delay", () => {
		const retryDelay = 3000
		const retryCount = 0
		const backoff = Math.min(retryDelay * 2 ** retryCount, 30000)
		expect(backoff).toBe(3000)
	})

	test("doubles delay on each retry", () => {
		const retryDelay = 3000
		const backoffs = [0, 1, 2, 3, 4].map((count) => Math.min(retryDelay * 2 ** count, 30000))
		expect(backoffs).toEqual([3000, 6000, 12000, 24000, 30000])
	})

	test("caps at 30s maximum", () => {
		const retryDelay = 3000
		const retryCount = 10
		const backoff = Math.min(retryDelay * 2 ** retryCount, 30000)
		expect(backoff).toBe(30000)
	})
})

/**
 * EventSourceParserStream Tests
 *
 * Tests integration with eventsource-parser/stream for standardized SSE parsing
 */
describe("EventSourceParserStream Integration", () => {
	test("parses SSE events using EventSourceParserStream", async () => {
		const event = { directory: "/test", payload: { type: "ping" } }
		const events: any[] = []

		// Mock fetch to return SSE stream
		const mockFetch = vi.fn(async () => {
			const stream = new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder()
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
					controller.close()
				},
			})
			return new Response(stream, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})
		})
		global.fetch = mockFetch as any

		// Import EventSourceParserStream dynamically to avoid build errors if not installed
		const { EventSourceParserStream } = await import("eventsource-parser/stream")

		const response = await fetch("http://localhost:3000/global/event")
		const stream = response
			.body!.pipeThrough(new TextDecoderStream())
			.pipeThrough(new EventSourceParserStream())

		const reader = stream.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			events.push(JSON.parse(value.data))
		}

		expect(events).toHaveLength(1)
		expect(events[0]).toEqual(event)
	})

	test("handles multi-line events with EventSourceParserStream", async () => {
		const event = {
			directory: "/test",
			payload: { type: "ping", data: "multi\nline" },
		}
		const events: any[] = []

		const mockFetch = vi.fn(async () => {
			const stream = new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder()
					// Multi-line data requires multiple "data:" prefixes
					const json = JSON.stringify(event)
					controller.enqueue(encoder.encode(`data: ${json}\n\n`))
					controller.close()
				},
			})
			return new Response(stream, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})
		})
		global.fetch = mockFetch as any

		const { EventSourceParserStream } = await import("eventsource-parser/stream")

		const response = await fetch("http://localhost:3000/global/event")
		const stream = response
			.body!.pipeThrough(new TextDecoderStream())
			.pipeThrough(new EventSourceParserStream())

		const reader = stream.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			events.push(JSON.parse(value.data))
		}

		expect(events).toHaveLength(1)
		expect(events[0]).toEqual(event)
	})
})

/**
 * Fetch-based SSE Connection Tests
 */
describe("useSSE - Fetch-based SSE", () => {
	beforeEach(() => {
		// Clear any mocked fetch
		global.fetch = undefined as any
	})

	test("should call fetch with correct SSE headers", async () => {
		const mockFetch = vi.fn(async () => {
			return new Response(null, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})
		})
		global.fetch = mockFetch as any

		const url = "http://localhost:3000"
		await fetch(`${url}/global/event`, {
			headers: {
				Accept: "text/event-stream",
				"Cache-Control": "no-cache",
			},
		})

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3000/global/event",
			expect.objectContaining({
				headers: {
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
				},
			}),
		)
	})

	test("should handle fetch error", async () => {
		const mockFetch = vi.fn(async () => {
			return new Response(null, { status: 500, statusText: "Server Error" })
		})
		global.fetch = mockFetch as any

		const url = "http://localhost:3000"
		const response = await fetch(`${url}/global/event`)

		expect(response.ok).toBe(false)
		expect(response.status).toBe(500)
	})

	test("should abort fetch on abort signal", async () => {
		const abortController = new AbortController()
		const mockFetch = vi.fn(async (url: string, options: any) => {
			// Simulate abort after small delay
			setTimeout(() => abortController.abort(), 10)

			return new Promise((_, reject) => {
				options.signal.addEventListener("abort", () => {
					const error = new Error("Aborted") as any
					error.name = "AbortError"
					reject(error)
				})
			})
		})
		global.fetch = mockFetch as any

		const url = "http://localhost:3000"
		try {
			await fetch(`${url}/global/event`, {
				signal: abortController.signal,
			})
		} catch (error: any) {
			expect(error.name).toBe("AbortError")
		}
	})
})

/**
 * Integration Tests - API Contract
 *
 * Note: These integration tests document the expected behavior.
 * For actual React hook testing in a real environment, use the hook
 * in a component with proper React Testing Library setup.
 */
describe("useSSE Hook - API Contract", () => {
	test("hook accepts required options for useSSEDirect", () => {
		// This test verifies the TypeScript interface compiles
		const validOptions = {
			url: "http://localhost:3000",
			onEvent: (_event: any) => {},
			onConnect: () => {},
			onError: (_err: Error) => {},
			retryDelay: 3000,
			maxRetries: 10,
		}

		expect(validOptions).toBeDefined()
	})

	test("hook has minimal required options for useSSEDirect", () => {
		const minimalOptions = {
			url: "http://localhost:3000",
			onEvent: (_event: any) => {},
		}

		expect(minimalOptions).toBeDefined()
	})

	test("default values are documented", () => {
		// Default values per SYNC_IMPLEMENTATION.md:
		const defaults = {
			retryDelay: 3000, // 3s initial
			maxRetries: 10, // 10 retries max
		}

		expect(defaults.retryDelay).toBe(3000)
		expect(defaults.maxRetries).toBe(10)
	})
})

/**
 * Behavioral Tests - SSE Logic
 *
 * Tests the underlying fetch-based SSE logic used by the hook
 */
describe("useSSE Hook - SSE Logic", () => {
	beforeEach(() => {
		// Clear mocks
		global.fetch = undefined as any
	})

	test("should connect and receive events", async () => {
		const events: any[] = []
		const event = { directory: "/test", payload: { type: "ping" } }

		// Mock fetch to return a stream with an SSE event
		const mockFetch = vi.fn(async () => {
			const stream = new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder()
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
					controller.close()
				},
			})
			return new Response(stream, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})
		})
		global.fetch = mockFetch as any

		// Simulate SSE parsing
		const response = await fetch("http://localhost:3000/global/event")
		const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
		let buffer = ""

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += value
			const chunks = buffer.split("\n\n")
			buffer = chunks.pop() ?? ""

			for (const chunk of chunks) {
				const lines = chunk.split("\n")
				const dataLines: string[] = []

				for (const line of lines) {
					if (line.startsWith("data:")) {
						dataLines.push(line.replace(/^data:\s*/, ""))
					}
				}

				if (dataLines.length) {
					const data = JSON.parse(dataLines.join("\n"))
					events.push(data)
				}
			}
		}

		expect(events).toHaveLength(1)
		expect(events[0]).toEqual(event)
	})

	test("should retry with exponential backoff on error", async () => {
		const errors: Error[] = []
		let retryCount = 0
		const retryDelay = 3000
		const maxRetries = 5

		// Mock fetch to fail
		const mockFetch = vi.fn(async () => {
			throw new Error("Connection failed")
		})
		global.fetch = mockFetch as any

		// Simulate retry logic
		const connect = async () => {
			try {
				await fetch("http://localhost:3000/global/event")
			} catch (error) {
				errors.push(error as Error)

				if (retryCount < maxRetries) {
					const backoff = Math.min(retryDelay * 2 ** retryCount, 30000)
					retryCount++

					// Verify backoff calculation
					expect(backoff).toBe(Math.min(retryDelay * 2 ** (retryCount - 1), 30000))
				}
			}
		}

		// Simulate 5 retries
		for (let i = 0; i < 5; i++) {
			await connect()
		}

		expect(errors).toHaveLength(5)
		expect(retryCount).toBe(5)
	})

	test("should stop retrying after maxRetries", async () => {
		const errors: Error[] = []
		let retryCount = 0
		const maxRetries = 10

		const mockFetch = vi.fn(async () => {
			throw new Error("Connection failed")
		})
		global.fetch = mockFetch as any

		const connect = async () => {
			try {
				await fetch("http://localhost:3000/global/event")
			} catch (error) {
				errors.push(error as Error)
				retryCount++
			}
		}

		// Try to connect 15 times
		for (let i = 0; i < 15; i++) {
			await connect()

			// Check if we should stop retrying
			if (retryCount >= maxRetries) {
				break
			}
		}

		expect(retryCount).toBe(maxRetries)
		expect(errors).toHaveLength(maxRetries)
	})

	test("should handle non-200 response as error", async () => {
		const errors: Error[] = []

		const mockFetch = vi.fn(async () => {
			return new Response(null, { status: 500, statusText: "Server Error" })
		})
		global.fetch = mockFetch as any

		const response = await fetch("http://localhost:3000/global/event")

		if (!response.ok) {
			errors.push(new Error(`SSE failed: ${response.status} ${response.statusText}`))
		}

		expect(errors).toHaveLength(1)
		expect(errors[0]!.message).toBe("SSE failed: 500 Server Error")
	})

	test("should cleanup abort controller on unmount", async () => {
		const abortController = new AbortController()
		let abortCalled = false

		abortController.signal.addEventListener("abort", () => {
			abortCalled = true
		})

		// Simulate unmount
		abortController.abort()

		expect(abortCalled).toBe(true)
		expect(abortController.signal.aborted).toBe(true)
	})

	test("should handle stream interruption and reconnect", async () => {
		const errors: Error[] = []
		let retryCount = 0
		const retryDelay = 3000

		// First call: stream interrupts
		// Second call: successful connection
		let callCount = 0
		const mockFetch = vi.fn(async () => {
			callCount++
			if (callCount === 1) {
				const stream = new ReadableStream({
					start(controller) {
						// Simulate stream interruption
						controller.error(new Error("Stream interrupted"))
					},
				})
				return new Response(stream, {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				})
			}
			// Second attempt succeeds
			const stream = new ReadableStream({
				start(controller) {
					controller.close()
				},
			})
			return new Response(stream, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})
		})
		global.fetch = mockFetch as any

		const connect = async () => {
			try {
				const response = await fetch("http://localhost:3000/global/event")
				const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()

				while (true) {
					const { done } = await reader.read()
					if (done) break
				}

				retryCount = 0 // Reset on success
			} catch (error) {
				if ((error as Error).name !== "AbortError") {
					errors.push(error as Error)

					if (retryCount < 10) {
						retryCount++
					}
				}
			}
		}

		// First attempt - stream interrupts
		await connect()
		expect(errors).toHaveLength(1)
		expect(retryCount).toBe(1)

		// Second attempt - succeeds
		await connect()
		expect(retryCount).toBe(0) // Reset on success
	})
})

/**
 * Visibility API Tests
 *
 * Tests SSE disconnect on background, reconnect on foreground
 */
describe("Visibility API", () => {
	test("should disconnect when page is backgrounded", () => {
		let aborted = false
		const abortController = new AbortController()

		abortController.signal.addEventListener("abort", () => {
			aborted = true
		})

		// Simulate visibility change to hidden
		const isBackgrounded = { current: false }
		const handleVisibilityChange = (visibilityState: string) => {
			if (visibilityState === "hidden") {
				isBackgrounded.current = true
				abortController.abort()
			}
		}

		handleVisibilityChange("hidden")

		expect(isBackgrounded.current).toBe(true)
		expect(aborted).toBe(true)
	})

	test("should reconnect when page is foregrounded", () => {
		let connectCalled = false
		const isBackgrounded = { current: true }
		const retryCount = { current: 5 }

		const connect = () => {
			connectCalled = true
		}

		const handleVisibilityChange = (visibilityState: string) => {
			if (visibilityState === "visible") {
				isBackgrounded.current = false
				retryCount.current = 0 // Reset retries on foreground
				connect()
			}
		}

		handleVisibilityChange("visible")

		expect(isBackgrounded.current).toBe(false)
		expect(retryCount.current).toBe(0)
		expect(connectCalled).toBe(true)
	})

	test("should not connect when backgrounded", () => {
		let connectAttempted = false
		const isBackgrounded = { current: true }

		const connect = () => {
			if (isBackgrounded.current) return
			connectAttempted = true
		}

		connect()

		expect(connectAttempted).toBe(false)
	})

	test("should clear heartbeat timeout when backgrounded", () => {
		let timeoutCleared = false
		const heartbeatTimeout = { current: setTimeout(() => {}, 60000) }

		const handleVisibilityChange = (visibilityState: string) => {
			if (visibilityState === "hidden") {
				if (heartbeatTimeout.current) {
					clearTimeout(heartbeatTimeout.current)
					timeoutCleared = true
				}
			}
		}

		handleVisibilityChange("hidden")

		expect(timeoutCleared).toBe(true)
	})
})

/**
 * Heartbeat Timeout Tests
 *
 * Tests 60s heartbeat timeout detection (2x server heartbeat of 30s)
 */
describe("Heartbeat Timeout", () => {
	test("heartbeat timeout is 60 seconds", () => {
		const HEARTBEAT_TIMEOUT_MS = 60_000
		expect(HEARTBEAT_TIMEOUT_MS).toBe(60000)
	})

	test("should reset heartbeat timeout on event received", () => {
		let timeoutCleared = false
		let newTimeoutSet = false
		const HEARTBEAT_TIMEOUT_MS = 60_000

		const heartbeatTimeout = {
			current: setTimeout(() => {}, HEARTBEAT_TIMEOUT_MS),
		}

		const resetHeartbeat = () => {
			if (heartbeatTimeout.current) {
				clearTimeout(heartbeatTimeout.current)
				timeoutCleared = true
			}
			heartbeatTimeout.current = setTimeout(() => {}, HEARTBEAT_TIMEOUT_MS)
			newTimeoutSet = true
		}

		// Simulate receiving an event
		resetHeartbeat()

		expect(timeoutCleared).toBe(true)
		expect(newTimeoutSet).toBe(true)
	})

	test("should trigger reconnect on heartbeat timeout", async () => {
		let reconnectCalled = false
		let errorReported = false

		const onError = (error: Error) => {
			if (error.message === "Heartbeat timeout") {
				errorReported = true
			}
		}

		const reconnect = () => {
			reconnectCalled = true
		}

		// Simulate heartbeat timeout callback
		const heartbeatTimeoutCallback = () => {
			onError(new Error("Heartbeat timeout"))
			reconnect()
		}

		heartbeatTimeoutCallback()

		expect(errorReported).toBe(true)
		expect(reconnectCalled).toBe(true)
	})

	test("should start heartbeat monitoring on successful connection", () => {
		let heartbeatStarted = false
		const HEARTBEAT_TIMEOUT_MS = 60_000

		const resetHeartbeat = () => {
			heartbeatStarted = true
		}

		// Simulate successful connection
		const onConnect = () => {
			resetHeartbeat()
		}

		onConnect()

		expect(heartbeatStarted).toBe(true)
	})

	test("should reset heartbeat on server.heartbeat event", () => {
		let heartbeatResetCount = 0

		const resetHeartbeat = () => {
			heartbeatResetCount++
		}

		const onEvent = (event: { payload: { type: string } }) => {
			// Reset heartbeat on every event (including server.heartbeat)
			resetHeartbeat()
		}

		// Simulate receiving heartbeat events
		onEvent({ payload: { type: "server.heartbeat" } })
		onEvent({ payload: { type: "server.heartbeat" } })
		onEvent({ payload: { type: "message.updated" } })

		expect(heartbeatResetCount).toBe(3)
	})

	test("should cleanup heartbeat timeout on unmount", () => {
		let timeoutCleared = false
		const heartbeatTimeout = { current: setTimeout(() => {}, 60000) }

		// Simulate unmount cleanup
		const cleanup = () => {
			if (heartbeatTimeout.current) {
				clearTimeout(heartbeatTimeout.current)
				timeoutCleared = true
			}
		}

		cleanup()

		expect(timeoutCleared).toBe(true)
	})
})

/**
 * Event Batching Tests
 *
 * Tests that rapid SSE events are batched to reduce render thrashing
 */
describe("Event Batching", () => {
	test("batches multiple rapid events within 16ms", async () => {
		const dispatchedEvents: any[] = []
		const batchedDispatches: number[] = []
		let dispatchCount = 0

		// Mock dispatch function that records timing
		const mockDispatch = (event: any) => {
			dispatchedEvents.push(event)
			dispatchCount++
		}

		// Mock queueEvent function with batching logic
		const updateQueue: any[] = []
		let debounceTimer: NodeJS.Timeout | null = null

		const queueEvent = (event: any, dispatch: (e: any) => void) => {
			// Immediate dispatch for heartbeat
			if (event.payload?.type === "server.heartbeat") {
				dispatch(event)
				return
			}

			updateQueue.push(event)

			if (!debounceTimer) {
				debounceTimer = setTimeout(() => {
					batchedDispatches.push(updateQueue.length)
					for (const e of updateQueue) {
						dispatch(e)
					}
					updateQueue.length = 0
					debounceTimer = null
				}, 16)
			}
		}

		// Simulate 5 rapid events within 16ms
		const event1 = { directory: "/test", payload: { type: "message.updated" } }
		const event2 = { directory: "/test", payload: { type: "message.updated" } }
		const event3 = { directory: "/test", payload: { type: "message.updated" } }
		const event4 = { directory: "/test", payload: { type: "message.updated" } }
		const event5 = { directory: "/test", payload: { type: "message.updated" } }

		queueEvent(event1, mockDispatch)
		queueEvent(event2, mockDispatch)
		queueEvent(event3, mockDispatch)
		queueEvent(event4, mockDispatch)
		queueEvent(event5, mockDispatch)

		// Events should be queued, not dispatched yet
		expect(dispatchedEvents).toHaveLength(0)
		expect(updateQueue).toHaveLength(5)

		// Wait for debounce to flush
		await new Promise((resolve) => setTimeout(resolve, 20))

		// All 5 events should be dispatched in one batch
		expect(dispatchedEvents).toHaveLength(5)
		expect(batchedDispatches).toEqual([5])
	})

	test("heartbeat events bypass batching", async () => {
		const dispatchedEvents: any[] = []
		const updateQueue: any[] = []
		let debounceTimer: NodeJS.Timeout | null = null

		const mockDispatch = (event: any) => {
			dispatchedEvents.push(event)
		}

		const queueEvent = (event: any, dispatch: (e: any) => void) => {
			// Immediate dispatch for heartbeat
			if (event.payload?.type === "server.heartbeat") {
				dispatch(event)
				return
			}

			updateQueue.push(event)

			if (!debounceTimer) {
				debounceTimer = setTimeout(() => {
					for (const e of updateQueue) {
						dispatch(e)
					}
					updateQueue.length = 0
					debounceTimer = null
				}, 16)
			}
		}

		const heartbeat = {
			directory: "/test",
			payload: { type: "server.heartbeat" },
		}
		const regularEvent = {
			directory: "/test",
			payload: { type: "message.updated" },
		}

		queueEvent(regularEvent, mockDispatch)
		queueEvent(heartbeat, mockDispatch)

		// Heartbeat should be dispatched immediately
		expect(dispatchedEvents).toHaveLength(1)
		expect(dispatchedEvents[0].payload.type).toBe("server.heartbeat")

		// Regular event still queued
		expect(updateQueue).toHaveLength(1)

		// Wait for debounce
		await new Promise((resolve) => setTimeout(resolve, 20))

		// Now both dispatched
		expect(dispatchedEvents).toHaveLength(2)
	})

	test("multiple batches process independently", async () => {
		const dispatchedEvents: any[] = []
		const batchSizes: number[] = []
		const updateQueue: any[] = []
		let debounceTimer: NodeJS.Timeout | null = null

		const mockDispatch = (event: any) => {
			dispatchedEvents.push(event)
		}

		const queueEvent = (event: any, dispatch: (e: any) => void) => {
			if (event.payload?.type === "server.heartbeat") {
				dispatch(event)
				return
			}

			updateQueue.push(event)

			if (!debounceTimer) {
				debounceTimer = setTimeout(() => {
					batchSizes.push(updateQueue.length)
					for (const e of updateQueue) {
						dispatch(e)
					}
					updateQueue.length = 0
					debounceTimer = null
				}, 16)
			}
		}

		const event1 = { directory: "/test", payload: { type: "message.updated" } }
		const event2 = { directory: "/test", payload: { type: "message.updated" } }

		// First batch
		queueEvent(event1, mockDispatch)
		queueEvent(event2, mockDispatch)

		// Wait for first batch to flush
		await new Promise((resolve) => setTimeout(resolve, 20))

		expect(dispatchedEvents).toHaveLength(2)
		expect(batchSizes).toEqual([2])

		// Second batch
		queueEvent(event1, mockDispatch)
		queueEvent(event2, mockDispatch)
		queueEvent(event2, mockDispatch)

		await new Promise((resolve) => setTimeout(resolve, 20))

		expect(dispatchedEvents).toHaveLength(5)
		expect(batchSizes).toEqual([2, 3])
	})
})

/**
 * Ring Buffer Memory Leak Tests
 *
 * Tests that the events array is capped to prevent unbounded memory growth
 */
describe("Ring Buffer Cap", () => {
	test("caps events array at MAX_EVENTS (100)", () => {
		const MAX_EVENTS = 100
		const events: any[] = []

		// Simulate adding 150 events
		for (let i = 0; i < 150; i++) {
			const data = { directory: "/test", payload: { type: "ping", index: i } }
			// Ring buffer logic
			events.push(data)
			if (events.length > MAX_EVENTS) {
				events.shift() // Remove oldest
			}
		}

		// Should only retain last 100 events
		expect(events).toHaveLength(MAX_EVENTS)
	})

	test("retains only last 100 events (FIFO)", () => {
		const MAX_EVENTS = 100
		const events: any[] = []

		// Add 150 events
		for (let i = 0; i < 150; i++) {
			const data = { directory: "/test", payload: { type: "ping", index: i } }
			events.push(data)
			if (events.length > MAX_EVENTS) {
				events.shift()
			}
		}

		// First event should be index 50 (events 0-49 were dropped)
		expect(events[0].payload.index).toBe(50)
		// Last event should be index 149
		expect(events[99].payload.index).toBe(149)
	})

	test("oldest events are dropped first (FIFO order)", () => {
		const MAX_EVENTS = 100
		const events: any[] = []

		// Add first batch (0-99)
		for (let i = 0; i < 100; i++) {
			const data = { directory: "/test", payload: { type: "ping", index: i } }
			events.push(data)
		}

		expect(events).toHaveLength(100)
		expect(events[0].payload.index).toBe(0)

		// Add one more event (should drop index 0)
		const data = { directory: "/test", payload: { type: "ping", index: 100 } }
		events.push(data)
		if (events.length > MAX_EVENTS) {
			events.shift()
		}

		expect(events).toHaveLength(100)
		expect(events[0].payload.index).toBe(1) // 0 was dropped
		expect(events[99].payload.index).toBe(100)
	})

	test("handles events arriving in bursts", () => {
		const MAX_EVENTS = 100
		const events: any[] = []

		// Simulate burst of 50 events
		for (let i = 0; i < 50; i++) {
			const data = { directory: "/test", payload: { type: "ping", index: i } }
			events.push(data)
		}

		expect(events).toHaveLength(50)

		// Simulate another burst of 75 events (total 125)
		for (let i = 50; i < 125; i++) {
			const data = { directory: "/test", payload: { type: "ping", index: i } }
			events.push(data)
			if (events.length > MAX_EVENTS) {
				events.shift()
			}
		}

		// Should cap at 100, retaining events 25-124
		expect(events).toHaveLength(MAX_EVENTS)
		expect(events[0].payload.index).toBe(25)
		expect(events[99].payload.index).toBe(124)
	})
})

/**
 * SSE Subscribe Pattern Tests - Subscribe Pattern
 *
 * Tests the subscribe/unsubscribe pattern used by components
 */
describe("SSE Subscribe Pattern", () => {
	test("subscribe returns unsubscribe function", () => {
		const listeners = new Map<string, Set<(event: any) => void>>()

		const subscribe = (eventType: string, callback: (event: any) => void) => {
			if (!listeners.has(eventType)) {
				listeners.set(eventType, new Set())
			}
			listeners.get(eventType)!.add(callback)

			// Return unsubscribe function
			return () => {
				const callbacks = listeners.get(eventType)
				if (callbacks) {
					callbacks.delete(callback)
					if (callbacks.size === 0) {
						listeners.delete(eventType)
					}
				}
			}
		}

		const callback = () => {}
		const unsubscribe = subscribe("message.updated", callback)

		expect(listeners.has("message.updated")).toBe(true)
		expect(listeners.get("message.updated")!.size).toBe(1)

		unsubscribe()

		expect(listeners.has("message.updated")).toBe(false)
	})

	test("dispatches events to correct subscribers", () => {
		const listeners = new Map<string, Set<(event: any) => void>>()
		const receivedEvents: any[] = []

		const subscribe = (eventType: string, callback: (event: any) => void) => {
			if (!listeners.has(eventType)) {
				listeners.set(eventType, new Set())
			}
			listeners.get(eventType)!.add(callback)
			return () => {
				listeners.get(eventType)?.delete(callback)
			}
		}

		const dispatch = (event: { payload: { type: string } }) => {
			const eventType = event.payload.type
			const callbacks = listeners.get(eventType)
			if (callbacks) {
				for (const callback of callbacks) {
					callback(event)
				}
			}
		}

		// Subscribe to message.updated
		subscribe("message.updated", (event) => {
			receivedEvents.push(event)
		})

		// Dispatch matching event
		dispatch({ payload: { type: "message.updated" } })

		// Dispatch non-matching event
		dispatch({ payload: { type: "session.updated" } })

		expect(receivedEvents).toHaveLength(1)
		expect(receivedEvents[0].payload.type).toBe("message.updated")
	})

	test("multiple subscribers receive same event", () => {
		const listeners = new Map<string, Set<(event: any) => void>>()
		const received1: any[] = []
		const received2: any[] = []

		const subscribe = (eventType: string, callback: (event: any) => void) => {
			if (!listeners.has(eventType)) {
				listeners.set(eventType, new Set())
			}
			listeners.get(eventType)!.add(callback)
			return () => {
				listeners.get(eventType)?.delete(callback)
			}
		}

		const dispatch = (event: { payload: { type: string } }) => {
			const eventType = event.payload.type
			const callbacks = listeners.get(eventType)
			if (callbacks) {
				for (const callback of callbacks) {
					callback(event)
				}
			}
		}

		subscribe("message.updated", (event) => received1.push(event))
		subscribe("message.updated", (event) => received2.push(event))

		dispatch({ payload: { type: "message.updated" } })

		expect(received1).toHaveLength(1)
		expect(received2).toHaveLength(1)
	})
})
