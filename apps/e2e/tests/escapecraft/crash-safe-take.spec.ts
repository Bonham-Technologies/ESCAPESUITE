import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { captureConsole, storedRecordingCues } from '../../utils/seekable'
import {
  keptTakes,
  storedTakeHealth,
  syncAccessHandlesAvailable,
  waitForKeptBytes,
} from '../../utils/craftTakes'

/**
 * Crash-safe takes (ESCSUITE-466): a take is kept on the device as it records,
 * so a page that closes or dies before Stop leaves it behind, and the next
 * CRAFT that opens offers it back.
 *
 * "Killing the page" here is `page.close({ runBeforeUnload: false })` with the
 * take still running: the document, its worker and its Web Lock all go, and
 * nothing gets a chance to stop or save the take. The next page opens in the
 * same context, so it sees the same origin private file system.
 *
 * Both recorders are covered: a screen-only take goes through WebCodecs (the
 * muxer writes straight to disk), a PiP take through the compositor and
 * MediaRecorder (each chunk is appended to disk as well as kept in memory).
 */

const CRAFT_URL = 'http://localhost:5174'

/** Long enough for several Clusters and at least two worker flushes (2 s). */
const RECORD_MS = 7000

async function openCraft(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto(CRAFT_URL)
  await waitForAppReady(page, 'craft')
  return page
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext()
  // Third-party hosts stay stubbed, as the brief for every CRAFT spec asks.
  await context.route('https://va.vercel-scripts.com/**', (route) => route.abort())
  return context
}

/** Start a take (optionally PiP) and return when it is recording. */
async function startTake(page: Page, pip: boolean): Promise<number> {
  const source = (label: string) => page.getByRole('button', { name: label, exact: true })
  await expect(source('Screen')).toBeEnabled({ timeout: 30_000 })
  if (pip) {
    await expect(source('Webcam')).toBeEnabled({ timeout: 30_000 })
    await source('Webcam').click()
    await expect(source('Webcam')).toHaveAttribute('aria-pressed', 'true')
  }
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
  return Date.now()
}

/** Record, then close the page without stopping. Returns the seconds recorded. */
async function recordAndKill(page: Page, pip: boolean): Promise<number> {
  const started = await startTake(page, pip)
  await page.waitForTimeout(RECORD_MS)
  // Something real is on disk before the page goes: at least the header and
  // a few Clusters, which a missing worker or a refused handle would never write.
  await waitForKeptBytes(page, 20_000)
  const recorded = (Date.now() - started) / 1000
  await page.close({ runBeforeUnload: false })
  return recorded
}

const recoverDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Recover unfinished recording?' })

test.describe('ESCAPECRAFT crash-safe takes', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Only Chromium can be granted capture permissions headlessly, which every take here needs'
  )

  for (const { name, pip } of [
    { name: 'WebCodecs (screen-only) take', pip: false },
    { name: 'MediaRecorder (PiP) take', pip: true },
  ]) {
    test(`a ${name} whose page closed mid-recording is recovered, playable and seekable`, async ({ browser }) => {
      test.setTimeout(150_000)
      const context = await newContext(browser)
      try {
        const first = await openCraft(context)
        test.skip(
          !(await syncAccessHandlesAvailable(first)),
          'This browser hands workers no OPFS sync access handle, so takes are not kept on the device'
        )
        const recorded = await recordAndKill(first, pip)

        const page = await openCraft(context)
        const log = captureConsole(page)
        // The prompt is there as soon as the library has looked.
        await expect(recoverDialog(page)).toBeVisible({ timeout: 15_000 })
        await expect(page.getByRole('button', { name: 'Recover' })).toBeFocused()
        await page.getByRole('button', { name: 'Recover' }).click()

        await expect(recoverDialog(page)).toHaveCount(0)
        await expect(page.getByRole('button', { name: /^Play / })).toBeVisible({ timeout: 30_000 })

        const health = await storedTakeHealth(page)
        expect(health.size).toBeGreaterThan(20_000)
        expect(Number.isFinite(health.duration), `duration was ${health.duration}`).toBe(true)
        // Within 5 s of what was recorded before the page went (the most a
        // take loses is its last unflushed couple of seconds).
        expect(Math.abs(health.duration - recorded)).toBeLessThan(5)
        expect(health.seeked, 'a seek to the middle of the recovered take never landed').toBe(true)
        expect(Math.abs(health.seekedTo - health.duration / 2)).toBeLessThan(1.5)
        expect(health.audioChannels, 'the recovered take has no audio').toBeGreaterThan(0)
        expect(health.audioSeconds).toBeGreaterThan(1)

        // Seekable the way the save path makes every take: a keyframe Cues index.
        const cues = await storedRecordingCues(page)
        expect(cues.present).toBe(true)
        expect(cues.cueTimes).toEqual(cues.keyframeTimes)
        expect(cues.cueTargets).toEqual(cues.cueTimes.map(() => '1f43b675'))
        expect(log.matching(/WebM metadata repair failed/)).toEqual([])

        // Recovered and stored: nothing is left on the device to offer again.
        await expect.poll(() => keptTakes(page)).toEqual([])
      } finally {
        await context.close()
      }
    })
  }

  test('Discard deletes the kept take, and storage use returns to what it was', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await newContext(browser)
    try {
      const first = await openCraft(context)
      test.skip(
        !(await syncAccessHandlesAvailable(first)),
        'This browser hands workers no OPFS sync access handle, so takes are not kept on the device'
      )
      const usage = () => first.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0)
      const before = await usage()
      await recordAndKill(first, false)

      const page = await openCraft(context)
      await expect(recoverDialog(page)).toBeVisible({ timeout: 15_000 })
      const kept = await keptTakes(page)
      expect(kept).toHaveLength(1)
      await page.getByRole('button', { name: 'Discard' }).click()
      await expect(recoverDialog(page)).toHaveCount(0)

      await expect.poll(() => keptTakes(page)).toEqual([])
      // The take's bytes are gone from the origin's usage. Allowed a little
      // slack for the empty takes directory and the browser's own bookkeeping,
      // far below the take's own size.
      const slack = 64 * 1024
      await expect
        .poll(() => page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0))
        .toBeLessThanOrEqual(before + slack)
      expect(kept[0].files['primary.webm']).toBeGreaterThan(slack)
      // Nothing was saved to the library either.
      await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('a take that is stopped normally leaves nothing behind on the device', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await newContext(browser)
    try {
      const page = await openCraft(context)
      test.skip(
        !(await syncAccessHandlesAvailable(page)),
        'This browser hands workers no OPFS sync access handle, so takes are not kept on the device'
      )
      await startTake(page, false)
      // It is on the device while it records…
      await waitForKeptBytes(page, 1000)
      await page.getByRole('button', { name: 'Stop recording' }).click()
      await expect(page.getByRole('button', { name: /^Play / })).toBeVisible({ timeout: 30_000 })
      // …and gone once the library has it.
      await expect.poll(() => keptTakes(page)).toEqual([])
      expect((await storedTakeHealth(page)).size).toBeGreaterThan(1000)

      // And a fresh visit offers nothing.
      const again = await openCraft(context)
      await expect(again.getByRole('button', { name: 'Start recording' })).toBeVisible()
      await again.waitForTimeout(1500)
      await expect(recoverDialog(again)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
