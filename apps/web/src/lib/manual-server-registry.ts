/**
 * Manual Server Registry
 *
 * Persists manually-registered remote opencode servers to ~/.local/state/opencode/manual-servers.json
 * These are servers on other machines/sandboxes not discoverable via lsof.
 */

import { mkdir, readFile, writeFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"

export interface ManualServer {
	url: string
	name?: string
	username?: string
	password?: string
	proxyPort: number
	addedAt: number
}

interface RegistryFile {
	servers: ManualServer[]
}

const PROXY_PORT_MIN = 49152
const PROXY_PORT_MAX = 65535
const PROXY_PORT_RANGE = PROXY_PORT_MAX - PROXY_PORT_MIN + 1

function getStateDir(): string {
	return join(homedir(), ".local", "state", "opencode")
}

function getRegistryPath(): string {
	return join(getStateDir(), "manual-servers.json")
}

function makeBasicAuthHeader(username: string, password: string): string {
	return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function parseUrlWithCredentials(rawUrl: string): {
	url: string
	username?: string
	password?: string
} {
	let normalized = rawUrl.trim()
	if (!normalized.match(/^https?:\/\//)) {
		normalized = `http://${normalized}`
	}
	normalized = normalized.replace(/\/+$/, "")

	let parsed: URL
	try {
		parsed = new URL(normalized)
	} catch {
		throw new Error(`Invalid URL: ${rawUrl}`)
	}

	const username = parsed.username || undefined
	const password = parsed.password || undefined

	parsed.username = ""
	parsed.password = ""
	const cleanUrl = parsed.toString().replace(/\/+$/, "")

	return { url: cleanUrl, username, password }
}

function hashString(value: string): number {
	let hash = 0
	for (let i = 0; i < value.length; i += 1) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0
	}
	return hash
}

function computeProxyPort(url: string, usedPorts: Set<number>): number {
	const baseHash = hashString(url)
	for (let attempt = 0; attempt < PROXY_PORT_RANGE; attempt += 1) {
		const hash = baseHash + attempt
		const port = PROXY_PORT_MIN + (hash % PROXY_PORT_RANGE)
		if (!usedPorts.has(port)) {
			return port
		}
	}

	throw new Error("No available proxy ports")
}

function normalizeServers(servers: ManualServer[]): { servers: ManualServer[]; changed: boolean } {
	const usedPorts = new Set(servers.map((server) => server.proxyPort).filter(Boolean))
	let changed = false

	const normalized = servers.map((server) => {
		if (server.proxyPort) return server
		const proxyPort = computeProxyPort(server.url, usedPorts)
		usedPorts.add(proxyPort)
		changed = true
		return { ...server, proxyPort }
	})

	return { servers: normalized, changed }
}

export function createAuthorizationHeader(server: ManualServer): string | undefined {
	if (!server.password) return undefined
	const username = server.username || "opencode"
	return makeBasicAuthHeader(username, server.password)
}

export async function getManualServerByProxyPort(port: number): Promise<ManualServer | undefined> {
	const servers = await readRegistry()
	return servers.find((server) => server.proxyPort === port)
}

export async function readRegistry(): Promise<ManualServer[]> {
	try {
		const content = await readFile(getRegistryPath(), "utf-8")
		const data: RegistryFile = JSON.parse(content)
		if (!Array.isArray(data.servers)) return []
		const normalized = normalizeServers(data.servers)
		if (normalized.changed) {
			await writeRegistry(normalized.servers)
		}
		return normalized.servers
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		console.error("[manual-registry] Failed to read registry:", error)
		return []
	}
}

async function writeRegistry(servers: ManualServer[]): Promise<void> {
	const stateDir = getStateDir()
	await mkdir(stateDir, { recursive: true })
	const data: RegistryFile = { servers }
	await writeFile(getRegistryPath(), JSON.stringify(data, null, 2), "utf-8")
}

export async function addServer(rawUrl: string, name?: string): Promise<ManualServer> {
	const { url, username, password } = parseUrlWithCredentials(rawUrl)

	const servers = await readRegistry()

	if (servers.some((s) => s.url === url)) {
		throw new Error(`Server already registered: ${url}`)
	}

	const usedPorts = new Set(servers.map((server) => server.proxyPort))
	const proxyPort = computeProxyPort(url, usedPorts)
	const newServer: ManualServer = {
		url,
		name: name?.trim() || undefined,
		username,
		password,
		proxyPort,
		addedAt: Date.now(),
	}

	servers.push(newServer)
	await writeRegistry(servers)

	return newServer
}

export async function removeServer(rawUrl: string): Promise<boolean> {
	const { url } = parseUrlWithCredentials(rawUrl)
	const servers = await readRegistry()

	const index = servers.findIndex((s) => s.url === url)
	if (index === -1) {
		return false
	}

	servers.splice(index, 1)
	await writeRegistry(servers)

	return true
}

function getAuthHeaders(server: ManualServer): HeadersInit {
	const authorization = createAuthorizationHeader(server)
	return authorization ? { Authorization: authorization } : {}
}

export async function verifyManualServer(
	server: ManualServer,
	timeoutMs = 2000,
): Promise<{
	url: string
	name?: string
	directory: string
	sessions?: string[]
	proxyPort: number
} | null> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
	const headers = getAuthHeaders(server)

	try {
		const res = await fetch(`${server.url}/project/current`, {
			signal: controller.signal,
			headers,
		})
		clearTimeout(timeoutId)

		if (!res.ok) return null

		const project = await res.json()
		const directory = project.worktree

		if (!directory || directory === "/" || directory.length <= 1) {
			return null
		}

		let sessions: string[] | undefined
		try {
			const sessionController = new AbortController()
			const sessionTimeoutId = setTimeout(() => sessionController.abort(), 1000)
			const sessionRes = await fetch(`${server.url}/session`, {
				signal: sessionController.signal,
				headers,
			})
			clearTimeout(sessionTimeoutId)

			if (sessionRes.ok) {
				const sessionList = await sessionRes.json()
				sessions = Array.isArray(sessionList)
					? sessionList.map((s: { id: string }) => s.id)
					: undefined
			}
		} catch {
			sessions = undefined
		}

		return {
			url: server.url,
			name: server.name,
			directory,
			sessions,
			proxyPort: server.proxyPort,
		}
	} catch {
		clearTimeout(timeoutId)
		return null
	}
}
