"use client"

import { useRouter } from "next/navigation"
import { Plus, Loader2 } from "lucide-react"
import { useCreateSession } from "@/app/hooks"
import { Button } from "@/components/ui/button"

interface NewSessionButtonProps {
	directory?: string
}

/**
 * Client component for creating a new session
 * Handles creation and navigation to the new session
 */
export function NewSessionButton({ directory }: NewSessionButtonProps) {
	const router = useRouter()
	const { createSession, isCreating, error } = useCreateSession()

	const handleCreate = async () => {
		const session = await createSession()
		if (session) {
			router.push(
				`/session/${session.id}${directory ? `?dir=${encodeURIComponent(directory)}` : ""}`,
			)
		}
	}

	return (
		<Button
			onClick={handleCreate}
			disabled={isCreating || !directory}
			size="sm"
			variant="outline"
			className="gap-1.5"
			title={!directory ? "Directory required to create session" : "Create new session"}
		>
			{isCreating ? (
				<>
					<Loader2 className="h-4 w-4 animate-spin" />
					Creating...
				</>
			) : (
				<>
					<Plus className="h-4 w-4" />
					New Session
				</>
			)}
		</Button>
	)
}
