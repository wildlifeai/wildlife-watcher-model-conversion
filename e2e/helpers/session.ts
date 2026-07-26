import { Page, expect } from '@playwright/test'

export const CREDS = {
  email: process.env.E2E_EMAIL || '',
  password: process.env.E2E_PASSWORD || '',
}

export const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'

/** UI login with the seeded test user (tui@ww.org on a freshly seeded dev DB). */
export async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="email"]').first().fill(CREDS.email)
  await page.locator('input[type="password"]').first().fill(CREDS.password)
  // The Supabase Auth UI also renders "Sign in with GitHub/Google" buttons —
  // only the form's own submit is the email/password sign-in.
  await page.locator('form button[type="submit"]').first().click()
  // Session proof: supabase-js writes an sb-*-auth-token key to localStorage.
  await page.waitForFunction(
    () => Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)),
    undefined, { timeout: 20_000 }
  )
}

/** Assert a page renders without uncaught errors or an error boundary. */
export async function expectHealthyRender(page: Page, path: string): Promise<string[]> {
  const errors: string[] = []
  const onErr = (e: Error) => errors.push(e.message)
  page.on('pageerror', onErr)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  // Full reloads rehydrate the Supabase session async: RequireAuth may flash
  // /login before the session resolves and the app returns to the page.
  await page.waitForURL(u => u.pathname === path, { timeout: 10_000 }).catch(() => {})
  await expect(page.locator('body')).not.toContainText(/something went wrong|application error/i)
  page.off('pageerror', onErr)
  return errors
}
