"use client"

import Link from "next/link"
import { useProvider } from "@opencode-vibe/react"

/**
 * Client component for provider detail - uses SSE for real-time data
 */
export function ProviderDetail({ id }: { id: string }) {
	const { data, loading, error } = useProvider()

	if (loading) {
		return (
			<div className="min-h-screen bg-base p-8">
				<div className="max-w-4xl mx-auto">
					<p className="text-subtext0">Loading provider...</p>
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="min-h-screen bg-base p-8">
				<div className="max-w-4xl mx-auto">
					<p className="text-red">Error loading provider: {error.message}</p>
					<Link href="/" className="text-blue hover:underline mt-4 inline-block">
						← Back to home
					</Link>
				</div>
			</div>
		)
	}

	const provider = data?.all.find((p) => p.id === id)

	if (!provider) {
		return (
			<div className="min-h-screen bg-base p-8">
				<div className="max-w-4xl mx-auto">
					<p className="text-subtext0">Provider not found</p>
					<Link href="/" className="text-blue hover:underline mt-4 inline-block">
						← Back to home
					</Link>
				</div>
			</div>
		)
	}

	const isConnected = data?.connected.includes(provider.id) ?? false
	const defaultModel = data?.defaults[provider.id]

	return (
		<div className="min-h-screen bg-base p-8">
			<div className="max-w-4xl mx-auto">
				<Link href="/" className="text-blue hover:underline mb-6 inline-block">
					← Back to home
				</Link>

				<div className="bg-surface0 rounded-lg shadow p-6 mb-6">
					<div className="flex items-center justify-between mb-4">
						<h1 className="text-3xl font-bold text-text">{provider.name}</h1>
						{isConnected ? (
							<span className="px-3 py-1 bg-green/20 text-green rounded-full text-sm">
								Connected
							</span>
						) : (
							<span className="px-3 py-1 bg-surface1 text-subtext0 rounded-full text-sm">
								Not Connected
							</span>
						)}
					</div>

					<div className="space-y-4">
						<div>
							<h2 className="text-sm font-semibold text-subtext0 uppercase">Provider ID</h2>
							<p className="text-text font-mono">{provider.id}</p>
						</div>

						<div>
							<h2 className="text-sm font-semibold text-subtext0 uppercase">Source</h2>
							<p className="text-text">{provider.source}</p>
						</div>

						{provider.env && provider.env.length > 0 && (
							<div>
								<h2 className="text-sm font-semibold text-subtext0 uppercase">
									Environment Variables Required
								</h2>
								<ul className="list-disc list-inside space-y-1">
									{provider.env.map((envVar) => (
										<li key={envVar} className="text-text font-mono text-sm">
											{envVar}
										</li>
									))}
								</ul>
							</div>
						)}

						{defaultModel && (
							<div>
								<h2 className="text-sm font-semibold text-subtext0 uppercase">Default Model</h2>
								<p className="text-text font-mono">{defaultModel}</p>
							</div>
						)}
					</div>
				</div>

				<div className="bg-surface0 rounded-lg shadow p-6">
					<h2 className="text-2xl font-bold text-text mb-4">Available Models</h2>
					{provider.models && Object.keys(provider.models).length > 0 ? (
						<div className="space-y-3">
							{Object.values(provider.models).map((model) => (
								<div
									key={model.id}
									className="border border-surface1 rounded p-4 hover:bg-surface1 transition-colors"
								>
									<div className="flex items-center justify-between">
										<div>
											<h3 className="font-semibold text-text">{model.name}</h3>
											<p className="text-sm text-subtext0 font-mono">{model.id}</p>
										</div>
										{defaultModel === model.id && (
											<span className="px-2 py-1 bg-blue/20 text-blue rounded text-xs">
												Default
											</span>
										)}
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="text-subtext0">No models available</p>
					)}
				</div>
			</div>
		</div>
	)
}
