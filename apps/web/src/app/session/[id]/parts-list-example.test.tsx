/**
 * PartsListExample Tests - ADR-019 Phase 3 Integration Test
 *
 * Demonstrates that PartRenderer works correctly with useSessionParts.
 * This is the pattern for Task 3.3: "Update PartRenderer to use session.parts from useSessionAtom"
 *
 * KEY INSIGHT:
 * - useSessionParts(sessionId) provides session-scoped Part[] array
 * - PartRenderer is a pure component taking single Part prop
 * - Component only re-renders when its session's parts change (not when other sessions update)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { PartsListExample } from "./parts-list-example"
import type { Part } from "@opencode-ai/sdk"

// Mock useSessionParts hook
vi.mock("@opencode-vibe/react", () => ({
	useSessionParts: vi.fn(),
}))

// Mock PartRenderer component (since it's already tested separately)
vi.mock("@/components/ai-elements/part-renderer", () => ({
	PartRenderer: ({ part }: { part: Part }) => (
		<div data-testid={`part-${part.id}`} data-type={part.type}>
			{part.type === "text" && part.text}
			{part.type === "tool" && `Tool: ${(part as any).tool || "unknown"}`}
		</div>
	),
}))

const useSessionParts = vi.mocked(
	await import("@opencode-vibe/react").then((m) => m.useSessionParts),
)

describe("PartsListExample - ADR-019 Phase 3 Pattern", () => {
	const mockTextPart: Part = {
		id: "part-1",
		sessionID: "session-1",
		messageID: "msg-1",
		type: "text",
		text: "Hello world",
		time: { start: Date.now() },
	}

	const mockToolPart: Part = {
		id: "part-2",
		sessionID: "session-1",
		messageID: "msg-1",
		type: "tool",
		tool: "bash",
		name: "bash",
		input: { command: "ls" },
		time: { start: Date.now() },
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders parts from useSessionParts", () => {
		useSessionParts.mockReturnValue([mockTextPart, mockToolPart])

		render(<PartsListExample sessionId="session-1" />)

		// Verify both parts are rendered
		expect(screen.getByTestId("part-part-1")).toBeInTheDocument()
		expect(screen.getByTestId("part-part-2")).toBeInTheDocument()

		// Verify content
		expect(screen.getByText("Hello world")).toBeInTheDocument()
		expect(screen.getByText("Tool: bash")).toBeInTheDocument()
	})

	it("renders empty state when no parts", () => {
		useSessionParts.mockReturnValue([])

		render(<PartsListExample sessionId="session-1" />)

		expect(screen.getByText("No parts yet")).toBeInTheDocument()
	})

	it("subscribes to correct session via useSessionParts", () => {
		useSessionParts.mockReturnValue([])

		render(<PartsListExample sessionId="test-session-123" />)

		// Verify useSessionParts was called with correct session ID
		expect(useSessionParts).toHaveBeenCalledWith("test-session-123")
	})

	it("renders parts with stable keys based on part.id", () => {
		useSessionParts.mockReturnValue([mockTextPart, mockToolPart])

		const { container } = render(<PartsListExample sessionId="session-1" />)

		// Verify keys are present and based on part.id
		const parts = container.querySelectorAll("[data-testid^='part-']")
		expect(parts).toHaveLength(2)
		expect(parts[0].getAttribute("data-testid")).toBe("part-part-1")
		expect(parts[1].getAttribute("data-testid")).toBe("part-part-2")
	})

	// ADR-019 Phase 3 Goal: Demonstrate granular subscription
	it("PATTERN: useSessionParts provides session-scoped parts array", () => {
		useSessionParts.mockReturnValue([mockTextPart])

		render(<PartsListExample sessionId="session-1" />)

		// This component subscribes ONLY to session-1's parts
		// When session-2 updates, this component does NOT re-render
		// This is the key insight of ADR-019 Phase 3: granular subscriptions

		expect(useSessionParts).toHaveBeenCalledTimes(1)
		expect(useSessionParts).toHaveBeenCalledWith("session-1")
	})
})
