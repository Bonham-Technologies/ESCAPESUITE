import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportDialog, exportButtonName } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-474: a long export, transcription or recording let the display go
 * to sleep, and a sleeping display can suspend the page's encoding. The apps
 * now hold a Screen Wake Lock for the length of the job (`holdScreenAwake`,
 * `packages/shared`) and let it go when the job ends.
 *
 * The init script replaces the browser's `request('screen')` with a stub that
 * counts requests and the `release()` calls on the sentinels it hands out, so
 * the real lock (which headless browsers may refuse) never matters. WebKit
 * hands the page a different `navigator.wakeLock` object than an init script
 * sees, so where a `WakeLock` interface exists the stub goes on its prototype;
 * otherwise `wakeLock` itself is defined on `Navigator.prototype`. The first
 * assertion in the case proves the stub reached the app in this engine.
 */

interface WakeLockCounts {
  requests: string[]
  releases: number
}

/** Stub the Screen Wake Lock API and count what the app asks of it. */
async function stubWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts: WakeLockCounts = { requests: [], releases: 0 }
    ;(window as unknown as { __wakeLock: WakeLockCounts }).__wakeLock = counts
    const request = async (type: string) => {
      counts.requests.push(type)
      const sentinel = new EventTarget() as EventTarget & { released: boolean; release: () => Promise<void> }
      sentinel.released = false
      sentinel.release = async () => {
        if (sentinel.released) return
        sentinel.released = true
        counts.releases += 1
        sentinel.dispatchEvent(new Event('release'))
      }
      return sentinel
    }
    const w = window as unknown as { WakeLock?: { prototype: object } }
    if (w.WakeLock) {
      Object.defineProperty(w.WakeLock.prototype, 'request', { configurable: true, writable: true, value: request })
    } else {
      Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => ({ request }) })
    }
  })
  // Vercel Analytics' dev debug script: served empty, so a CDN hiccup is not a failure here.
  await page.route('https://va.vercel-scripts.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  )
}

const counts = (page: Page) => page.evaluate(() => (window as unknown as { __wakeLock: WakeLockCounts }).__wakeLock)

test.describe('ESCSUITE-474: the screen stays on while ARTIST exports', () => {
  test('a WebM export asks for one screen wake lock and releases it when it finishes', async ({ page }) => {
    test.setTimeout(120_000)
    await stubWakeLock(page)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page)

    // Nothing is held before a job starts, and the stub is the one the app sees.
    expect(await counts(page)).toEqual({ requests: [], releases: 0 })

    await openExportDialog(page)
    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.getByRole('button', { name: exportButtonName('webm') }).first().click()
    await download

    await expect.poll(async () => (await counts(page)).requests).toEqual(['screen'])
    await expect.poll(async () => (await counts(page)).releases).toBe(1)
    // Nothing more arrives once the job is over.
    await page.waitForTimeout(500)
    expect(await counts(page)).toEqual({ requests: ['screen'], releases: 1 })
  })
})
