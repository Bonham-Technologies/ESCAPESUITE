import { statSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { canConvertToMp4 } from '../../utils/webcodecs'
import { waitForAppReady } from '../../utils/ready'
import {
  ANALYTICS_ALLOWED_HOSTS,
  assertNetworkSilence,
  classifyUrl,
  trackNetworkSilence,
} from '../../utils/networkSilence'

/**
 * ESCSUITE-402: the hosted build's record, edit and export path talks to
 * nothing but its own origin (and the analytics allow-list).
 *
 * Runs on the combined `dist/` that `pnpm build:deploy` assembles, served by
 * `scripts/serve-dist.mjs` with `vercel.json`'s rewrites and headers — the
 * hosted layout, with the hosted build's analytics compiled in and the hosted
 * Content-Security-Policy enforced. The standalone suites prove the same of
 * the offline file, where nothing at all is allowed.
 *
 * The hub's "Known limitations" page (`/limitations`) links here as the
 * check anyone can run.
 */

const ORIGIN = 'http://localhost:5190'

/** Wait for an export to download, failing on the dialog's own error the moment it shows. */
async function downloadExport(page: Page, buttonName: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  const exportFailed = page.getByRole('alert').filter({ hasText: 'Export failed' })
  const failurePromise = exportFailed
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => exportFailed.innerText())
  downloadPromise.catch(() => {})
  failurePromise.catch(() => {})

  await page.getByRole('button', { name: buttonName }).first().click()
  const outcome = await Promise.race([
    downloadPromise.then((download) => ({ download, failure: null })),
    failurePromise.then((failure) => ({ download: null, failure })),
  ])
  expect(outcome.failure, 'the export failed instead of downloading').toBeNull()
  const path = await outcome.download!.path()
  expect(statSync(path).size).toBeGreaterThan(1000)
  return outcome.download!.suggestedFilename()
}

test.describe('Hosted build network silence (ESCSUITE-402)', () => {
  test('record in CRAFT, edit and export in ARTIST: every request stays on this origin', async ({
    browser,
  }) => {
    // A real take, a hand-off, an edit and up to two real encodes.
    test.setTimeout(240_000)

    const context = await browser.newContext()
    const tracker = await trackNetworkSilence(context, { origin: ORIGIN })
    const page = await context.newPage()
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await test.step('the hub launches ESCAPECRAFT', async () => {
      await page.goto(`${ORIGIN}/`)
      await waitForAppReady(page, 'plan')
      // The hero CTA fires the hub's "Tool Launched" event before navigating.
      await page.getByRole('button', { name: /start recording/i }).first().click()
      await page.waitForURL(`${ORIGIN}/craft/`)
      await waitForAppReady(page, 'craft')
    })

    await test.step('record a take', async () => {
      const screenSource = page
        .locator('[class*="sourceToggle"]')
        .filter({ hasText: 'Screen' })
        .last()
      await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Start recording' }).click()
      await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
        timeout: 30_000,
      })
      await page.waitForTimeout(2500)
      await page.getByRole('button', { name: 'Stop recording' }).click()
      await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
        timeout: 30_000,
      })
    })

    const artist = await test.step('"Open in Editor" hands the take to ESCAPEARTIST', async () => {
      const popupPromise = context.waitForEvent('page')
      await page.getByRole('button', { name: /Open .+ in Editor/ }).click()
      const popup = await popupPromise
      await waitForAppReady(popup, 'artist')
      expect(popup.url()).toMatch(/\/artist\/\?loadVideo=[0-9a-f-]+$/)
      return popup
    })

    await test.step('edit: add a text overlay over the take', async () => {
      // On one origin the hand-off reads the take out of the shared database
      // and places it on the timeline itself (`app/takeImport.ts`).
      await expect(artist.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 30_000 })
      await artist.getByRole('button', { name: 'Add Text' }).click()
      await expect(artist.getByText(/^2 clips ·/)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('export WebM', async () => {
      await openExportDialog(artist)
      expect(await downloadExport(artist, 'Download WebM')).toMatch(/\.webm$/)
      // The dialog closes itself two seconds after "Export complete!".
      await expect(artist.getByRole('heading', { name: 'Export Video' })).toBeHidden({
        timeout: 10_000,
      })
    })

    await test.step('export MP4 (starts the hosted decode worker, a same-origin chunk)', async () => {
      // Not `test.skip`: that would skip the whole test, verdict included.
      if (!(await canConvertToMp4(artist))) {
        test.info().annotations.push({ type: 'note', description: 'No H.264 encoder: MP4 export not exercised' })
        return
      }
      await openExportDialog(artist)
      await openExportAdvancedOptions(artist)
      await artist.getByRole('radio', { name: /MP4/ }).check()
      expect(await downloadExport(artist, 'Download MP4')).toMatch(/\.mp4$/)
      // The hosted build keeps the worker as its own chunk beside index.html.
      expect(tracker.requests().some((url) => url.startsWith(`${ORIGIN}/artist/decodeWorker-`))).toBe(true)
    })

    // Anything still in flight from the last step (an analytics event, a late
    // chunk) has a moment to show up before the verdict.
    await page.waitForTimeout(1000)

    // Not a pure negative: the tracker saw the whole path, all three apps and
    // the hosted analytics runtime, each from this origin.
    const seen = tracker.requests()
    expect(seen.some((url) => url.startsWith(`${ORIGIN}/craft/`))).toBe(true)
    expect(seen.some((url) => url.startsWith(`${ORIGIN}/artist/`))).toBe(true)
    expect(seen.some((url) => url.startsWith(`${ORIGIN}/_vercel/insights/`))).toBe(true)

    assertNetworkSilence(tracker)

    await context.close()
  })

  test('the Known limitations page loads without leaving the origin, and links here', async ({
    browser,
  }) => {
    const context = await browser.newContext()
    const tracker = await trackNetworkSilence(context, { origin: ORIGIN })
    const page = await context.newPage()

    await page.goto(`${ORIGIN}/limitations`)
    await waitForAppReady(page, 'plan')
    await expect(page.getByRole('heading', { level: 1, name: /known limitations/i })).toBeVisible()
    await expect(
      page.getByRole('link', { name: /network-silence\.spec\.ts/ })
    ).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/blob/main/apps/e2e/tests/production/network-silence.spec.ts'
    )

    await page.waitForTimeout(500)
    expect(tracker.requests().some((url) => url.startsWith(`${ORIGIN}/assets/`))).toBe(true)
    assertNetworkSilence(tracker)

    await context.close()
  })
})

test.describe('The network-silence check itself (ESCSUITE-402 negative cases)', () => {
  test('classifies addresses by origin and allow-list', () => {
    expect(classifyUrl(`${ORIGIN}/craft/`, ORIGIN)).toBe('same-origin')
    expect(classifyUrl('blob:http://localhost:5190/1234', ORIGIN)).toBe('not-network')
    expect(classifyUrl('data:text/plain,hi', ORIGIN)).toBe('not-network')
    expect(classifyUrl('inline', ORIGIN)).toBe('not-network')
    expect(classifyUrl(`https://${ANALYTICS_ALLOWED_HOSTS[0]}/v1/script.debug.js`, ORIGIN)).toBe(
      'allow-listed'
    )
    expect(classifyUrl('https://example.com/collect', ORIGIN)).toBe('off-origin')
    // Same host, another port, is another origin.
    expect(classifyUrl('http://localhost:5191/', ORIGIN)).toBe('off-origin')
  })

  test('fails when the page sends a request to another host', async ({ browser }) => {
    const context = await browser.newContext()
    const tracker = await trackNetworkSilence(context, { origin: ORIGIN })
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/craft/`)
    await waitForAppReady(page, 'craft')

    assertNetworkSilence(tracker)

    // The hosted CSP lets no other host through `connect-src` (ESCSUITE-459),
    // but it doesn't govern a window the page opens, so this becomes a real
    // request — which the tracker records and then aborts, so nothing
    // actually leaves the machine.
    await page.evaluate(() => {
      window.open('https://example.com/escsuite-402-probe')
    })
    await expect
      .poll(() => tracker.violations().map((v) => v.via + ' ' + v.url))
      .toContain('request https://example.com/escsuite-402-probe')

    expect(() => assertNetworkSilence(tracker)).toThrow(/example\.com\/escsuite-402-probe/)

    await context.close()
  })

  test('fails when the page tries a host the CSP blocks, but not an allow-listed one', async ({
    browser,
  }) => {
    const context = await browser.newContext()
    const tracker = await trackNetworkSilence(context, { origin: ORIGIN })
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/artist/`)
    await waitForAppReady(page, 'artist')

    // The allow-listed analytics host first: `connect-src` blocks it too, and
    // the tracker must let it pass.
    await page.evaluate(async () => {
      await fetch('https://va.vercel-scripts.com/escsuite-402-probe').catch(() => {})
      await fetch('https://example.com/escsuite-402-probe').catch(() => {})
    })
    await expect.poll(() => tracker.violations().length).toBeGreaterThan(0)

    const offenders = tracker.violations().map((v) => new URL(v.url).hostname)
    expect(offenders).toContain('example.com')
    expect(offenders).not.toContain('va.vercel-scripts.com')
    expect(() => assertNetworkSilence(tracker)).toThrow(/example\.com/)

    await context.close()
  })
})
