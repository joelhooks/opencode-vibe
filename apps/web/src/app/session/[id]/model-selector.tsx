"use client"

import {
	PromptInputSelect,
	PromptInputSelectContent,
	PromptInputSelectItem,
	PromptInputSelectTrigger,
	PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input"
import { useProviders } from "@/app/hooks"
import type { Provider, Model } from "@opencode-vibe/react"
import { BotIcon } from "lucide-react"

export interface ModelSelection {
	providerID: string
	modelID: string
}

export interface ModelSelectorProps {
	value?: ModelSelection
	onValueChange?: (value: ModelSelection) => void
	directory?: string
}

/**
 * Model selector component using PromptInputSelect from ai-elements.
 * Allows users to choose which AI model to use for sending messages.
 *
 * @example
 * ```tsx
 * const [model, setModel] = useState<ModelSelection>()
 *
 * <ModelSelector
 *   value={model}
 *   onValueChange={setModel}
 *   directory="/path/to/project"
 * />
 * ```
 */
export function ModelSelector({ value, onValueChange, directory }: ModelSelectorProps) {
	const { providers, loading: isLoading, error } = useProviders()

	// Create a flat list of provider+model combinations for the select
	const modelOptions: Array<{ provider: Provider; model: Model }> = []
	for (const provider of providers) {
		for (const model of provider.models) {
			modelOptions.push({ provider, model })
		}
	}

	// Serialize selection to string for Select component
	const serializeValue = (selection: ModelSelection) =>
		`${selection.providerID}::${selection.modelID}`

	const deserializeValue = (serialized: string): ModelSelection | undefined => {
		const [providerID, modelID] = serialized.split("::")
		if (!providerID || !modelID) return undefined
		return { providerID, modelID }
	}

	const handleValueChange = (serialized: string) => {
		const selection = deserializeValue(serialized)
		if (selection && onValueChange) {
			onValueChange(selection)
		}
	}

	// Format display name for selected model
	const displayName = () => {
		if (!value) return "Select model"

		const option = modelOptions.find(
			(opt) => opt.provider.id === value.providerID && opt.model.id === value.modelID,
		)

		if (!option) return "Select model"

		return `${option.provider.name} - ${option.model.name}`
	}

	if (error) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<BotIcon className="size-4" />
				<span>Error loading models</span>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<BotIcon className="size-4" />
				<span>Loading...</span>
			</div>
		)
	}

	if (modelOptions.length === 0) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<BotIcon className="size-4" />
				<span>No models available</span>
			</div>
		)
	}

	return (
		<PromptInputSelect
			value={value ? serializeValue(value) : undefined}
			onValueChange={handleValueChange}
		>
			<PromptInputSelectTrigger className="h-8 w-auto gap-2">
				<BotIcon className="size-4" />
				<PromptInputSelectValue>{displayName()}</PromptInputSelectValue>
			</PromptInputSelectTrigger>
			<PromptInputSelectContent>
				{modelOptions.map(({ provider, model }) => (
					<PromptInputSelectItem
						key={`${provider.id}-${model.id}`}
						value={serializeValue({
							providerID: provider.id,
							modelID: model.id,
						})}
					>
						{provider.name} - {model.name}
					</PromptInputSelectItem>
				))}
			</PromptInputSelectContent>
		</PromptInputSelect>
	)
}
