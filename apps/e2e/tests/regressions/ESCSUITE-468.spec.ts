import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, makeToneWav } from '../../utils/artist'
import { recordATake } from '../../utils/craft'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { runAxeCheck } from '../../utils/accessibility'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-468: recordings and imported media sit in IndexedDB as best-effort
 * data, which the browser may delete without asking. Neither app asked the
 * browser to keep it. Now both ask once (`navigator.storage.persist()`) after
 * the first save of a session, never on load, and say beside their storage
 * figure what `navigator.storage.persisted()` answers.
 *
 * The init script replaces both calls, so the browser's own answer (Chromium
 * and WebKit decide by themselves, Firefox would prompt) never reaches the
 * test: `persist()` answers what the case says and `persisted()` then reports
 * it. Every engine runs it the same way.
 */

const CRAFT_URL = 'http://localhost:5174'
const PROTECTED = 'Protected from automatic clean-up'
const MAY_DELETE = 'Your browser may delete these if it runs low on space; download what you want to keep.'
const LINE = '[class*="storagePersistence"]'

/** Stub the persistence API: `persist()` answers `grant`, and counts its calls. */
async function stubPersistence(page: Page, grant: boolean): Promise<void> {
  await page.addInitScript((grant: boolean) => {
    const w = window as unknown as { __persistCalls: number }
    w.__persistCalls = 0
    let persisted = false
    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: async () => {
        w.__persistCalls += 1
        if (grant) persisted = true
        return grant
      },
    })
    Object.defineProperty(navigator.storage, 'persisted', {
      configurable: true,
      value: async () => persisted,
    })
  }, grant)
  // Vercel Analytics' dev debug script: served empty, so a CDN hiccup is not a failure here.
  await page.route('https://va.vercel-scripts.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  )
}

const persistCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls)

async function expectTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  if (theme === 'light') {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  } else {
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
  }
}

async function expectReadableLine(page: Page): Promise<void> {
  const results = await runAxeCheck(page, { includeSelector: LINE })
  expect(results.violations).toEqual([])
}

for (const grant of [true, false]) {
  const message = grant ? PROTECTED : MAY_DELETE
  const other = grant ? MAY_DELETE : PROTECTED

  for (const theme of ['dark', 'light'] as const) {
    test(`ESCAPECRAFT asks after the first saved take and says "${grant ? 'protected' : 'may delete'}" (${theme} theme)`, async ({
      page,
    }) => {
      test.setTimeout(90_000)
      await stubPersistence(page, grant)
      await mockSyntheticMedia(page)
      await grantMediaPermissions(page)
      await page.goto(`${CRAFT_URL}/?theme=${theme}`)
      await waitForAppReady(page, 'craft')
      await expectTheme(page, theme)

      // Nothing asked on load: the library is empty, so there is no line yet.
      await expect(page.getByText('No recordings yet')).toBeVisible()
      expect(await persistCalls(page)).toBe(0)

      await recordATake(page)

      await expect(page.locator(LINE)).toHaveText(message, { timeout: 15_000 })
      await expect(page.getByText(other)).toHaveCount(0)
      expect(await persistCalls(page)).toBe(1)
      await expectReadableLine(page)
    })

    test(`ESCAPEARTIST asks after the first import and says "${grant ? 'protected' : 'may delete'}" (${theme} theme)`, async ({
      page,
    }) => {
      test.setTimeout(60_000)
      await stubPersistence(page, grant)
      await page.goto(`${ARTIST_URL}/?suppressRestore=1&theme=${theme}`)
      await waitForAppReady(page, 'artist')
      await expectTheme(page, theme)

      // Read on load, never asked: not persisted yet.
      await expect(page.locator(LINE)).toHaveText(MAY_DELETE, { timeout: 15_000 })
      expect(await persistCalls(page)).toBe(0)

      await page.locator('input[type="file"]').setInputFiles({
        name: 'tone.wav',
        mimeType: 'audio/wav',
        buffer: makeToneWav(1),
      })
      await expect.poll(() => persistCalls(page), { timeout: 30_000 }).toBe(1)
      await expect(page.locator(LINE)).toHaveText(message)
      await expect(page.getByText(other)).toHaveCount(0)

      // A second import does not ask again.
      await page.locator('input[type="file"]').setInputFiles({
        name: 'tone-2.wav',
        mimeType: 'audio/wav',
        buffer: makeToneWav(1),
      })
      await expect(page.getByRole('button', { name: 'Add to timeline' })).toHaveCount(2, { timeout: 30_000 })
      expect(await persistCalls(page)).toBe(1)
      await expectReadableLine(page)
    })
  }
}
