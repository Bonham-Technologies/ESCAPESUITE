import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-491: ESCAPEARTIST's chords answer Ctrl or Cmd (`ctrlKey ||
 * metaKey`), but every hint said "Ctrl", so a Mac was told a chord that is not
 * its own. The hints now read the platform: ⌘ on Apple platforms, Ctrl
 * everywhere else, and the screen-reader text spells the key out (Command or
 * Control).
 *
 * The runner is Linux, so each case dresses the page up as a platform before
 * any of its scripts run: `navigator.userAgentData.platform` (Chromium's), and
 * `navigator.platform` and the user-agent string (what Firefox and Safari
 * have). A context `userAgent` alone would not do: it leaves both of the
 * others saying Linux.
 */

interface Platform {
  name: string
  /** `navigator.userAgentData.platform`, where the engine has it. */
  uaDataPlatform: string
  platform: string
  userAgent: string
}

const MAC: Platform = {
  name: 'macOS',
  uaDataPlatform: 'macOS',
  platform: 'MacIntel',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

const WINDOWS: Platform = {
  name: 'Windows',
  uaDataPlatform: 'Windows',
  platform: 'Win32',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

async function pretendToBe(page: Page, p: Platform): Promise<void> {
  await page.addInitScript((p: Platform) => {
    const proto = Object.getPrototypeOf(navigator) as object
    Object.defineProperty(proto, 'platform', { configurable: true, get: () => p.platform })
    Object.defineProperty(proto, 'userAgent', { configurable: true, get: () => p.userAgent })
    const uaData = (navigator as { userAgentData?: object }).userAgentData
    if (uaData) {
      Object.defineProperty(Object.getPrototypeOf(uaData) as object, 'platform', {
        configurable: true,
        get: () => p.uaDataPlatform,
      })
    }
  }, p)
}

async function openEditor(page: Page, p: Platform): Promise<void> {
  await pretendToBe(page, p)
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
}

/** The visible keys of the shortcut sheet's row for `description`. */
async function sheetKeys(page: Page, description: string): Promise<string[]> {
  await page.keyboard.press('Shift+Slash')
  const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
  await expect(sheet).toBeVisible()
  const row = sheet.getByText(description, { exact: true }).first().locator('..')
  return row.locator('kbd').allTextContents()
}

test.describe('ESCSUITE-491: shortcut hints name the platform\'s own modifier', () => {
  test('a Mac is shown ⌘, and told "Command"', async ({ page }) => {
    await openEditor(page, MAC)

    await expect(page.getByRole('button', { name: /^Undo/ })).toHaveAttribute('title', 'Undo (⌘Z)')
    await expect(page.getByRole('button', { name: 'Undo (Command+Z)' })).toBeAttached()
    await expect(page.getByRole('button', { name: 'Save project' })).toHaveAttribute('title', 'Save (⌘S)')

    await page.getByRole('button', { name: 'File menu' }).click()
    const open = page.getByRole('menuitem', { name: /^Open Project/ })
    await expect(open).toHaveAccessibleName('Open Project... Command+O')
    await expect(open.getByText('⌘O', { exact: true })).toBeVisible()
    await expect(page.getByText('Ctrl+O')).toHaveCount(0)
    await page.keyboard.press('Escape')

    expect(await sheetKeys(page, 'Undo')).toEqual(['⌘', 'Z'])
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' }).getByText('Ctrl', { exact: true })).toHaveCount(0)
  })

  test('anywhere else is shown Ctrl, and told "Control"', async ({ page }) => {
    await openEditor(page, WINDOWS)

    await expect(page.getByRole('button', { name: /^Undo/ })).toHaveAttribute('title', 'Undo (Ctrl+Z)')
    await expect(page.getByRole('button', { name: 'Undo (Control+Z)' })).toBeAttached()
    await expect(page.getByRole('button', { name: 'Save project' })).toHaveAttribute('title', 'Save (Ctrl+S)')

    await page.getByRole('button', { name: 'File menu' }).click()
    const open = page.getByRole('menuitem', { name: /^Open Project/ })
    await expect(open).toHaveAccessibleName('Open Project... Control+O')
    await expect(open.getByText('Ctrl+O', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    expect(await sheetKeys(page, 'Undo')).toEqual(['Ctrl', 'Z'])
  })
})
