import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import {
  AV_FIXTURE_TIMING,
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
 *
 * The project is the A/V fixture twice, on two tracks, both at 0 s: two clips
 * of one source live at once, so the preview needs the source's own `<video>`
 * and a second one (`previewVideoForSlot`, ESCSUITE-313). Each cycle also
 * takes both clips off the timeline and puts them back (Undo ×2, Redo ×2):
 * with no clip using the source, `usePreviewMedia.ts` revokes its blob URL
 * and empties both elements (`releaseExtraVideos`), and the redo makes a new
 * URL and new elements. So every cycle makes and releases real resources,
 * and a release that stops working shows as growth.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Live counts need a forced GC, which goes through Chromium’s DevTools protocol'
)

/**
 * A positive whole number from the environment, or `fallback`. The nightly
 * run (`.github/workflows/nightly.yml`, ESCSUITE-353) raises the counts below
 * this way; unset, the soak is the one every PR runs.
 */
function envCount(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/** The cycles the soak runs, and how often it checks. `SOAK_CYCLES` raises it. */
const CYCLES = envCount('SOAK_CYCLES', 25)
const CHECK_EVERY = 5
/** `SOAK_RELOADS` raises it. */
const RELOADS = envCount('SOAK_RELOADS', 10)

/**
 * Each test's time budget: 180 s at the PR counts, scaled with the count (7.2 s
 * per cycle, 18 s per reload) when the nightly raises it.
 */
const CYCLES_TIMEOUT = Math.max(180_000, CYCLES * 7_200)
const RELOADS_TIMEOUT = Math.max(180_000, RELOADS * 18_000)

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
 * How far each live count may rise above the baseline before the soak calls
 * it a leak.
 *
 * Measured on this spec (headless Chromium 1248, the A/V WebM, repeated
 * runs): every live count at every check equalled the baseline — objectUrl 2
 * (the source's preview URL and the library thumbnail), mediaElement 3 (the
 * source's two preview `<video>`s and `extractVideoMetadata`'s probe
 * element), every other kind 0 — while each cycle made one blob URL and two
 * `<video>`s and released as many. So the allowance is only for a release
 * that is asynchronous and caught mid-flight by a sample: one of each kind.
 * A leak of one resource per cycle has grown by 4 at the first check.
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

/** The fixture's length in seconds, the timeline's whole span here. */
const DURATION = AV_FIXTURE_TIMING.duration

/** A seek lands within this of its target: a frame plus pixel rounding. */
const TIME_TOLERANCE = 0.15

const TWO_CLIPS = /^2 clips · 2 tracks$/

function timecode(page: Page): Locator {
  return page.locator('[class*="timecode"]').first()
}

/** The playhead's time, from the preview's `mm:ss.mmm` readout. */
async function readTime(page: Page): Promise<number> {
  const text = (await timecode(page).textContent()) ?? ''
  const match = /^(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  expect(match, `unreadable timecode "${text}"`).not.toBeNull()
  return Number(match![1]) * 60 + Number(match![2])
}

async function expectTimeNear(page: Page, target: number, what: string): Promise<void> {
  await expect
    .poll(async () => Math.abs((await readTime(page)) - target), {
      message: `${what}: the playhead is not at ${target.toFixed(2)} s`,
      timeout: 3000,
    })
    .toBeLessThan(TIME_TOLERANCE)
}

/** Each clip's left edge and width: a gesture that moved a clip changes them. */
async function clipLayout(page: Page): Promise<string> {
  const boxes = await page.locator('[data-clip-id]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return `${el.getAttribute('data-clip-id')}@${Math.round(r.left)}+${Math.round(r.width)}`
    })
  )
  return boxes.sort().join(' ')
}

async function openEditorWithFixture(page: Page): Promise<void> {
  await installMediaHealthProbe(page)
  await installResourceProbe(page)
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, AV_FIXTURE_WEBM)
  // The same source again, at the playhead (0 s): a new clip on a new track,
  // over the first.
  await page.getByTitle('Go to start (Home)').click()
  await page.getByRole('button', { name: 'Add to timeline' }).click()
  await expect(page.getByText(TWO_CLIPS)).toBeVisible({ timeout: 15_000 })
  await expectWaveformDrawn(waveformCanvas(page))
}

/** Rewind, play for a second and check the preview is alive, then pause. */
async function checkPreviewPlays(page: Page): Promise<void> {
  await page.getByTitle('Go to start (Home)').click()
  await page.getByTitle('Play (Space)').click()
  await expectPreviewAlive(page, { forMs: 1000 })
  await page.getByTitle('Pause (Space)').click()
}

/**
 * The report's gestures, once — scrub, click, play a second, pause, seek —
 * then both clips off the timeline and back.
 */
async function cycle(page: Page, random: () => number, n: number): Promise<void> {
  const layout = await clipLayout(page)
  const clips = page.locator('[data-clip-id]')
  const clip = await clips.first().boundingBox()
  const ruler = await page.getByRole('group', { name: 'Timeline ruler' }).boundingBox()
  expect(clip, 'the clip is not on the timeline').not.toBeNull()
  expect(ruler, 'the timeline ruler is not on the page').not.toBeNull()
  const timeAt = (x: number) => ((x - clip!.x) / clip!.width) * DURATION

  // Scrub: grab the playhead, drag it across the clip and back to 5 %.
  const head = await page.locator('[data-playhead]').boundingBox()
  expect(head, 'the playhead is not on the page').not.toBeNull()
  const y = clip!.y + clip!.height / 2
  const scrubEnd = clip!.x + clip!.width * 0.05
  await page.mouse.move(head!.x + head!.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(clip!.x + clip!.width * 0.95, y, { steps: 8 })
  await page.mouse.move(scrubEnd, y, { steps: 8 })
  await page.mouse.up()
  await expectTimeNear(page, timeAt(scrubEnd), `cycle ${n} scrub`)
  expect(await clipLayout(page), `cycle ${n}: the scrub moved a clip`).toBe(layout)

  // A click on the ruler at a seeded point, as the report did: from 10 % to
  // 70 % of the clip, clear of where the scrub left the playhead, and early
  // enough that the second of playback after it never reaches the end.
  const clickX = clip!.x + clip!.width * (0.1 + 0.6 * random())
  await page.mouse.click(clickX, ruler!.y + ruler!.height / 2)
  await expectTimeNear(page, timeAt(clickX), `cycle ${n} ruler click`)
  expect(await clipLayout(page), `cycle ${n}: the ruler click moved a clip`).toBe(layout)

  await page.getByTitle('Play (Space)').click()
  await page.waitForTimeout(1000) // "play 1 s": the gesture itself, not a wait for something
  await page.getByTitle('Pause (Space)').click()

  // Seek: back to the start.
  await page.getByTitle('Go to start (Home)').click()
  await expectTimeNear(page, 0, `cycle ${n} seek`)

  // Both clips off the timeline, so the source's URL and elements are
  // released, and back on, so they are made again.
  const undo = page.getByRole('button', { name: 'Undo (Ctrl+Z)' })
  const redo = page.getByTitle('Redo (Ctrl+Y)')
  await undo.click()
  await undo.click()
  await expect(page.getByText(/^0 clips/).first()).toBeVisible()
  await redo.click()
  await redo.click()
  await expect(page.getByText(TWO_CLIPS)).toBeVisible()
  expect(await clipLayout(page), `cycle ${n}: undo/redo did not put the clips back`).toBe(layout)
}

/** Every IndexedDB database's record count, per store. */
function countStoredRecords(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const counts: Record<string, number> = {}
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(new Error(`open ${name} failed`))
        request.onsuccess = () => resolve(request.result)
      })
      for (const store of Array.from(db.objectStoreNames)) {
        counts[`${name}/${store}`] = await new Promise<number>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).count()
          request.onerror = () => reject(new Error(`count ${store} failed`))
          request.onsuccess = () => resolve(request.result)
        })
      }
      db.close()
    }
    return counts
  })
}

test.describe('ESCAPEARTIST resource soak (ESCSUITE-350)', () => {
  test(`${CYCLES} scrub/click/play/seek cycles leave no resource behind`, async ({ page }) => {
    test.setTimeout(CYCLES_TIMEOUT)
    await openEditorWithFixture(page)
    const random = seededRandom(SEED)

    // The baseline is read the way every later check is: after a cycle and
    // a checked playback, so both sample the same state.
    await cycle(page, random, 1)
    await checkPreviewPlays(page)
    const first = await readLiveCounts(page)
    const baseline = first.live
    const history: string[] = [
      `after cycle 1: live ${JSON.stringify(baseline)} made ${JSON.stringify(first.created)}`,
    ]

    for (let i = 2; i <= CYCLES; i++) {
      await cycle(page, random, i)
      if (i % CHECK_EVERY !== 0) continue
      await checkPreviewPlays(page)
      const now = await readLiveCounts(page)
      history.push(`after cycle ${i}: live ${JSON.stringify(now.live)} made ${JSON.stringify(now.created)}`)
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
    test.setTimeout(RELOADS_TIMEOUT)
    await openEditorWithFixture(page)
    await waitForSavedSession(page)

    // Each reload is a fresh page, so its live counts are per-page sanity;
    // the stored records are what outlives a reload, and must not pile up.
    let firstLive: ResourceCounts | null = null
    let firstStored: Record<string, number> | null = null
    const history: string[] = []
    for (let i = 1; i <= RELOADS; i++) {
      await page.reload()
      await waitForAppReady(page, 'artist')
      const prompt = page.getByRole('dialog', { name: 'Resume Previous Session?' })
      await expect(prompt, `reload ${i}: no session offered`).toBeVisible({ timeout: 15_000 })
      await prompt.getByRole('button', { name: 'Restore Session' }).click()
      await expect(page.getByText(TWO_CLIPS), `reload ${i}: the clips did not come back`).toBeVisible({
        timeout: 15_000,
      })
      await expectWaveformDrawn(waveformCanvas(page))
      await checkPreviewPlays(page)

      const now = await readLiveCounts(page)
      const stored = await countStoredRecords(page)
      history.push(`reload ${i}: live ${JSON.stringify(now.live)} stored ${JSON.stringify(stored)}`)
      firstLive ??= now.live
      firstStored ??= stored
      const growth = describeGrowth(firstLive, now, ALLOWED_GROWTH)
      expect(growth, `reload ${i}: live resources grew:\n${growth.join('\n')}\n${history.join('\n')}`).toEqual([])
      expect(stored, `reload ${i}: stored records changed across reloads:\n${history.join('\n')}`).toEqual(
        firstStored
      )
    }
    test.info().annotations.push({ type: 'per reload', description: history.join(' | ') })
  })
})

/**
 * Wait for the autosave (`app/useSessionAutosave.ts`, 2 s after the last
 * edit) to write a session holding both clips, so the reload has one to offer.
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
      { message: 'the autosave never wrote a session holding both clips', timeout: 15_000 }
    )
    .toBe(2)
}
