import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Web test rig (DET-279, decision 9). Minimal vitest setup: jsdom env for
 * component rendering, the `@/*` path alias (mirrors tsconfig) resolved to
 * `src/`, and a setup file that registers @testing-library/jest-dom matchers.
 * NO network: tests render against in-repo fixture articles only.
 */
export default defineConfig({
  plugins: [react()],
  // The smoke tests assert structure/behaviour, not styling. Pin an EMPTY
  // inline PostCSS config so vitest does not try to load the Next.js Tailwind
  // `postcss.config.mjs` (whose plugin shape Vite's loader cannot parse).
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
