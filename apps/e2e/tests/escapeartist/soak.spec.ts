import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import {
  AV_FIXTURE_WEBM,
  expectPreviewAlive,
  expectWaveformDrawn,
  installMediaHealthProbe,
  waveformCanvas,
} from '../../utils/mediaHealth'
import {
  RESOURCE_KINDS,
  describeGrowth,
  installResourceProbe,
  readLiveCounts,
  type ResourceCounts,
} from '../../utils/resourceProbe'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-350: a user clicked the timeline while scrubbing and the preview
 * froze; a reload brought it back "five or six times", then stopped. That is
 * an exhausted resource. This soak drives the gestures from the report over
 * and over and asserts the page's live media resources stay flat, and that
 * the preview keeps playing, across many cycles and many reloads.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Live counts need a forced GC, which goes through Chromium’s DevTools protocol'
)

/** The cycles the soak runs, and how often it checks. */
const CYCLES = 25
const CHECK_EVERY = 5
const RELOADS = 10

/** Seeded, so a failing run is replayed exactly by rerunning it. */
const SEED = 350

/** mulberry32: a tiny seeded PRNG, uniform on [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * How far each live count may rise above its value after cycle 1 before the
 * soak calls it a leak.
 *
 * Measured on this spec (headless Chromium, the A/V WebM, four runs): every
 * live count after cycles 5, 10, 15, 20 and 25 equalled its value after
 * cycle 1 — objectUrl 2, mediaElement 2, every other kind 0. The cycles make
 * no tracked resource at all: the preview reuses the source's one `<video>`
 * and one blob URL (the other URL is the library tile's thumbnail, the other
 * element `extractVideoMetadata`'s probe, both from the import). So the
 * allowance is only for a resource whose release is asynchronous and is
 * caught mid-flight by a sample: one of each kind. A leak of one resource per
 * cycle has grown by 4 at the first check, past it.
 */
const ALLOWED_GROWTH: ResourceCounts = {
  audioContext: 1,
  offlineAudioContext: 1,
  videoDecoder: 1,
  audioDecoder: 1,
  worker: 1,
  objectUrl: 1,
  mediaElement: 1,
}

async function openEditorWithFixture(page: Page): Promise<void> {
  await installMediaHealthProbe(page)
  await installResourceProbe(page)
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, AV_FIXTURE_WEBM)
  await expectWaveformDrawn(waveformCanvas(page))
}

/** Rewind, play for a second and check the preview is alive, then pause. */
async function checkPreviewPlays(page: Page): Promise<void> {
  await page.getByTitle('Go to start (Home)').click()
  await page.getByTitle('Play (Space)').click()
  await expectPreviewAlive(page, { forMs: 1000 })
  await page.getByTitle('Pause (Space)').click()
}

/** The report's gestures, once: scrub, click, play a second, pause, seek. */
async function cycle(page: Page, random: () => number): Promise<void> {
  const clip = await page.locator('[data-clip-id]').first().boundingBox()
  const ruler = await page.getByRole('group', { name: 'Timeline ruler' }).boundingBox()
  expect(clip, 'the clip is not on the timeline').not.toBeNull()
  expect(ruler, 'the timeline ruler is not on the page').not.toBeNull()

  // Scrub: grab the playhead and drag it across the clip and back.
  const head = await page.locator('[data-playhead]').boundingBox()
  expect(head, 'the playhead is not on the page').not.toBeNull()
  const y = clip!.y + clip!.height / 2
  await page.mouse.move(head!.x + head!.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(clip!.x + clip!.width * 0.95, y, { steps: 8 })
  // A click on the ruler at a seeded point, as the report did: in the first
  // 70 % of the 5 s clip, so the second of playback after it never reaches
  // the end and stops on its own.
  const clickX = clip!.x + clip!.width * 0.7 * random()
  await page.mouse.move(clip!.x + clip!.width * 0.05, y, { steps: 8 })
  await page.mouse.up()
  await page.mouse.click(clickX, ruler!.y + ruler!.height / 2)

  await page.getByTitle('Play (Space)').click()
  await page.waitForTimeout(1000) // "play 1 s": the gesture itself, not a wait for something
  await page.getByTitle('Pause (Space)').click()
  await page.getByTitle('Step backward (←)').click()
}

test.describe('ESCAPEARTIST resource soak (ESCSUITE-350)', () => {
  test(`${CYCLES} scrub/click/play/seek cycles leave no resource behind`, async ({ page }) => {
    test.setTimeout(120_000)
    await openEditorWithFixture(page)
    const random = seededRandom(SEED)

    await cycle(page, random)
    const baseline = (await readLiveCounts(page)).live
    const history: string[] = [`after cycle 1: ${JSON.stringify(baseline)}`]

    for (let i = 2; i <= CYCLES; i++) {
      await cycle(page, random)
      if (i % CHECK_EVERY !== 0) continue
      await checkPreviewPlays(page)
      const now = await readLiveCounts(page)
      history.push(`after cycle ${i}: ${JSON.stringify(now.live)}`)
      const growth = describeGrowth(baseline, now, ALLOWED_GROWTH)
      expect(
        growth,
        `live resources grew over ${i} cycles (seed ${SEED}):\n${growth.join('\n')}\n${history.join('\n')}`
      ).toEqual([])
    }
    // On the report, so a passing run still shows what it measured.
    test.info().annotations.push({ type: 'live counts', description: history.join(' | ') })
    expect(Object.keys(baseline).sort()).toEqual([...RESOURCE_KINDS].sort())
  })

  test(`the restored session plays and draws its waveform across ${RELOADS} reloads`, async ({ page }) => {
    test.setTimeout(150_000)
    await openEditorWithFixture(page)
    await waitForSavedSession(page)

    for (let i = 1; i <= RELOADS; i++) {
      await page.reload()
      await waitForAppReady(page, 'artist')
      const prompt = page.getByRole('dialog', { name: 'Resume Previous Session?' })
      await expect(prompt, `reload ${i}: no session offered`).toBeVisible({ timeout: 15_000 })
      await prompt.getByRole('button', { name: 'Restore Session' }).click()
      await expect(page.getByText(/^1 clip · 1 track$/), `reload ${i}: the clip did not come back`).toBeVisible({
        timeout: 15_000,
      })
      await expectWaveformDrawn(waveformCanvas(page))
      await checkPreviewPlays(page)
    }
  })
})

/**
 * Wait for the autosave (`app/useSessionAutosave.ts`, 2 s after the last
 * edit) to write a session holding the clip, so the reload has one to offer.
 */
async function waitForSavedSession(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const request = indexedDB.open('video-editor-db')
              request.onerror = () => reject(new Error('open failed'))
              request.onsuccess = () => {
                const db = request.result
                const all = db.transaction('settings', 'readonly').objectStore('settings').getAll()
                all.onerror = () => reject(new Error('read failed'))
                all.onsuccess = () => {
                  const sessions = all.result as Array<{ project?: { timeline?: { clips?: unknown[] } } }>
                  resolve(Math.max(0, ...sessions.map((s) => s?.project?.timeline?.clips?.length ?? 0)))
                  db.close()
                }
              }
            })
        ),
      { message: 'the autosave never wrote a session holding the clip', timeout: 15_000 }
    )
    .toBeGreaterThan(0)
}
