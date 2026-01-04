/**
 * MessageService tests
 *
 * Tests message-parts join logic that eliminates client-side joins.
 * Core provides pre-joined MessageWithParts arrays to React layer.
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { MessageService } from "./message-service.js"
import type { Message, Part } from "../types/domain.js"

/**
 * Helper to run Effect and extract result
 */
async function runEffect<A>(effect: Effect.Effect<A, never, MessageService>): Promise<A> {
	return Effect.runPromise(Effect.provide(effect, MessageService.Default))
}

describe("MessageService", () => {
	describe("listWithParts", () => {
		it("joins messages with their parts", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "user",
					time: { created: 100 },
				},
				{
					id: "msg-2",
					sessionID: "ses-123",
					role: "assistant",
					time: { created: 200, completed: 250 },
				},
			]

			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: "ses-123",
					messageID: "msg-1",
					type: "text",
					text: "Hello",
				},
				{
					id: "part-2",
					sessionID: "ses-123",
					messageID: "msg-2",
					type: "text",
					text: "Hi there",
				},
				{
					id: "part-3",
					sessionID: "ses-123",
					messageID: "msg-2",
					type: "tool",
					tool: "task",
					state: { status: "running" },
				},
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				...messages[0],
				parts: [parts[0]],
			})
			expect(result[1]).toEqual({
				...messages[1],
				parts: [parts[1], parts[2]],
			})
		})

		it("returns empty parts array for messages with no parts", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "user",
					time: { created: 100 },
				},
			]

			const parts: Part[] = []

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				...messages[0],
				parts: [],
			})
		})

		it("handles empty messages array", async () => {
			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({
					messages: [],
					parts: [],
				})
			})

			const result = await runEffect(effect)

			expect(result).toEqual([])
		})

		it("preserves message order", async () => {
			const messages: Message[] = [
				{
					id: "msg-3",
					sessionID: "ses-123",
					role: "user",
					time: { created: 300 },
				},
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "user",
					time: { created: 100 },
				},
				{
					id: "msg-2",
					sessionID: "ses-123",
					role: "assistant",
					time: { created: 200 },
				},
			]

			const parts: Part[] = [
				{ id: "part-1", sessionID: "ses-123", messageID: "msg-1", type: "text", text: "A" },
				{ id: "part-2", sessionID: "ses-123", messageID: "msg-2", type: "text", text: "B" },
				{ id: "part-3", sessionID: "ses-123", messageID: "msg-3", type: "text", text: "C" },
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			// Should preserve original order
			expect(result[0].id).toBe("msg-3")
			expect(result[1].id).toBe("msg-1")
			expect(result[2].id).toBe("msg-2")
		})

		it("ignores parts from other messages", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "user",
					time: { created: 100 },
				},
			]

			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: "ses-123",
					messageID: "msg-1",
					type: "text",
					text: "This part is fine",
				},
				{
					id: "part-2",
					sessionID: "ses-123",
					messageID: "msg-other",
					type: "text",
					text: "This part belongs to different message",
				},
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(1)
			expect(result[0].parts).toHaveLength(1)
			expect(result[0].parts[0].id).toBe("part-1")
		})

		it("handles multiple parts per message", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "assistant",
					time: { created: 100 },
				},
			]

			const parts: Part[] = [
				{ id: "part-1", sessionID: "ses-123", messageID: "msg-1", type: "text", text: "First" },
				{ id: "part-2", sessionID: "ses-123", messageID: "msg-1", type: "text", text: "Second" },
				{
					id: "part-3",
					sessionID: "ses-123",
					messageID: "msg-1",
					type: "tool",
					tool: "bash",
					state: {},
				},
				{
					id: "part-4",
					sessionID: "ses-123",
					messageID: "msg-1",
					type: "tool",
					tool: "bash",
					state: {},
				},
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(1)
			expect(result[0].parts).toHaveLength(4)
			expect(result[0].parts.map((p) => p.id)).toEqual(["part-1", "part-2", "part-3", "part-4"])
		})

		it("preserves all message fields", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "assistant",
					parentID: "msg-0",
					time: { created: 100, completed: 150 },
					finish: "stop",
					tokens: {
						input: 10,
						output: 20,
						reasoning: 5,
						cache: { read: 2, write: 1 },
					},
					agent: "compaction",
					model: {
						name: "claude-4-sonnet",
						limits: { context: 200000, output: 8192 },
					},
				},
			]

			const parts: Part[] = [
				{ id: "part-1", sessionID: "ses-123", messageID: "msg-1", type: "text", text: "Response" },
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(1)
			const msg = result[0]
			expect(msg.id).toBe("msg-1")
			expect(msg.sessionID).toBe("ses-123")
			expect(msg.role).toBe("assistant")
			expect(msg.parentID).toBe("msg-0")
			expect(msg.time).toEqual({ created: 100, completed: 150 })
			expect(msg.finish).toBe("stop")
			expect(msg.tokens).toEqual({
				input: 10,
				output: 20,
				reasoning: 5,
				cache: { read: 2, write: 1 },
			})
			expect(msg.agent).toBe("compaction")
			expect(msg.model).toEqual({
				name: "claude-4-sonnet",
				limits: { context: 200000, output: 8192 },
			})
			expect(msg.parts).toHaveLength(1)
		})

		it("preserves all part fields", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "assistant",
					time: { created: 100 },
				},
			]

			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: "ses-123",
					messageID: "msg-1",
					type: "tool",
					tool: "bash",
					state: {
						status: "running",
						metadata: { timeout: 5000 },
					},
				},
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(1)
			const part = result[0].parts[0] as any
			expect(part.id).toBe("part-1")
			expect(part.messageID).toBe("msg-1")
			expect(part.type).toBe("tool")
			expect(part.tool).toBe("bash")
			expect(part.state).toEqual({
				status: "running",
				metadata: { timeout: 5000 },
			})
		})
	})

	describe("Edge cases", () => {
		it("handles messages with undefined fields", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "user",
					time: { created: Date.now() },
					// No parentID, finish, etc.
				},
			]

			const parts: Part[] = [
				{
					id: "part-1",
					sessionID: "ses-123",
					messageID: "msg-1",
					type: "text",
					text: "Hello",
					// No tool, state, etc.
				},
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe("msg-1")
			expect(result[0].parts).toHaveLength(1)
		})

		it("handles orphaned parts (no matching message)", async () => {
			const messages: Message[] = [
				{
					id: "msg-1",
					sessionID: "ses-123",
					role: "user",
					time: { created: 100 },
				},
			]

			const parts: Part[] = [
				{ id: "part-1", sessionID: "ses-123", messageID: "msg-1", type: "text", text: "OK" },
				{ id: "part-2", sessionID: "ses-123", messageID: "msg-999", type: "text", text: "Orphan" },
			] as Part[]

			const effect = Effect.gen(function* (_) {
				const service = yield* _(MessageService)
				return service.listWithParts({ messages, parts })
			})

			const result = await runEffect(effect)

			// Orphaned parts should be ignored
			expect(result).toHaveLength(1)
			expect(result[0].parts).toHaveLength(1)
			expect(result[0].parts[0].id).toBe("part-1")
		})
	})
})
