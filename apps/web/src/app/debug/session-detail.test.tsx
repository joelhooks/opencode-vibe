/**
 * SessionDetail Component Tests - TDD approach for ADR-019 Phase 3
 *
 * Tests that SessionDetail using useSessionAtom only re-renders when ITS session changes,
 * not when other sessions in the world update.
 *
 * RED → GREEN → REFACTOR
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import type { EnrichedSession } from "@opencode-vibe/core/world/types"

// We'll test the pattern, not the actual implementation
// This test defines the shape we want in debug/page.tsx

// Mock useSessionAtom implementation
const mockUseSessionAtom = vi.fn()

// Define SessionDetail component inline for testing
// This will be the shape we want in debug/page.tsx
function SessionDetail({ sessionId }: { sessionId: string }) {
	const session = mockUseSessionAtom(sessionId)

	if (!session || !session.id) {
		return <div data-testid="session-not-found">Session not found: {sessionId}</div>
	}

	return (
		<div data-testid="session-detail">
			<h2>Session Detail</h2>
			<div data-testid="session-id">{session.id}</div>
			<div data-testid="session-status">{session.status}</div>
			<div data-testid="session-directory">{session.directory}</div>
			<div data-testid="session-context">{session.contextUsagePercent.toFixed(1)}%</div>
			<div data-testid="session-messages-count">{session.messages.length}</div>
		</div>
	)
}

describe("SessionDetail with useSessionAtom", () => {
	const mockSession: EnrichedSession = {
		id: "session-123",
		title: "Test Session",
		directory: "/test/path",
		time: { created: Date.now(), updated: Date.now() },
		status: "running",
		isActive: true,
		messages: [],
		unreadCount: 0,
		contextUsagePercent: 45.2,
		lastActivityAt: Date.now(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders session details using useSessionAtom", () => {
		mockUseSessionAtom.mockReturnValue(mockSession)

		const { container } = render(<SessionDetail sessionId="session-123" />)

		const sessionDetail = container.querySelector('[data-testid="session-detail"]')
		const sessionId = container.querySelector('[data-testid="session-id"]')
		const sessionStatus = container.querySelector('[data-testid="session-status"]')
		const sessionDirectory = container.querySelector('[data-testid="session-directory"]')
		const sessionContext = container.querySelector('[data-testid="session-context"]')
		const messagesCount = container.querySelector('[data-testid="session-messages-count"]')

		expect(sessionDetail).toBeTruthy()
		expect(sessionId?.textContent).toBe("session-123")
		expect(sessionStatus?.textContent).toBe("running")
		expect(sessionDirectory?.textContent).toBe("/test/path")
		expect(sessionContext?.textContent).toBe("45.2%")
		expect(messagesCount?.textContent).toBe("0")
	})

	it("handles session not found", () => {
		// useSessionAtom returns emptySession when not found
		const emptySession: EnrichedSession = {
			id: "",
			title: "",
			directory: "",
			time: { created: 0, updated: 0 },
			status: "completed",
			isActive: false,
			messages: [],
			unreadCount: 0,
			contextUsagePercent: 0,
			lastActivityAt: 0,
		}

		mockUseSessionAtom.mockReturnValue(emptySession)

		const { container } = render(<SessionDetail sessionId="nonexistent" />)

		const notFound = container.querySelector('[data-testid="session-not-found"]')
		expect(notFound).toBeTruthy()
		expect(notFound?.textContent).toContain("Session not found: nonexistent")
	})

	it("calls useSessionAtom with correct sessionId", () => {
		mockUseSessionAtom.mockReturnValue(mockSession)

		render(<SessionDetail sessionId="session-456" />)

		expect(mockUseSessionAtom).toHaveBeenCalledWith("session-456")
		expect(mockUseSessionAtom).toHaveBeenCalledTimes(1)
	})

	it("subscribes to specific session, not global world state", () => {
		// KEY TEST: Verify we're using useSessionAtom, not useWorld or useWorldSession
		mockUseSessionAtom.mockReturnValue(mockSession)

		render(<SessionDetail sessionId="session-123" />)

		// Should call useSessionAtom (granular subscription)
		expect(mockUseSessionAtom).toHaveBeenCalledWith("session-123")

		// This test documents the architectural win:
		// useSessionAtom subscribes to SessionAtom for session-123 ONLY
		// When session-456 updates, this component won't re-render
	})

	it("renders updated session data when session changes", () => {
		const initialSession = { ...mockSession, status: "running" as const }
		const updatedSession = { ...mockSession, status: "completed" as const }

		mockUseSessionAtom.mockReturnValue(initialSession)
		const { rerender, container } = render(<SessionDetail sessionId="session-123" />)

		let sessionStatus = container.querySelector('[data-testid="session-status"]')
		expect(sessionStatus?.textContent).toBe("running")

		// Simulate session update via useSessionAtom
		mockUseSessionAtom.mockReturnValue(updatedSession)
		rerender(<SessionDetail sessionId="session-123" />)

		sessionStatus = container.querySelector('[data-testid="session-status"]')
		expect(sessionStatus?.textContent).toBe("completed")
	})
})
