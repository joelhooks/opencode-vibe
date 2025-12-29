"use client"

import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { FileUIPart, UIMessage } from "ai"
import { ChevronLeftIcon, ChevronRightIcon, PaperclipIcon, XIcon } from "lucide-react"
import type { ComponentProps, HTMLAttributes, ReactElement } from "react"
import React, { createContext, memo, useContext, useEffect, useState } from "react"
import { Streamdown, StreamdownContext } from "streamdown"
import type { Root, Element } from "hast"
import { visit } from "unist-util-visit"

/**
 * Valid HTML element names - anything else gets converted to span
 */
const VALID_HTML_ELEMENTS = new Set([
	"a",
	"abbr",
	"address",
	"area",
	"article",
	"aside",
	"audio",
	"b",
	"base",
	"bdi",
	"bdo",
	"blockquote",
	"body",
	"br",
	"button",
	"canvas",
	"caption",
	"cite",
	"code",
	"col",
	"colgroup",
	"data",
	"datalist",
	"dd",
	"del",
	"details",
	"dfn",
	"dialog",
	"div",
	"dl",
	"dt",
	"em",
	"embed",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hgroup",
	"hr",
	"html",
	"i",
	"iframe",
	"img",
	"input",
	"ins",
	"kbd",
	"label",
	"legend",
	"li",
	"link",
	"main",
	"map",
	"mark",
	"math",
	"menu",
	"meta",
	"meter",
	"nav",
	"noscript",
	"object",
	"ol",
	"optgroup",
	"option",
	"output",
	"p",
	"param",
	"picture",
	"pre",
	"progress",
	"q",
	"rp",
	"rt",
	"ruby",
	"s",
	"samp",
	"script",
	"search",
	"section",
	"select",
	"slot",
	"small",
	"source",
	"span",
	"strong",
	"style",
	"sub",
	"summary",
	"sup",
	"svg",
	"table",
	"tbody",
	"td",
	"template",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"time",
	"title",
	"tr",
	"track",
	"u",
	"ul",
	"var",
	"video",
	"wbr",
])

/**
 * Rehype plugin that converts unknown HTML tags to spans.
 * This prevents React errors from tags like <thematic>, <package>, <array<T>>, etc.
 * that appear in AI-generated markdown content.
 */
function rehypeSanitizeUnknownTags() {
	return (tree: Root) => {
		visit(tree, "element", (node: Element) => {
			const tagName = node.tagName.toLowerCase()
			if (!VALID_HTML_ELEMENTS.has(tagName)) {
				// Convert unknown tag to span, preserve children
				node.tagName = "span"
				node.properties = {
					...node.properties,
					"data-original-tag": tagName,
				}
			}
		})
	}
}

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: UIMessage["role"]
}

const MessageComponent = ({ className, from, ...props }: MessageProps) => (
	<div
		className={cn(
			"group flex w-full max-w-[95%] flex-col gap-2",
			from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
			className,
		)}
		{...props}
	/>
)

/**
 * Memoized Message component with content-aware comparison.
 *
 * Problem: Immer creates new object references on every store update,
 * breaking React.memo shallow comparison even when content is identical.
 *
 * Solution: Compare actual content (from, children) instead of references.
 */
export const Message = React.memo(MessageComponent, (prev, next) => {
	return prev.from === next.from && prev.children === next.children
})

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
	<div
		className={cn(
			"is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
			"group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
			"group-[.is-assistant]:text-foreground",
			className,
		)}
		{...props}
	>
		{children}
	</div>
)

export type MessageActionsProps = ComponentProps<"div">

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
	<div className={cn("flex items-center gap-1", className)} {...props}>
		{children}
	</div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
	tooltip?: string
	label?: string
}

export const MessageAction = ({
	tooltip,
	children,
	label,
	variant = "ghost",
	size = "icon",
	...props
}: MessageActionProps) => {
	const button = (
		<Button size={size} type="button" variant={variant} {...props}>
			{children}
			<span className="sr-only">{label || tooltip}</span>
		</Button>
	)

	if (tooltip) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>{button}</TooltipTrigger>
					<TooltipContent>
						<p>{tooltip}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	return button
}

type MessageBranchContextType = {
	currentBranch: number
	totalBranches: number
	goToPrevious: () => void
	goToNext: () => void
	branches: ReactElement[]
	setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(null)

const useMessageBranch = () => {
	const context = useContext(MessageBranchContext)

	if (!context) {
		throw new Error("MessageBranch components must be used within MessageBranch")
	}

	return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
	defaultBranch?: number
	onBranchChange?: (branchIndex: number) => void
}

export const MessageBranch = ({
	defaultBranch = 0,
	onBranchChange,
	className,
	...props
}: MessageBranchProps) => {
	const [currentBranch, setCurrentBranch] = useState(defaultBranch)
	const [branches, setBranches] = useState<ReactElement[]>([])

	const handleBranchChange = (newBranch: number) => {
		setCurrentBranch(newBranch)
		onBranchChange?.(newBranch)
	}

	const goToPrevious = () => {
		const newBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1
		handleBranchChange(newBranch)
	}

	const goToNext = () => {
		const newBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0
		handleBranchChange(newBranch)
	}

	const contextValue: MessageBranchContextType = {
		currentBranch,
		totalBranches: branches.length,
		goToPrevious,
		goToNext,
		branches,
		setBranches,
	}

	return (
		<MessageBranchContext.Provider value={contextValue}>
			<div className={cn("grid w-full gap-2 [&>div]:pb-0", className)} {...props} />
		</MessageBranchContext.Provider>
	)
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export const MessageBranchContent = ({ children, ...props }: MessageBranchContentProps) => {
	const { currentBranch, setBranches, branches } = useMessageBranch()
	const childrenArray = Array.isArray(children) ? children : [children]

	// Use useEffect to update branches when they change
	useEffect(() => {
		if (branches.length !== childrenArray.length) {
			setBranches(childrenArray)
		}
	}, [childrenArray, branches, setBranches])

	return childrenArray.map((branch, index) => (
		<div
			className={cn(
				"grid gap-2 overflow-hidden [&>div]:pb-0",
				index === currentBranch ? "block" : "hidden",
			)}
			key={branch?.key ?? `branch-${index}`}
			{...props}
		>
			{branch}
		</div>
	))
}

export type MessageBranchSelectorProps = HTMLAttributes<HTMLDivElement> & {
	from: UIMessage["role"]
}

export const MessageBranchSelector = ({
	className,
	from,
	...props
}: MessageBranchSelectorProps) => {
	const { totalBranches } = useMessageBranch()

	// Don't render if there's only one branch
	if (totalBranches <= 1) {
		return null
	}

	return (
		<ButtonGroup
			className="[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md"
			orientation="horizontal"
			{...props}
		/>
	)
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export const MessageBranchPrevious = ({ children, ...props }: MessageBranchPreviousProps) => {
	const { goToPrevious, totalBranches } = useMessageBranch()

	return (
		<Button
			aria-label="Previous branch"
			disabled={totalBranches <= 1}
			onClick={goToPrevious}
			size="icon"
			type="button"
			variant="ghost"
			{...props}
		>
			{children ?? <ChevronLeftIcon size={14} />}
		</Button>
	)
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export const MessageBranchNext = ({ children, className, ...props }: MessageBranchNextProps) => {
	const { goToNext, totalBranches } = useMessageBranch()

	return (
		<Button
			aria-label="Next branch"
			disabled={totalBranches <= 1}
			onClick={goToNext}
			size="icon"
			type="button"
			variant="ghost"
			{...props}
		>
			{children ?? <ChevronRightIcon size={14} />}
		</Button>
	)
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export const MessageBranchPage = ({ className, ...props }: MessageBranchPageProps) => {
	const { currentBranch, totalBranches } = useMessageBranch()

	return (
		<ButtonGroupText
			className={cn("border-none bg-transparent text-muted-foreground shadow-none", className)}
			{...props}
		>
			{currentBranch + 1} of {totalBranches}
		</ButtonGroupText>
	)
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

/**
 * Custom components to handle unknown/custom tags in markdown content.
 * These prevent React warnings about unrecognized DOM elements.
 *
 * The markdown content may contain:
 * - Custom component tags (codeblocktabs, conversation, preview, etc.)
 * - TypeScript-like syntax that gets parsed as tags (r, any, string, etc.)
 * - Block elements that need proper nesting (div, pre inside p)
 */
/**
 * List of valid HTML/DOM attributes to allow through.
 * Everything else gets filtered to prevent invalid DOM property warnings.
 */
const VALID_DOM_ATTRIBUTES = new Set([
	"className",
	"class",
	"id",
	"style",
	"data-tag",
	"aria-label",
	"aria-hidden",
	"title",
	"role",
	"tabIndex",
	"key",
])

/**
 * Tags that look like TypeScript syntax and should be rendered as fragments.
 * These are commonly parsed from code blocks containing generics like Map<string, any>.
 * We render them as fragments (just children) to avoid React warnings about unknown elements.
 */
const TYPESCRIPT_LIKE_TAGS = new Set([
	// Single letter generics
	"t",
	"k",
	"v",
	"r",
	"s",
	"u",
	"p",
	"e",
	// TypeScript keywords/types
	"any",
	"void",
	"unknown",
	"never",
	"null",
	"undefined",
	"string",
	"number",
	"boolean",
	"object",
	"symbol",
	"bigint",
	"function",
	"anonymous",
	// Common generic type names
	"promise",
	"array",
	"map",
	"set",
	"record",
	"partial",
	"required",
	"readonly",
	"pick",
	"omit",
	"exclude",
	"extract",
	"awaited",
	"returntype",
	"parameters",
	"instancetype",
	"thistype",
	// Tags with trailing punctuation (from malformed parsing)
	"string,",
	"number,",
	"boolean,",
	"any,",
	"void,",
	"unknown,",
])

/**
 * Set of valid HTML element names that should be rendered as-is.
 * Any tag NOT in this set will be treated as a passthrough (rendered as fragment).
 */
const VALID_HTML_TAGS = new Set([
	// Document structure
	"html",
	"head",
	"body",
	"main",
	"header",
	"footer",
	"nav",
	"aside",
	"section",
	"article",
	// Text content
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"div",
	"span",
	"pre",
	"code",
	"blockquote",
	"ul",
	"ol",
	"li",
	"dl",
	"dt",
	"dd",
	"figure",
	"figcaption",
	"hr",
	"br",
	"wbr",
	// Inline text
	"a",
	"em",
	"strong",
	"b",
	"i",
	"u",
	"s",
	"mark",
	"small",
	"sub",
	"sup",
	"q",
	"cite",
	"abbr",
	"time",
	"kbd",
	"samp",
	"var",
	"del",
	"ins",
	"dfn",
	"ruby",
	"rt",
	"rp",
	"bdi",
	"bdo",
	// Media
	"img",
	"picture",
	"source",
	"video",
	"audio",
	"track",
	"iframe",
	"embed",
	"object",
	"param",
	"canvas",
	"svg",
	"math",
	// Tables
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"colgroup",
	"col",
	// Forms
	"form",
	"input",
	"textarea",
	"button",
	"select",
	"option",
	"optgroup",
	"label",
	"fieldset",
	"legend",
	"datalist",
	"output",
	"progress",
	"meter",
	// Interactive
	"details",
	"summary",
	"dialog",
	"menu",
	// Scripting
	"script",
	"noscript",
	"template",
	"slot",
	// Other
	"address",
	"data",
	"area",
	"map",
	"base",
	"link",
	"meta",
	"style",
	"title",
])

/**
 * Check if a tag name is NOT a valid HTML element.
 * Unknown tags (TypeScript syntax, tool names, etc.) should be rendered as fragments.
 */
const isUnknownTag = (tagName: string): boolean => {
	const lower = tagName.toLowerCase()
	// If it's a known HTML tag, it's not unknown
	if (VALID_HTML_TAGS.has(lower)) return false
	// Everything else is unknown and should be a passthrough
	return true
}

/**
 * Legacy alias for backwards compatibility
 * @deprecated Use isUnknownTag instead
 */
const isTypeScriptLikeTag = isUnknownTag

/**
 * Filter props to only allow valid DOM attributes.
 * This prevents warnings like "Invalid DOM property `defaultvalue`" or
 * "Invalid DOM property `promise<context`" from TypeScript syntax in markdown.
 */
const sanitizeProps = (props: Record<string, unknown>): Record<string, unknown> => {
	const sanitized: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(props)) {
		if (VALID_DOM_ATTRIBUTES.has(key) || key.startsWith("data-") || key.startsWith("aria-")) {
			sanitized[key] = value
		}
	}
	return sanitized
}

/**
 * Helper to create a simple passthrough component for unknown tags.
 * For TypeScript-like tags, renders just the children (as a fragment) to avoid React warnings.
 * For other unknown tags, renders as span (inline) or div (block) with sanitized props.
 */
const createPassthrough = (tagName: string, block = false) => {
	// For TypeScript-like tags, just render children without a wrapper
	// This avoids React warnings about unknown HTML elements
	if (isTypeScriptLikeTag(tagName)) {
		const FragmentComponent = ({ children }: React.HTMLAttributes<HTMLElement>) => {
			return <>{children}</>
		}
		FragmentComponent.displayName = `TSFragment(${tagName})`
		return FragmentComponent
	}

	const Component = ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => {
		const sanitized = sanitizeProps(props as Record<string, unknown>)
		return block ? (
			<div data-tag={tagName} {...sanitized}>
				{children}
			</div>
		) : (
			<span data-tag={tagName} {...sanitized}>
				{children}
			</span>
		)
	}
	Component.displayName = `Passthrough(${tagName})`
	return Component
}

/**
 * Fragment component that just renders children.
 * Used for TypeScript-like tags that shouldn't render any DOM element.
 */
const FragmentPassthrough = ({ children }: React.HTMLAttributes<HTMLElement>) => <>{children}</>

const streamdownComponents: Record<
	string,
	React.ComponentType<React.HTMLAttributes<HTMLElement>>
> = {
	// TypeScript-like tags that get incorrectly parsed from code blocks
	// These render as fragments (no DOM element) to avoid React warnings
	r: FragmentPassthrough,
	t: FragmentPassthrough,
	k: FragmentPassthrough,
	v: FragmentPassthrough,
	s: FragmentPassthrough,
	u: FragmentPassthrough,

	e: FragmentPassthrough,
	any: FragmentPassthrough,
	void: FragmentPassthrough,
	unknown: FragmentPassthrough,
	never: FragmentPassthrough,
	null: FragmentPassthrough,
	undefined: FragmentPassthrough,
	string: FragmentPassthrough,
	number: FragmentPassthrough,
	boolean: FragmentPassthrough,
	object: FragmentPassthrough,
	symbol: FragmentPassthrough,
	bigint: FragmentPassthrough,
	function: FragmentPassthrough,
	anonymous: FragmentPassthrough,
	promise: FragmentPassthrough,
	array: FragmentPassthrough,
	map: FragmentPassthrough,
	set: FragmentPassthrough,
	record: FragmentPassthrough,
	partial: FragmentPassthrough,
	required: FragmentPassthrough,
	readonly: FragmentPassthrough,
	pick: FragmentPassthrough,
	omit: FragmentPassthrough,
	exclude: FragmentPassthrough,
	extract: FragmentPassthrough,
	awaited: FragmentPassthrough,
	returntype: FragmentPassthrough,
	parameters: FragmentPassthrough,
	instancetype: FragmentPassthrough,
	thistype: FragmentPassthrough,
	// Tags with trailing punctuation
	"string,": FragmentPassthrough,
	"number,": FragmentPassthrough,
	"boolean,": FragmentPassthrough,
	"any,": FragmentPassthrough,
	"void,": FragmentPassthrough,
	"unknown,": FragmentPassthrough,

	// Common words that appear in tool outputs and get parsed as HTML tags
	// These are NOT TypeScript types but appear in JSON/text content
	thematic: FragmentPassthrough,
	package: FragmentPassthrough,
	repo: FragmentPassthrough,
	request: FragmentPassthrough,
	task: FragmentPassthrough,
	error: FragmentPassthrough,
	id: FragmentPassthrough,
	from_search_result: FragmentPassthrough,
	session_id: FragmentPassthrough,
	// TypeScript generic syntax that gets parsed as tags
	"array<decisiontrace": FragmentPassthrough,
	"decisiontrace[]": FragmentPassthrough,

	// Custom component tags - render as divs (block elements)
	codeblocktabs: createPassthrough("codeblocktabs", true),
	codeblocktabstrigger: createPassthrough("codeblocktabstrigger", true),
	codeblocktabslist: createPassthrough("codeblocktabslist", true),
	codeblocktab: createPassthrough("codeblocktab", true),
	codeblocktabscontent: createPassthrough("codeblocktabscontent", true),
	codecollapsiblewrapper: createPassthrough("codecollapsiblewrapper", true),
	conversation: createPassthrough("conversation", true),
	preview: createPassthrough("preview", true),
	// File content from Read tool - render as scrollable code block
	file: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
		const sanitized = sanitizeProps(props as Record<string, unknown>)
		return (
			<pre
				className="overflow-x-auto rounded-lg bg-mantle p-4 text-sm font-mono text-foreground"
				{...sanitized}
			>
				<code>{children}</code>
			</pre>
		)
	},
	context: createPassthrough("context", true),
	callout: createPassthrough("callout", true),
	globalevent: createPassthrough("globalevent", true),
	eventhandler: createPassthrough("eventhandler", true),

	// Fix hydration: p tags that contain block elements should render as div
	// This prevents "div inside p" and "pre inside p" hydration errors
	p: ({ children, ...props }) => {
		const sanitized = sanitizeProps(props as Record<string, unknown>)
		return (
			<div className="mb-4 last:mb-0" {...sanitized}>
				{children}
			</div>
		)
	},
}

/**
 * Cache for dynamically created passthrough components.
 * This ensures React sees the same component reference on each render,
 * preventing unnecessary re-renders and React warnings.
 */
const passthroughCache = new Map<string, React.ComponentType<React.HTMLAttributes<HTMLElement>>>()

/**
 * Get or create a cached passthrough component for a tag name.
 */
const getCachedPassthrough = (
	tagName: string,
): React.ComponentType<React.HTMLAttributes<HTMLElement>> => {
	let component = passthroughCache.get(tagName)
	if (!component) {
		component = createPassthrough(tagName)
		passthroughCache.set(tagName, component)
	}
	return component
}

/**
 * Create a Proxy that catches any unknown HTML tags and renders them as spans.
 * This handles TypeScript generics like <string,>, <Promise<T>>, etc.
 * that get incorrectly parsed as HTML tags from markdown content.
 *
 * IMPORTANT: We create a new Proxy for each render because spreading a Proxy
 * into an object loses the Proxy behavior. The Proxy must wrap the final
 * merged components object.
 */
const createComponentsWithFallback = (
	additionalComponents?: Record<string, React.ComponentType<unknown>>,
) => {
	const baseComponents = { ...streamdownComponents, ...additionalComponents }
	return new Proxy(baseComponents, {
		get(target, prop: string | symbol) {
			// Ignore symbols (used by React internals)
			if (typeof prop === "symbol") {
				return undefined
			}
			if (prop in target) {
				return target[prop as keyof typeof target]
			}
			// Return a cached passthrough component for any unknown tag
			return getCachedPassthrough(prop)
		},
	})
}

export const MessageResponse = memo(
	({ className, components, ...props }: MessageResponseProps) => (
		<StreamdownContext.Provider
			value={{
				shikiTheme: ["catppuccin-latte", "catppuccin-mocha"] as const,
				controls: true,
				isAnimating: false,
				mode: "streaming",
			}}
		>
			<Streamdown
				className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
				components={createComponentsWithFallback(
					components as Record<string, React.ComponentType<unknown>>,
				)}
				rehypePlugins={[rehypeSanitizeUnknownTags]}
				{...props}
			/>
		</StreamdownContext.Provider>
	),
	(prevProps, nextProps) => prevProps.children === nextProps.children,
)

MessageResponse.displayName = "MessageResponse"

export type MessageAttachmentProps = HTMLAttributes<HTMLDivElement> & {
	data: FileUIPart
	className?: string
	onRemove?: () => void
}

export function MessageAttachment({ data, className, onRemove, ...props }: MessageAttachmentProps) {
	const filename = data.filename || ""
	const mediaType = data.mediaType?.startsWith("image/") && data.url ? "image" : "file"
	const isImage = mediaType === "image"
	const attachmentLabel = filename || (isImage ? "Image" : "Attachment")

	return (
		<div className={cn("group relative size-24 overflow-hidden rounded-lg", className)} {...props}>
			{isImage ? (
				<>
					<img
						alt={filename || "attachment"}
						className="size-full object-cover"
						height={100}
						src={data.url}
						width={100}
					/>
					{onRemove && (
						<Button
							aria-label="Remove attachment"
							className="absolute top-2 right-2 size-6 rounded-full bg-background/80 p-0 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 [&>svg]:size-3"
							onClick={(e) => {
								e.stopPropagation()
								onRemove()
							}}
							type="button"
							variant="ghost"
						>
							<XIcon />
							<span className="sr-only">Remove</span>
						</Button>
					)}
				</>
			) : (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="flex size-full shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
								<PaperclipIcon className="size-4" />
							</div>
						</TooltipTrigger>
						<TooltipContent>
							<p>{attachmentLabel}</p>
						</TooltipContent>
					</Tooltip>
					{onRemove && (
						<Button
							aria-label="Remove attachment"
							className="size-6 shrink-0 rounded-full p-0 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 [&>svg]:size-3"
							onClick={(e) => {
								e.stopPropagation()
								onRemove()
							}}
							type="button"
							variant="ghost"
						>
							<XIcon />
							<span className="sr-only">Remove</span>
						</Button>
					)}
				</>
			)}
		</div>
	)
}

export type MessageAttachmentsProps = ComponentProps<"div">

export function MessageAttachments({ children, className, ...props }: MessageAttachmentsProps) {
	if (!children) {
		return null
	}

	return (
		<div className={cn("ml-auto flex w-fit flex-wrap items-start gap-2", className)} {...props}>
			{children}
		</div>
	)
}

export type MessageToolbarProps = ComponentProps<"div">

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
	<div className={cn("mt-4 flex w-full items-center justify-between gap-4", className)} {...props}>
		{children}
	</div>
)
