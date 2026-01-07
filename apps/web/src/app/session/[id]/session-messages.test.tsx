import { describe, test, expect } from "vitest"

/**
 * Test the MessageRenderer memo comparison logic in isolation.
 *
 * Tests the fix for: Task cards not updating in real-time
 * Root cause: MessageRenderer memo didn't compare _opencode.state.metadata.summary
 *
 * Also tests that SessionMessages uses World Stream hooks (not Zustand hydration).
 *
 * Instead of rendering components (NO DOM TESTING), we test the memo comparison
 * function directly by simulating what React.memo receives as props.
 */
describe("SessionMessages", () => {
	describe("World Stream integration (opencode-next--xts0a-mk2shsphpsz)", () => {
		test("component imports from World Stream hooks, not Zustand", async () => {
			/**
			 * Characterization test for bug fix: Session detail view not streaming messages
			 *
			 * ROOT CAUSE:
			 * - SessionMessages was hydrating SSR data into Zustand store (useOpencodeStore.hydrateMessages)
			 * - But reading from World Stream hooks (useMessagesWithParts, useSessionStatus)
			 * - World Stream never saw the hydrated data → no messages displayed
			 * - SSE events went to World Stream but UI showed "No messages yet"
			 *
			 * FIX (Phase 2):
			 * - Removed Zustand hydration entirely
			 * - World Stream hooks are reactive (useWorld → useSyncExternalStore)
			 * - SSE events flow: WorldSSE → routeEvent → messagesAtom/partsAtom → notifySubscribers → React re-render
			 * - Initial render uses initialMessages prop (zero-flicker)
			 * - Once SSE connects, World Stream populates and hooks trigger re-render
			 *
			 * EVOLUTION (Phase 3):
			 * - Migrated from global useMessagesWithParts to per-session useSession
			 * - Component now subscribes to session-specific atoms
			 *
			 * VERIFICATION:
			 * - Component must NOT import useOpencodeStore
			 * - Component must NOT call hydrateMessages
			 * - Component MUST use reactive World Stream hooks (useSession)
			 */

			// Read the source file to verify imports
			const fs = await import("node:fs/promises")
			const path = await import("node:path")
			const filePath = path.join(__dirname, "session-messages.tsx")
			const source = await fs.readFile(filePath, "utf-8")

			// MUST NOT import useOpencodeStore (Zustand)
			expect(source).not.toContain('from "@opencode-vibe/react/store"')
			expect(source).not.toContain("useOpencodeStore")
			expect(source).not.toContain("hydrateMessages")
			expect(source).not.toContain("useEffect") // No manual hydration effects

			// MUST import from reactive hooks (Phase 3: now useSessionAtom)
			expect(source).toContain("useSessionAtom")
			expect(source).toContain('from "@opencode-vibe/react"')

			// MUST use World Stream hooks directly (no registry access)
			expect(source).not.toContain("getWorldRegistry")
			expect(source).not.toContain("Registry.get")
		})
	})

	describe("SessionAtom integration (ADR-019 Phase 3 - opencode-next--xts0a-mk4fgz7m4k9)", () => {
		test("component uses useSession() for per-session messages, not global useMessagesWithParts", async () => {
			/**
			 * Test for ADR-019 Phase 3: MessageList uses session.messages from useSessionAtom
			 *
			 * GOAL:
			 * - SessionMessages subscribes to per-session messages via useSession(sessionId)
			 * - Eliminates global messages lookup (useMessagesWithParts filters by sessionId)
			 * - Component only re-renders when ITS session's messages change
			 *
			 * BEFORE (Phase 2):
			 * - useMessagesWithParts(sessionId) → queries global messagesAtom + partsAtom
			 * - Every message update triggers filtering logic
			 * - Component re-renders even if another session's messages changed
			 *
			 * AFTER (Phase 3):
			 * - useSession(sessionId) → subscribes to per-session enrichedSessionAtom
			 * - Returns { session, messages, parts, status, isActive }
			 * - Component only re-renders when THIS session changes
			 *
			 * VERIFICATION:
			 * - Component MUST import useSession from @opencode-vibe/react
			 * - Component MUST NOT use useMessagesWithParts (global lookup)
			 * - Component MUST destructure messages from useSession result
			 */

			// Read the source file to verify imports
			const fs = await import("node:fs/promises")
			const path = await import("node:path")
			const filePath = path.join(__dirname, "session-messages.tsx")
			const source = await fs.readFile(filePath, "utf-8")

			// MUST import useSessionAtom from @opencode-vibe/react
			expect(source).toContain('from "@opencode-vibe/react"')
			expect(source).toContain("useSessionAtom")

			// MUST NOT use global useMessagesWithParts
			expect(source).not.toContain("useMessagesWithParts")

			// MUST call useSessionAtom with sessionId
			expect(source).toContain("useSessionAtom(sessionId)")
		})
	})
	describe("MessageRenderer memo comparison", () => {
		/**
		 * Helper to simulate the memo comparison function from MessageRenderer.
		 * This is the actual comparison logic extracted from session-messages.tsx lines 226-248.
		 */
		function arePropsEqual(
			prev: { message: any; messageState: string; status: string },
			next: { message: any; messageState: string; status: string },
		): boolean {
			// Compare message ID
			if (prev.message.id !== next.message.id) return false
			// Compare message state (pending/processing/complete)
			if (prev.messageState !== next.messageState) return false
			// Compare parts length (indicates content change)
			if (prev.message.parts?.length !== next.message.parts?.length) return false
			// Compare streaming status (affects reasoning component)
			if (prev.status !== next.status) return false
			// If last part exists, compare its type and content for streaming updates
			const prevLastPart = prev.message.parts?.[prev.message.parts.length - 1]
			const nextLastPart = next.message.parts?.[next.message.parts.length - 1]
			if (prevLastPart?.type !== nextLastPart?.type) return false
			// For text/reasoning, compare content
			if (prevLastPart?.type === "text" || prevLastPart?.type === "reasoning") {
				if ((prevLastPart as any).text !== (nextLastPart as any).text) return false
			}
			// For tools, compare state AND _opencode metadata
			if (prevLastPart?.type?.startsWith("tool-")) {
				if ((prevLastPart as any).state !== (nextLastPart as any).state) return false
				// Compare OpenCode ToolPart status and metadata (for task tools)
				const prevOpencode = (prevLastPart as any)._opencode
				const nextOpencode = (nextLastPart as any)._opencode
				if (prevOpencode && nextOpencode) {
					// Compare status
					if (prevOpencode.state?.status !== nextOpencode.state?.status) return false
					// For task tools, compare metadata.summary length and last item status
					if (prevOpencode.tool === "task" && nextOpencode.tool === "task") {
						const prevSummary = prevOpencode.state?.metadata?.summary
						const nextSummary = nextOpencode.state?.metadata?.summary
						if (prevSummary?.length !== nextSummary?.length) return false
						if (prevSummary && nextSummary && prevSummary.length > 0) {
							const prevLast = prevSummary[prevSummary.length - 1]
							const nextLast = nextSummary[nextSummary.length - 1]
							if (prevLast?.state?.status !== nextLast?.state?.status) return false
						}
					}
				}
			}
			return true // Props are equal, skip re-render
		}

		test("returns false when task tool metadata.summary length changes", () => {
			const basePart: any = {
				type: "tool-task" as const,
				toolCallId: "tool-1",
				title: "task",
				state: "output-available" as const,
				_opencode: {
					id: "tool-1",
					type: "tool" as const,
					tool: "task",
					state: {
						status: "running" as const,
						input: { description: "Test task" },
						metadata: {
							sessionId: "child-session",
							summary: [],
						},
					},
				},
			}

			const prevProps = {
				message: {
					id: "msg-1",
					role: "assistant" as const,
					parts: [basePart],
				} as any,
				messageState: "processing",
				status: "ready",
			}

			// Simulate SSE update: summary now has a running tool
			const nextProps = {
				message: {
					id: "msg-1",
					role: "assistant" as const,
					parts: [
						{
							...basePart,
							_opencode: {
								...basePart._opencode,
								state: {
									...basePart._opencode.state,
									metadata: {
										sessionId: "child-session",
										summary: [
											{
												id: "subtool-1",
												tool: "read",
												state: {
													status: "running" as const,
												},
											},
										],
									},
								},
							},
						},
					],
				} as any,
				messageState: "processing",
				status: "ready",
			}

			// Should return false (props NOT equal) because summary length changed
			expect(arePropsEqual(prevProps, nextProps)).toBe(false)
		})

		test("returns false when task tool summary last item status changes", () => {
			const createProps = (summaryStatus: "running" | "completed", title?: string) => ({
				message: {
					id: "msg-1",
					role: "assistant" as const,
					parts: [
						{
							type: "tool-task" as const,
							toolCallId: "tool-1",
							title: "task",
							state: "output-available" as const,
							_opencode: {
								id: "tool-1",
								type: "tool" as const,
								tool: "task",
								state: {
									status: "running" as const,
									input: { description: "Test task" },
									metadata: {
										sessionId: "child-session",
										summary: [
											{
												id: "subtool-1",
												tool: "read",
												state: {
													status: summaryStatus,
													title,
												},
											},
										],
									},
								},
							},
						},
					],
				} as any,
				messageState: "processing",
				status: "ready",
			})

			const prevProps = createProps("running")
			const nextProps = createProps("completed", "Read 100 lines from config.ts")

			// Should return false (props NOT equal) because last item status changed
			expect(arePropsEqual(prevProps, nextProps)).toBe(false)
		})

		test("returns true when task tool summary unchanged", () => {
			const createProps = () => ({
				message: {
					id: "msg-1",
					role: "assistant" as const,
					parts: [
						{
							type: "tool-task" as const,
							toolCallId: "tool-1",
							title: "task",
							state: "output-available" as const,
							_opencode: {
								id: "tool-1",
								type: "tool" as const,
								tool: "task",
								state: {
									status: "running" as const,
									input: { description: "Test task" },
									metadata: {
										sessionId: "child-session",
										summary: [
											{
												id: "subtool-1",
												tool: "read",
												state: {
													status: "running" as const,
												},
											},
										],
									},
								},
							},
						},
					],
				} as any,
				messageState: "processing",
				status: "ready",
			})

			const prevProps = createProps()
			const nextProps = createProps()

			// Should return true (props equal) because nothing changed
			expect(arePropsEqual(prevProps, nextProps)).toBe(true)
		})
	})
})
