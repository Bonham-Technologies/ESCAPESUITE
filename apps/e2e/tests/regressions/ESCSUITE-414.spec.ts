import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, makeToneWav, seedTextClip } from '../../utils/artist'
import { runAxeCheck } from '../../utils/accessibility'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-414: where the browser will not open IndexedDB at all (Firefox with
 * site data blocked or "Never remember history", storage blocked by policy, an
 * embed without partitioned storage), ESCAPEARTIST said nothing. The media
 * library read "No media uploaded yet", an import put the exception's own text
 * on its row, and every session check, autosave and library read logged
 * another console error. ESCAPECRAFT has said "storage may be blocked in this
 * browser" for the same failure for a long time.
 *
 * Now the library says so at load, in a notice that stays; an import that
 * cannot be stored says "Storage is blocked in this browser…"; and the
 * failures after that are quiet: one console error for the whole page.
 *
 * Both ways a browser refuses are reproduced: `indexedDB.open` throwing
 * (Firefox's `SecurityError`), and a real open request that fails afterwards
 * (Chromium's denied request; here an upgrade aborted before it starts).
 */

const BLOCKS = {
  'open throws': () => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
  },
  'open request fails': () => {
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (this: IDBFactory) {
      // A real request, under a throwaway name, whose upgrade is aborted before
      // anything else hears of it: it fails the way a denied open does.
      const request = open.call(this, `escsuite-414-${Math.random()}`, 1)
      request.addEventListener('upgradeneeded', (event) => {
        event.stopImmediatePropagation()
        request.transaction?.abort()
      })
      return request
    }
  },
} as const

const NOTICE = 'Your media library could not be opened — storage may be blocked in this browser.'
const IMPORT_ROW = 'Storage is blocked in this browser, so this file could not be imported.'

/**
 * Every console error the page logs, from now on.
 *
 * In dev, Vercel Analytics loads its debug script from `va.vercel-scripts.com`
 * (see `utils/networkSilence.ts`). That CDN answered the nightly's WebKit with
 * a 403, and the browser logged "Failed to load resource … 403" as a console
 * error, which this count is not about. So the script is served empty here,
 * and the count sees only what ARTIST itself logs.
 */
async function collectConsoleErrors(page: Page): Promise<string[]> {
  await page.route('https://va.vercel-scripts.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  )
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

async function importTone(page: Page, name: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'audio/wav',
    buffer: makeToneWav(1),
  })
}

test.describe('ESCSUITE-414: ARTIST explains blocked browser storage', () => {
  for (const [how, block] of Object.entries(BLOCKS)) {
    test(`says so at load and on the import row (${how})`, async ({ page }) => {
      await page.addInitScript(block)
      const errors = await collectConsoleErrors(page)
      await page.goto(ARTIST_URL)
      await waitForAppReady(page, 'artist')

      // Before the fix: nothing, and the library read "No media uploaded yet".
      const notice = page.getByRole('status').filter({ hasText: NOTICE })
      await expect(notice).toBeVisible({ timeout: 15_000 })
      await expect(notice).toContainText('Allow this site to store data, then reload.')

      // Before the fix the row carried the exception's own sentence.
      await importTone(page, 'first.wav')
      const firstRow = page.getByRole('status').filter({ hasText: IMPORT_ROW })
      await expect(firstRow).toHaveCount(1, { timeout: 30_000 })
      await expect(page.getByText(/insecure|addEventListener|AbortError|DOMException/)).toHaveCount(0)

      // A second import, and an edit the autosave tries to keep: both fail
      // again, quietly.
      await importTone(page, 'second.wav')
      await expect(page.getByRole('status').filter({ hasText: IMPORT_ROW })).toHaveCount(2, { timeout: 30_000 })
      await seedTextClip(page)
      // Past the autosave's 2 s debounce, so its write has been tried.
      await page.waitForTimeout(3_000)
      await expect(page.getByText('Your session could not be saved — storage may be full.')).toHaveCount(0)

      // The notice is still up: it does not time out like a toast.
      await expect(notice).toBeVisible()
      expect(errors, errors.join('\n')).toHaveLength(1)
    })
  }

  // The notice's text against its tint, in both palettes. `?theme=` is the
  // shared theme system's own override and does not persist.
  for (const theme of ['dark', 'light'] as const) {
    test(`the notice passes axe-core (${theme} theme)`, async ({ page }) => {
      await page.addInitScript(BLOCKS['open throws'])
      await page.goto(`${ARTIST_URL}/?theme=${theme}`)
      await waitForAppReady(page, 'artist')
      if (theme === 'light') {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      } else {
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
      }
      await expect(page.getByRole('status').filter({ hasText: NOTICE })).toBeVisible({ timeout: 15_000 })

      const results = await runAxeCheck(page, { includeSelector: '#storage-blocked-notice' })
      expect(results.violations).toEqual([])
    })
  }
})
