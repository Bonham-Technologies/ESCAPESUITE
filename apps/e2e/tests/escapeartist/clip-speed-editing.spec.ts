import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, inspector } from '../../utils/artist'
import { AV_FIXTURE_TIMING, AV_FIXTURE_WEBM } from '../../utils/mediaHealth'
import { waitForAppReady } from '../../utils/ready'
import {
  clipFromLeft,
  pixelsPerSecond,
  playheadSeconds,
  reopenProject,
  saveProject,
  timelineClips,
  type ClipSpan as Span,
} from '../../utils/timeline'

/**
 * Clip speed meeting the timeline's edits (ESCSUITE-522).
 *
 * ESCSUITE-471's and ESCSUITE-505's specs drive a sped clip through an export
 * only. These walk the edits a user makes around one, the way they make them,
 * and read every length off the boxes the timeline draws:
 *
 * - a 5 s clip set to 2× from the inspector, split at the playhead (Ctrl+B),
 *   its second half trimmed by its end handle, every step undone and redone;
 * - that project saved, reopened in a fresh browser, and still 2× and as long;
 * - a take recorded as two linked parts (screen and microphone, the microphone
 *   half a second late) set to 0.5×, cut, undone and redone, its rows in step.
 *
 * What each edit must do is `apps/artist/docs/reference/clip-speed.md`'s
 * "Edits on a sped clip": a clip's timeline length is its source span over its
 * speed; a split cuts the source at `sourceTimeAt` and both halves keep the
 * speed; a trim puts the edge under the pointer in timeline time and scales it into the source by the speed; and a speed change applies
 * to every linked part, scaling its offset from the group's start.
 */

/** How far a length or an edge read off the screen may be off: a pixel and a half at zoom 1 (50 px a second). */
const TOLERANCE = 0.03

/** Each of `clips`' spans, left to right, measured from the left edge of the clips' row, where 0 s is. */
async function spansOf(clips: Locator, pxPerSec: number): Promise<Span[]> {
  const boxes = await clips.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      const origin = (el.parentElement as HTMLElement).getBoundingClientRect().left
      return { left: r.left - origin, width: r.width }
    })
  )
  return boxes
    .map(({ left, width }) => ({ start: left / pxPerSec, end: (left + width) / pxPerSec }))
    .sort((a, b) => a.start - b.start)
}

/** `clips` sit at exactly `expected` (left to right), each edge within {@link TOLERANCE}. */
async function expectSpans(clips: Locator, pxPerSec: number, expected: Span[], what: string): Promise<void> {
  await expect(clips, `${what}: how many clips`).toHaveCount(expected.length)
  // Polled: a box is redrawn a frame after the store changes.
  await expect
    .poll(
      async () => {
        const spans = await spansOf(clips, pxPerSec)
        const off =
          spans.length !== expected.length ||
          spans.some(
            (s, i) => Math.abs(s.start - expected[i].start) > TOLERANCE || Math.abs(s.end - expected[i].end) > TOLERANCE
          )
        return off ? spans.map((s) => `${s.start.toFixed(3)}–${s.end.toFixed(3)}`).join(', ') : 'as expected'
      },
      { message: `${what}: clips at ${expected.map((s) => `${s.start}–${s.end}`).join(', ')} s` }
    )
    .toBe('as expected')
}

/** Every clip in `clips` says `label` where its length is (`0:02 · 2×`), or, with `null`, no speed at all. */
async function expectSpeedLabels(clips: Locator, label: string | null): Promise<void> {
  for (const clip of await clips.all()) {
    if (label === null) await expect(clip).not.toContainText('×')
    else await expect(clip).toContainText(`· ${label}`)
  }
}

/**
 * Open the inspector's Speed section (collapsed until opened) unless it is.
 * Its header says nothing of its state, so the presets' group is asked.
 */
async function openSpeedSection(page: Page): Promise<void> {
  const presets = inspector(page).getByRole('group', { name: 'Speed presets' })
  if (!(await presets.isVisible())) await inspector(page).getByRole('button', { name: /^Speed/ }).click()
  await expect(presets).toBeVisible()
}

/** Pick `label` in the inspector's Speed section, for the selected clip. */
async function pickSpeed(page: Page, label: string): Promise<void> {
  await openSpeedSection(page)
  const preset = inspector(page).getByRole('button', { name: label, exact: true })
  await preset.click()
  await expect(preset).toHaveAttribute('aria-pressed', 'true')
}

/**
 * Select `clip` and pick `label` in the inspector's Speed section. The click
 * lands in the clip's middle, clear of its trim handles, so the playhead must
 * not be there (a click on a clip also moves the playhead to it).
 */
async function setSpeedFromInspector(page: Page, clip: Locator, label: string): Promise<void> {
  await clip.click()
  await pickSpeed(page, label)
}

/**
 * Put the playhead at `seconds` (whole seconds) with Home, then ArrowRight a
 * second at a time. Each press steps from the time the transport last
 * rendered, so every step is waited for before the next press: on a slow
 * runner a press sent early would step from a stale time and be lost.
 */
async function playheadTo(page: Page, seconds: number): Promise<void> {
  for (let at = 0; at <= seconds; at++) {
    await page.keyboard.press(at === 0 ? 'Home' : 'ArrowRight')
    await expect.poll(() => playheadSeconds(page), { message: `the playhead is at ${at} s` }).toBeCloseTo(at, 3)
  }
}

/**
 * Drag `clip`'s end handle (its last 8 px) with the Selection tool to `toSec`
 * seconds of timeline: a trim puts the edge where the pointer is, measured
 * from the row's left edge, wherever on the handle it was pressed.
 */
async function trimEndTo(page: Page, clip: Locator, toSec: number, pxPerSec: number): Promise<void> {
  const box = await clip.boundingBox()
  expect(box, 'the clip to trim is not on screen').not.toBeNull()
  const origin = await clip.evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left)
  const from = box!.x + box!.width - 3
  const to = origin + toSec * pxPerSec
  const y = box!.y + box!.height / 2
  await page.mouse.move(from, y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) await page.mouse.move(from + ((to - from) * i) / steps, y)
  await page.mouse.up()
}

const undo = (page: Page) => page.keyboard.press('Control+z')
const redo = (page: Page) => page.keyboard.press('Control+y')

test.describe('Clip speed: editing a sped clip (ESCSUITE-522)', () => {
  test.beforeEach(async ({ page }) => {
    // Vercel Analytics' dev script is a third-party host: never reached from a test.
    await page.route('https://va.vercel-scripts.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    )
  })

  test('a 2× clip splits, trims, undoes and redoes by its timeline length, and keeps its speed and length through save and reopen', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000)
    const SOURCE = AV_FIXTURE_TIMING.duration // 5 s
    const SPEED = 2
    const SPLIT_AT = 1 // timeline seconds: source 2 s at 2×
    const TRIM = -0.5 // timeline seconds off the second half's end: source 1 s at 2×

    // Each state the timeline passes through, in timeline seconds.
    const unsped: Span[] = [{ start: 0, end: SOURCE }]
    const sped: Span[] = [{ start: 0, end: SOURCE / SPEED }]
    const split: Span[] = [
      { start: 0, end: SPLIT_AT },
      { start: SPLIT_AT, end: SOURCE / SPEED },
    ]
    const trimmed: Span[] = [
      { start: 0, end: SPLIT_AT },
      { start: SPLIT_AT, end: SOURCE / SPEED + TRIM },
    ]

    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, AV_FIXTURE_WEBM)
    const clips = timelineClips(page)
    const pxPerSec = await pixelsPerSecond(clips.first(), SOURCE)
    await expectSpans(clips, pxPerSec, unsped, 'imported')

    await test.step('set 2× from the inspector: the clip takes half the timeline', async () => {
      await setSpeedFromInspector(page, clips.first(), `${SPEED}×`)
      await expectSpans(clips, pxPerSec, sped, 'at 2×')
      await expectSpeedLabels(clips, `${SPEED}×`)
    })

    await test.step('split at the playhead (Ctrl+B): both halves keep 2×, cut at 1 s of timeline', async () => {
      await clips.first().click()
      await playheadTo(page, SPLIT_AT)
      await page.keyboard.press('Control+b')
      // A cut at source 1 s (the timeline time, not read through the speed)
      // would leave a 0.5 s first half here.
      await expectSpans(clips, pxPerSec, split, 'split')
      await expectSpeedLabels(clips, `${SPEED}×`)
    })

    await test.step('trim the second half by its end handle: its end lands under the pointer, in timeline time', async () => {
      // The playhead sits at 1 s, clear of the handle at the second half's end (2.5 s).
      await trimEndTo(page, await clipFromLeft(page, 1), SOURCE / SPEED + TRIM, pxPerSec)
      await expectSpans(clips, pxPerSec, trimmed, 'trimmed')
      await expectSpeedLabels(clips, `${SPEED}×`)
    })

    await test.step('undo the trim, the split and the speed, one step each', async () => {
      await undo(page)
      await expectSpans(clips, pxPerSec, split, 'trim undone')
      await expectSpeedLabels(clips, `${SPEED}×`)
      await undo(page)
      await expectSpans(clips, pxPerSec, sped, 'split undone')
      await expectSpeedLabels(clips, `${SPEED}×`)
      await undo(page)
      await expectSpans(clips, pxPerSec, unsped, 'speed undone')
      await expectSpeedLabels(clips, null)
    })

    await test.step('redo the speed, the split and the trim, one step each', async () => {
      await redo(page)
      await expectSpans(clips, pxPerSec, sped, 'speed redone')
      await expectSpeedLabels(clips, `${SPEED}×`)
      await redo(page)
      await expectSpans(clips, pxPerSec, split, 'split redone')
      await redo(page)
      await expectSpans(clips, pxPerSec, trimmed, 'trim redone')
      await expectSpeedLabels(clips, `${SPEED}×`)
    })

    const saved = await test.step('save the project', () => saveProject(page))

    await test.step('reopen it in a fresh browser: both pieces are still 2× and as long', async () => {
      const { page: reopened, context } = await reopenProject(browser, saved)
      try {
        const reopenedClips = timelineClips(reopened)
        await expect(reopenedClips).toHaveCount(2)
        // Re-measured, not carried over: the scale is the first piece's
        // width over the length it had when saved, checked against the
        // second piece's.
        const reopenedPxPerSec = await pixelsPerSecond(await clipFromLeft(reopened, 0), SPLIT_AT)
        expect(reopenedPxPerSec, 'the reopened timeline is at the same zoom').toBeCloseTo(pxPerSec, 0)
        await expectSpans(reopenedClips, reopenedPxPerSec, trimmed, 'reopened')
        await expectSpeedLabels(reopenedClips, `${SPEED}×`)

        // The inspector reads the reopened clip's speed as 2×.
        const second = await clipFromLeft(reopened, 1)
        await second.click()
        await openSpeedSection(reopened)
        await expect(inspector(reopened).getByRole('button', { name: `${SPEED}×`, exact: true })).toHaveAttribute(
          'aria-pressed',
          'true'
        )

        // And it kept its source span: set back to 1×, the trimmed half plays
        // the 2 s of source it holds (source 2–4 s), so the split cut the
        // source at 2 s and the trim took 1 s of source off its end.
        await pickSpeed(reopened, '1×')
        await expectSpans(
          reopenedClips,
          reopenedPxPerSec,
          [
            { start: 0, end: SPLIT_AT },
            { start: SPLIT_AT, end: SPLIT_AT + (SOURCE / SPEED + TRIM - SPLIT_AT) * SPEED },
          ],
          'reopened, second half at 1×'
        )
      } finally {
        await context.close()
      }
    })
  })

  test.describe('a take recorded as linked screen and microphone parts', () => {
    test.skip(
      ({ browserName }) => browserName === 'webkit',
      'WebKit cannot store Blobs in IndexedDB under Playwright, so the take cannot be seeded'
    )

    const DB_NAME = 'video-editor-db'
    /** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
    const DB_VERSION = 1
    const TAKE_ID = 'e2e-522-screen'
    const TAKE_SECONDS = 4
    /** The microphone started this long after the screen. */
    const MIC_OFFSET = 0.5

    /**
     * The take ESCAPECRAFT writes for a separate-tracks recording, as
     * `ESCSUITE-355.spec.ts` seeds it. Its bytes are placeholders: nothing
     * here plays it, and a speed is set on clips whatever their bytes.
     */
    const TAKE_PARTS = [
      {
        id: TAKE_ID,
        name: 'Talk',
        duration: TAKE_SECONDS,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/webm',
        size: 2048,
        mediaType: 'video',
        source: 'recording',
        recordedAt: 1_700_000_000_000,
        hasAudio: false,
        takeId: TAKE_ID,
        role: 'screen',
        startOffset: 0,
      },
      {
        id: 'e2e-522-mic',
        name: 'Talk — microphone',
        duration: TAKE_SECONDS,
        width: 0,
        height: 0,
        frameRate: 0,
        mimeType: 'audio/webm',
        size: 1024,
        mediaType: 'audio',
        source: 'recording',
        recordedAt: 1_700_000_000_001,
        hasAudio: true,
        takeId: TAKE_ID,
        role: 'mic',
        startOffset: MIC_OFFSET,
      },
    ]

    async function seedTake(page: Page) {
      await page.evaluate(
        ({ dbName, dbVersion, parts }) =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(dbName, dbVersion)
            request.onupgradeneeded = () => {
              const db = request.result
              if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' })
              if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' })
              if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
              if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
            }
            request.onerror = () => reject(new Error(`seed open failed: ${String(request.error)}`))
            request.onsuccess = () => {
              const db = request.result
              const tx = db.transaction('videos', 'readwrite')
              const store = tx.objectStore('videos')
              for (const metadata of parts) {
                store.put({
                  id: metadata.id,
                  blob: new Blob([new Uint8Array([26, 69, 223, 163])], { type: metadata.mimeType }),
                  metadata,
                })
              }
              tx.oncomplete = () => resolve()
              tx.onerror = () => reject(new Error(`seed write failed: ${String(tx.error)}`))
            }
          }),
        { dbName: DB_NAME, dbVersion: DB_VERSION, parts: TAKE_PARTS }
      )
    }

    /** The screen clips (`Talk`, `Talk (2)`), not the microphone's. */
    const screenClips = (page: Page) => timelineClips(page).filter({ hasText: /^Talk(?! —)/ })
    const micClips = (page: Page) => timelineClips(page).filter({ hasText: /microphone/ })

    test.beforeEach(async ({ page }) => {
      await page.goto(ARTIST_URL)
      await seedTake(page)
      await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
      await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })
    })

    test('at 0.5× both parts double in length, the microphone stays half a second (now one second) behind, and a cut, undo and redo keep them in step', async ({
      page,
    }) => {
      // About fifty polled checks; one CI worker can be slow.
      test.setTimeout(60_000)
      const SPEED = 0.5
      const CUT_AT = 3 // timeline seconds
      const pxPerSec = await pixelsPerSecond(screenClips(page).first(), TAKE_SECONDS)
      const screen = screenClips(page)
      const mic = micClips(page)

      const asImported = {
        screen: [{ start: 0, end: TAKE_SECONDS }],
        mic: [{ start: MIC_OFFSET, end: MIC_OFFSET + TAKE_SECONDS }],
      }
      // Each part keeps its source span, so plays for span / speed; the
      // microphone's offset from the take's start is scaled by 1 / speed.
      const slowed = {
        screen: [{ start: 0, end: TAKE_SECONDS / SPEED }],
        mic: [{ start: MIC_OFFSET / SPEED, end: (MIC_OFFSET + TAKE_SECONDS) / SPEED }],
      }
      // A cut of the screen at 3 s cuts the microphone at the same timeline time.
      const cut = {
        screen: [
          { start: 0, end: CUT_AT },
          { start: CUT_AT, end: TAKE_SECONDS / SPEED },
        ],
        mic: [
          { start: MIC_OFFSET / SPEED, end: CUT_AT },
          { start: CUT_AT, end: (MIC_OFFSET + TAKE_SECONDS) / SPEED },
        ],
      }
      const expectTake = async (state: { screen: Span[]; mic: Span[] }, what: string, label: string | null) => {
        await expectSpans(screen, pxPerSec, state.screen, `${what}, screen`)
        await expectSpans(mic, pxPerSec, state.mic, `${what}, microphone`)
        await expectSpeedLabels(screen, label)
        await expectSpeedLabels(mic, label)
      }

      await expectTake(asImported, 'imported', null)

      await test.step('set 0.5× on the screen part: the microphone follows', async () => {
        await setSpeedFromInspector(page, screen.first(), `${SPEED}×`)
        await expect(inspector(page).getByText('Its linked parts change speed with it.')).toBeVisible()
        await expectTake(slowed, 'at 0.5×', `${SPEED}×`)
      })

      await test.step('cut the take at the playhead (Ctrl+B): both rows are cut at 3 s', async () => {
        await screen.first().click()
        await playheadTo(page, CUT_AT)
        await page.keyboard.press('Control+b')
        await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()
        await expectTake(cut, 'cut', `${SPEED}×`)
      })

      await test.step('undo the cut and the speed, then redo both: the rows stay in step throughout', async () => {
        await undo(page)
        await expectTake(slowed, 'cut undone', `${SPEED}×`)
        await undo(page)
        await expectTake(asImported, 'speed undone', null)
        await redo(page)
        await expectTake(slowed, 'speed redone', `${SPEED}×`)
        await redo(page)
        await expectTake(cut, 'cut redone', `${SPEED}×`)
      })
    })
  })
})
