import { chromium } from '@playwright/test'

// Credentials come from e2e/.env (gitignored) like the rest of the suite -
// never hardcode them here.
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD (see .env.example) before running this script.')
  process.exit(1)
}

const b = await chromium.launch()
const page = await b.newPage()
page.on('response', async r => {
  if (r.url().includes('/auth/v1/token')) {
    console.log('AUTH RESPONSE', r.status(), (await r.text()).slice(0, 300))
  }
})
await page.goto('http://localhost:5173/login')
await page.locator('input[type="email"]').first().fill(EMAIL)
await page.locator('input[type="password"]').first().fill(PASSWORD)
await page.locator('form button[type="submit"]').first().click()
await page.waitForTimeout(6000)
console.log('URL after:', page.url())
console.log('storage keys:', await page.evaluate(() => Object.keys(localStorage)))
console.log('visible text:', (await page.locator('form').innerText().catch(() => '')).slice(0, 300))
await b.close()
