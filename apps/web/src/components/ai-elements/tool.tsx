"use client"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { ToolUIPart } from "ai"
import type { ToolPart } from "@opencode-ai/sdk/client"
import { motion, AnimatePresence } from "framer-motion"
import {
	CheckCircleIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	WrenchIcon,
	XCircleIcon,
} from "lucide-react"
import React, { type ComponentProps, type ReactNode } from "react"
import { useState, isValidElement } from "react"
import { CodeBlock } from "./code-block"
import { SubagentCurrentActivity } from "./task"
import { SubagentView } from "./subagent-view"
import { useSubagent } from "@opencode-vibe/react"

/**
 * Extract contextual information from tool inputs and state for display in 3-line card.
 *
 * Returns:
 * - primary: Main context (e.g., file path, pattern, command)
 * - secondary: Supporting context (e.g., line count, match count, exit code)
 *
 * Tool-specific extraction logic based on SHARED_CONTEXT spec.
 */
export function getToolContextLines(part: ToolPart): {
	primary: string | null
	secondary: string | null
} {
	const { tool, state } = part
	const input = "input" in state ? state.input : {}
	const title = "title" in state ? state.title : undefined

	switch (tool) {
		case "read": {
			const filePath = typeof input.filePath === "string" ? input.filePath : null
			return {
				primary: filePath,
				secondary: title ?? null,
			}
		}

		case "edit": {
			const filePath = typeof input.filePath === "string" ? input.filePath : null
			let changeCount: string | null = null

			if (title) {
				// Extract number from "Edited 3 occurrences" or "Edited 1 file"
				const match = title.match(/(\d+)/)
				if (match && match[1]) {
					const count = Number.parseInt(match[1], 10)
					changeCount = count === 1 ? "1 change" : `${count} changes`
				}
			}

			return {
				primary: filePath,
				secondary: changeCount,
			}
		}

		case "write": {
			const filePath = typeof input.filePath === "string" ? input.filePath : null
			let sizeOrStatus: string | null = null

			if (title?.toLowerCase().includes("created")) {
				sizeOrStatus = "New file"
			} else if (typeof input.content === "string" && input.content.length > 0) {
				const bytes = input.content.length
				sizeOrStatus = bytes >= 1000 ? `${(bytes / 1000).toFixed(1)} KB` : `${bytes} B`
			}

			return {
				primary: filePath,
				secondary: sizeOrStatus,
			}
		}

		case "grep": {
			const pattern = typeof input.pattern === "string" ? input.pattern : ""
			const path = typeof input.path === "string" ? input.path : "."
			const primary = pattern ? `${pattern} in ${path}` : null

			let matchCount: string | null = null
			if (title) {
				// Extract "5 matches" from "5 matches found" or "No matches"
				if (title.toLowerCase().includes("no matches")) {
					matchCount = "No matches"
				} else {
					const match = title.match(/(\d+)/)
					if (match && match[1]) {
						const count = Number.parseInt(match[1], 10)
						matchCount = count === 1 ? "1 match" : `${count} matches`
					}
				}
			}

			return {
				primary,
				secondary: matchCount,
			}
		}

		case "glob": {
			const pattern = typeof input.pattern === "string" ? input.pattern : null
			let fileCount: string | null = null

			if (title) {
				const match = title.match(/(\d+)/)
				if (match && match[1]) {
					const count = Number.parseInt(match[1], 10)
					fileCount = count === 1 ? "1 file" : `${count} files`
				}
			}

			return {
				primary: pattern,
				secondary: fileCount,
			}
		}

		case "bash": {
			const command = typeof input.command === "string" ? input.command : null
			const truncated = command && command.length > 50 ? `${command.slice(0, 47)}...` : command

			return {
				primary: truncated,
				secondary: title ?? null,
			}
		}

		case "task": {
			const description = typeof input.description === "string" ? input.description : null

			return {
				primary: description,
				secondary: null, // SubagentCurrentActivity handles this
			}
		}

		default: {
			// Unknown tool - return null for primary to avoid redundant display
			// (tool name is already shown in line 1)
			return {
				primary: null,
				secondary: null,
			}
		}
	}
}

export type ToolProps = ComponentProps<typeof Collapsible> & {
	/**
	 * Optional OpenCode ToolPart for enhanced 3-line card display.
	 * If provided, renders ToolCard instead of basic collapsible.
	 */
	toolPart?: ToolPart
}

const ToolComponent = ({ className, toolPart, children, ...props }: ToolProps) => {
	// If toolPart provided, use enhanced ToolCard rendering
	if (toolPart) {
		return <ToolCard toolPart={toolPart} className={className} {...props} />
	}

	// Fallback to basic collapsible for AI SDK tools
	return (
		<Collapsible
			className={cn("not-prose w-full rounded-md border-[0.5px] border-surface1", className)}
			{...props}
		>
			{children}
		</Collapsible>
	)
}

/**
 * Memoized Tool component with content-aware comparison.
 *
 * Problem: Immer creates new object references on every store update,
 * breaking React.memo shallow comparison even when content is identical.
 *
 * Solution: Compare id and status only. Avoid JSON.stringify which can
 * hang on large outputs (bash commands, file reads) or circular references.
 * The id+status check is sufficient because:
 * - Same id = same tool invocation
 * - Status change = meaningful update (pending→running→completed)
 * - Input/output don't change for a given tool invocation
 */
export const Tool = React.memo(ToolComponent, (prev, next) => {
	// Compare toolPart if provided (OpenCode tools)
	if (prev.toolPart && next.toolPart) {
		// Same id + same status = no meaningful change
		// Input/output are immutable for a given tool invocation
		return (
			prev.toolPart.id === next.toolPart.id &&
			prev.toolPart.state.status === next.toolPart.state.status
		)
	}

	// One has toolPart, other doesn't - not equal
	if (prev.toolPart !== next.toolPart) return false

	// AI SDK tools - compare children
	return prev.children === next.children
})

/**
 * Check if a tool state has expandable content (output or error).
 * Only show expand chevron when there's meaningful content to display.
 */
export function hasExpandableContent(state: ToolPart["state"]): boolean {
	if (state.status === "completed" && "output" in state && state.output) return true
	if (state.status === "error" && "error" in state) return true
	return false
}

/**
 * Get status icon for OpenCode ToolPart state
 */
function getStatusIcon(state: ToolPart["state"]): ReactNode {
	switch (state.status) {
		case "pending":
			return <CircleIcon className="size-4 text-muted-foreground" />
		case "running":
			return <ClockIcon className="size-4 animate-spin text-muted-foreground" />
		case "completed":
			return <CheckCircleIcon className="size-4 text-green-600" />
		case "error":
			return <XCircleIcon className="size-4 text-red-600" />
	}
}

/**
 * Enhanced 3-line tool card for OpenCode ToolPart display.
 *
 * Structure:
 * Line 1: icon + tool name + status icon
 * Line 2: primary context (extracted from input)
 * Line 3: secondary context + expand chevron
 */
type ToolCardProps = ComponentProps<typeof Collapsible> & {
	toolPart: ToolPart
}

/**
 * Task tool card with subagent view integration.
 * Uses useSubagent hook to get child session data and renders SubagentView when expanded.
 */
const TaskToolCard = ({ toolPart, className, ...props }: ToolCardProps) => {
	const { state } = toolPart
	const { primary } = getToolContextLines(toolPart)
	const { subagent, isExpanded, toggleExpanded, hasSubagent, isRunning } = useSubagent({
		partId: toolPart.id,
	})

	// Task tools are always expandable if they have a subagent
	const canExpand = hasSubagent || hasExpandableContent(state)

	return (
		<div className={cn("not-prose w-full rounded-md border-[0.5px] border-surface1", className)}>
			{/* Header - clickable to expand */}
			<button
				type="button"
				onClick={toggleExpanded}
				className="flex w-full flex-col gap-1 p-3 text-left hover:bg-muted/50 transition-colors"
			>
				{/* Line 1: Tool name + status */}
				<div className="flex w-full items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="font-medium text-sm capitalize truncate">task</span>
					</div>
					<motion.div
						key={state.status}
						initial={{ scale: 0.9, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="flex items-center gap-2 shrink-0"
					>
						{getStatusIcon(state)}
					</motion.div>
				</div>

				{/* Line 2: Primary context (description) */}
				{primary && (
					<div className="text-foreground text-sm truncate pl-6" title={primary}>
						{primary}
					</div>
				)}

				{/* Line 3: Current activity + chevron */}
				<div className="flex items-center justify-between gap-2 pl-6">
					<SubagentCurrentActivity part={toolPart} className="flex-1 min-w-0" />
					{canExpand && (
						<motion.div
							animate={{ rotate: isExpanded ? 180 : 0 }}
							transition={{ duration: 0.15, ease: "easeOut" }}
						>
							<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
						</motion.div>
					)}
				</div>
			</button>

			{/* Expanded content - SubagentView with full child session */}
			<AnimatePresence>
				{isExpanded && subagent && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						style={{ overflow: "hidden" }}
					>
						<SubagentView subagent={subagent} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}

const ToolCardComponent = ({ toolPart, className, ...props }: ToolCardProps) => {
	const { tool, state } = toolPart
	const { primary, secondary } = getToolContextLines(toolPart)
	const output = "output" in state ? state.output : undefined
	const error = "error" in state ? state.error : undefined
	const canExpand = hasExpandableContent(state)
	const [isOpen, setIsOpen] = useState(false)

	// Task tools get special handling with SubagentView
	if (tool === "task") {
		return <TaskToolCard toolPart={toolPart} className={className} {...props} />
	}

	// If no expandable content, render as static card
	if (!canExpand) {
		return (
			<div className={cn("not-prose w-full rounded-md border-[0.5px] border-surface1", className)}>
				<div className="flex w-full flex-col gap-1 p-3">
					{/* Line 1: Tool name + status */}
					<div className="flex w-full items-center justify-between gap-2">
						<div className="flex items-center gap-2 min-w-0 flex-1">
							<WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
							<span className="font-medium text-sm capitalize truncate">{tool}</span>
						</div>
						<motion.div
							key={state.status}
							initial={{ scale: 0.9, opacity: 0 }}
							animate={{ scale: 1, opacity: 1 }}
							transition={{ duration: 0.15, ease: "easeOut" }}
							className="flex items-center gap-2 shrink-0"
						>
							{getStatusIcon(state)}
						</motion.div>
					</div>

					{/* Line 2: Primary context */}
					{primary && (
						<div className="text-foreground text-sm truncate pl-6" title={primary}>
							{primary}
						</div>
					)}

					{/* Line 3: Secondary context (no chevron) */}
					<div className="flex items-center justify-between gap-2 pl-6">
						<span className="text-muted-foreground text-xs truncate">{secondary || "\u00A0"}</span>
					</div>
				</div>
			</div>
		)
	}

	// Expandable card with Collapsible
	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className={cn("not-prose w-full rounded-md border-[0.5px] border-surface1", className)}
			{...props}
		>
			<CollapsibleTrigger className="flex w-full flex-col gap-1 p-3 text-left hover:bg-muted/50 transition-colors">
				{/* Line 1: Tool name + status */}
				<div className="flex w-full items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="font-medium text-sm capitalize truncate">{tool}</span>
					</div>
					<motion.div
						key={state.status}
						initial={{ scale: 0.9, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="flex items-center gap-2 shrink-0"
					>
						{getStatusIcon(state)}
					</motion.div>
				</div>

				{/* Line 2: Primary context */}
				{primary && (
					<div className="text-foreground text-sm truncate pl-6" title={primary}>
						{primary}
					</div>
				)}

				{/* Line 3: Secondary context + chevron */}
				<div className="flex items-center justify-between gap-2 pl-6">
					<span className="text-muted-foreground text-xs truncate">{secondary || "\u00A0"}</span>
					<motion.div
						animate={{ rotate: isOpen ? 180 : 0 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
					>
						<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
					</motion.div>
				</div>
			</CollapsibleTrigger>

			{/* Expanded content with Framer Motion */}
			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						style={{ overflow: "hidden" }}
					>
						<div className="border-t border-surface1 p-4 space-y-4">
							{/* Input */}
							{"input" in state && (
								<div className="space-y-2">
									<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
										Parameters
									</h4>
									<div className="rounded-md bg-muted/50">
										<CodeBlock code={JSON.stringify(state.input, null, 2)} language="json" />
									</div>
								</div>
							)}

							{/* Output or Error */}
							{(output || error) && (
								<div className="space-y-2">
									<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
										{error ? "Error" : "Result"}
									</h4>
									<div
										className={cn(
											"overflow-x-auto rounded-md text-xs",
											error ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-foreground",
										)}
									>
										{/* Use pre for raw output since we don't know the language */}
										<pre className="p-2 overflow-x-auto text-xs whitespace-pre-wrap">
											{error || output}
										</pre>
									</div>
								</div>
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</Collapsible>
	)
}

/**
 * Memoized ToolCard with content-aware comparison.
 *
 * Problem: Immer creates new object references on every store update,
 * breaking React.memo shallow comparison even when content is identical.
 *
 * Solution: Deep compare actual content (id, status, summary) instead
 * of reference equality to prevent unnecessary Framer Motion re-animations.
 */
const ToolCard = React.memo(ToolCardComponent, (prev, next) => {
	// Compare actual content, not Immer references
	if (prev.toolPart.id !== next.toolPart.id) return false
	if (prev.toolPart.state.status !== next.toolPart.state.status) return false
	if (prev.className !== next.className) return false

	// Safe to access metadata only when not pending
	if (prev.toolPart.state.status !== "pending" && next.toolPart.state.status !== "pending") {
		const prevSummary = (prev.toolPart.state as any).metadata?.summary
		const nextSummary = (next.toolPart.state as any).metadata?.summary
		if (prevSummary !== nextSummary) return false
	}

	return true
})

export type ToolHeaderProps = {
	title?: string
	type: ToolUIPart["type"]
	state?: ToolUIPart["state"]
	className?: string
}

const getStatusBadge = (status: ToolUIPart["state"]) => {
	const labels: Record<ToolUIPart["state"], string> = {
		"input-streaming": "Pending",
		"input-available": "Running",
		"approval-requested": "Awaiting Approval",
		"approval-responded": "Responded",
		"output-available": "Completed",
		"output-error": "Error",
		"output-denied": "Denied",
	}

	const icons: Record<ToolUIPart["state"], ReactNode> = {
		"input-streaming": <CircleIcon className="size-4" />,
		"input-available": <ClockIcon className="size-4 animate-pulse" />,
		"approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
		"approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
		"output-available": <CheckCircleIcon className="size-4 text-green-600" />,
		"output-error": <XCircleIcon className="size-4 text-red-600" />,
		"output-denied": <XCircleIcon className="size-4 text-orange-600" />,
	}

	return (
		<Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
			{icons[status]}
			{labels[status]}
		</Badge>
	)
}

export const ToolHeader = ({ className, title, type, state, ...props }: ToolHeaderProps) => (
	<CollapsibleTrigger
		className={cn("flex w-full items-center justify-between gap-4 p-3", className)}
		{...props}
	>
		<div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1">
			<WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
			<span className="truncate font-medium text-sm min-w-0">
				{title ?? type.split("-").slice(1).join("-")}
			</span>
		</div>
		<div className="flex items-center gap-2 shrink-0">
			{state && getStatusBadge(state)}
			<ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
		</div>
	</CollapsibleTrigger>
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
)

export type ToolInputProps = ComponentProps<"div"> & {
	input: ToolUIPart["input"]
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
	<div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
		<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
			Parameters
		</h4>
		<div className="rounded-md bg-muted/50">
			<CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
		</div>
	</div>
)

export type ToolOutputProps = ComponentProps<"div"> & {
	output: ToolUIPart["output"]
	errorText: ToolUIPart["errorText"]
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
	if (!(output || errorText)) {
		return null
	}

	// Determine how to render output based on type
	// IMPORTANT: Don't render raw output as ReactNode - it may contain strings
	// that look like HTML tags (e.g., "array<decisiontrace") which breaks React
	const renderOutput = () => {
		if (output === undefined || output === null) {
			return null
		}

		// Already a React element - render as-is
		if (isValidElement(output)) {
			return output
		}

		// String - render in CodeBlock (safe, escapes HTML)
		if (typeof output === "string") {
			return <CodeBlock code={output} language="json" />
		}

		// Object/Array - JSON stringify into CodeBlock (safe)
		if (typeof output === "object") {
			return <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
		}

		// Primitive (number, boolean) - convert to string safely
		return <CodeBlock code={String(output)} language="json" />
	}

	return (
		<div className={cn("space-y-2 p-4", className)} {...props}>
			<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{errorText ? "Error" : "Result"}
			</h4>
			<div
				className={cn(
					"overflow-x-auto rounded-md text-xs [&_table]:w-full",
					errorText ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-foreground",
				)}
			>
				{errorText && <div>{errorText}</div>}
				{renderOutput()}
			</div>
		</div>
	)
}
