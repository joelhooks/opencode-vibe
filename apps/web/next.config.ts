import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	cacheComponents: true,
	reactStrictMode: false, // Disable for SSE debugging - StrictMode double-mounts can abort connections

	// Increase cache size for large API responses (sessions, messages)
	cacheMaxMemorySize: 128 * 1024 * 1024, // 128MB (default is 50MB)

	// Allow Tailscale domains for mobile dev access
	allowedDevOrigins: ["dark-wizard.tail7af24.ts.net"],
}

export default nextConfig
