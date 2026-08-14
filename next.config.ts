import type { NextConfig } from 'next'

// Resolved at build time and inlined into the client bundle, so /display can
// state exactly which deploy the TV is currently running.
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'lokal'
const builtAt = new Date().toISOString().slice(0, 16).replace('T', ' ')

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: commit,
    NEXT_PUBLIC_BUILD_TIME: builtAt,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '52mb',
    },
  },
}

export default nextConfig