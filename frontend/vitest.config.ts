import { defineConfig } from 'vitest/config'

// Unit tests only — pure logic under src/. The Playwright e2e suite lives at
// the repo root and is intentionally out of scope here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
