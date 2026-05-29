import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (DigitalOcean App Platform).
  output: 'standalone',
}

export default nextConfig
