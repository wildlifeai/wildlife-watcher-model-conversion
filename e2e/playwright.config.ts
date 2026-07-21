import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * Target is selected entirely by env (see .env.example):
 *   E2E_BASE_URL — frontend under test (local vite or the deployed dev site)
 *   E2E_API_URL  — FastAPI backend (local :8000 or the Azure dev container)
 * Specs that need privileged access (realtime seeding) skip themselves when
 * their env is absent, so a bare `npm run e2e` is always safe to run.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1, // specs share one seeded account; serial keeps state predictable
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
