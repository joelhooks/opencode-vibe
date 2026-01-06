/**
 * SSEService tests - Effect.Service pattern with Layer.scoped
 *
 * Tests verify the new SSEService provides the same functionality as WorldSSE
 * but with Effect-native lifecycle management (Layer.scoped + acquireRelease).
 */

import { describe, expect, it, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { SSEService, SSEServiceLive } from "./sse.js"
import { Registry, connectionStatusAtom } from "./atoms.js"
import { Discovery, type DiscoveredServer } from "./discovery/index.js"

describe("SSEService - Effect.Service Pattern", () => {
	let registry: Registry.Registry

	beforeEach(() => {
		registry = Registry.make()
	})

	it("provides SSEService via Layer", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SSEService
			expect(service).toBeDefined()
			expect(service.start).toBeDefined()
			expect(service.stop).toBeDefined()
			expect(service.getConnectedPorts).toBeDefined()
		})

		await Effect.runPromise(program.pipe(Effect.provide(SSEServiceLive(registry))))
	})

	it("can start and stop SSE connections", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SSEService

			// Start connections
			yield* service.start()

			// Verify registry status changed
			const statusAfterStart = registry.get(connectionStatusAtom)
			expect(statusAfterStart).toBe("connecting")

			// Stop connections
			yield* service.stop()

			// Verify cleanup
			const statusAfterStop = registry.get(connectionStatusAtom)
			expect(statusAfterStop).toBe("disconnected")
		})

		await Effect.runPromise(
			program.pipe(
				Effect.provide(SSEServiceLive(registry, { serverUrl: "http://localhost:9999" })),
			),
		)
	})

	it("auto-cleanup on scope exit (acquireRelease pattern)", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SSEService
			yield* service.start()

			// Verify connecting
			const status = registry.get(connectionStatusAtom)
			expect(status).toBe("connecting")

			// Scope will auto-cleanup when program exits
		})

		await Effect.runPromise(
			program.pipe(
				Effect.provide(SSEServiceLive(registry, { serverUrl: "http://localhost:9999" })),
			),
		)

		// After scope exit, service should be cleaned up
		const finalStatus = registry.get(connectionStatusAtom)
		expect(finalStatus).toBe("disconnected")
	})

	it("getConnectedPorts returns Effect", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SSEService
			yield* service.start()

			const ports = yield* service.getConnectedPorts()
			expect(Array.isArray(ports)).toBe(true)

			yield* service.stop()
		})

		await Effect.runPromise(
			program.pipe(
				Effect.provide(SSEServiceLive(registry, { serverUrl: "http://localhost:9999" })),
			),
		)
	})

	it("composes with custom Discovery layer", async () => {
		// RED: This test should fail until we add discoveryLayer to WorldSSEConfig
		// and wire Discovery service into WorldSSE

		// Create mock Discovery layer that returns test servers
		const mockServers: DiscoveredServer[] = [
			{ port: 1999, pid: 100, directory: "/test/project1" },
			{ port: 2000, pid: 200, directory: "/test/project2" },
		]

		const MockDiscoveryLive = Layer.succeed(Discovery, {
			_tag: "Discovery" as const,
			discover: () => Effect.succeed(mockServers),
		})

		const program = Effect.gen(function* () {
			const service = yield* SSEService
			yield* service.start()

			// Wait for discovery to run
			yield* Effect.sleep(100)

			yield* service.stop()
		})

		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					SSEServiceLive(registry, {
						discoveryLayer: MockDiscoveryLive,
					}),
				),
			),
		)
	})

	it("works without discoveryLayer when serverUrl is provided", async () => {
		// Discovery is now optional - serverUrl takes precedence

		const program = Effect.gen(function* () {
			const service = yield* SSEService
			yield* service.start()

			// This test verifies the service starts without errors when using direct serverUrl
			yield* service.stop()
		})

		await Effect.runPromise(
			program.pipe(
				Effect.provide(SSEServiceLive(registry, { serverUrl: "http://localhost:1999" })),
			),
		)
	})
})
