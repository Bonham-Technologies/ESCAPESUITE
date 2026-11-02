import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-369: each app names its own build in its help sheet, so a bug
 * report can say which version it came from. The version is the app's own
 * package.json version, inlined at build time.
 */

const versionOf = (app: 'craft' | 'artist'): string =>
  JSON.parse(readFileSync(new URL(`../../../${app}/package.json`, import.meta.url), 'utf8')).version

test('ESCAPECRAFT shows its version in Recording Tips', async ({ page }) => {
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')

  await page.getByRole('button', { name: /help - recording tips/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Recording Tips' })

  await expect(dialog.getByText(`ESCAPECRAFT v${versionOf('craft')}`, { exact: true })).toBeVisible()
})

test('ESCAPEARTIST shows its version in the keyboard shortcuts sheet', async ({ page }) => {
  await page.goto('http://localhost:5175')
  await waitForAppReady(page, 'artist')

  // `?` is the only way in — there is no button for it.
  await page.keyboard.press('Shift+Slash')
  const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })

  await expect(sheet.getByText(`ESCAPEARTIST v${versionOf('artist')}`, { exact: true })).toBeVisible()
})
