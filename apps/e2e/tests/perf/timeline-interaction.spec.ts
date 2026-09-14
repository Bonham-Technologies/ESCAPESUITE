import { expect, test, type Page } from '@playwright/test'
import {
  GESTURE_MOVES,
  PERF_PROFILE,
  PERF_RUNS,
  SCENE_CLIP_COUNT,
  SCENE_RESOLUTION_LABEL,
  SCENE_TRACK_COUNT,
  installPerfInstrumentation,
  loadPerfScene,
  measureGesture,
  median,
  postPerfScene,
  round,
  writePerfResult,
  type GestureMeasurement,
  type GestureSpec,
} from '../../utils/perf'

/**
 * Benchmark: the timeline's three pointer gestures over the generated scene.
 *
 * What it answers: what one pointer frame of a clip drag, a rubber-band
 * selection and a playhead scrub costs the main thread while 14 clips sit on
 * four tracks — how much JavaScript it runs, and how many forced layouts and
 * style recalculations it provokes.
 *
 * `layoutsPerFrame` is the headline. A gesture handler that measures the
 * container and then every track row on every pointer move forces a synchronous
 * layout per measurement, and that is the cost a slow machine feels as a drag
 * that lags behind the pointer. `jsMsPerFrame` is the same work in milliseconds
 * on this machine; the layout count is the part that does not depend on the CPU.
 *
 * It asserts nothing about the numbers. A regression shows up in
 * `perf-report.json`, not as a red test — a threshold in milliseconds would fail
 * on a slow runner and pass on a fast one regardless of the code. It does assert
 * that each gesture *did something* (see `probe` on each spec below): a drag the
 * store vetoed, a marquee that selected nothing or a scrub that missed the
 * playhead would otherwise report a very respectable cost for doing nothing.
 *
 * Determinism:
 *
 * - Every run re-installs the scene through `LOAD_PROJECT` and puts the
 *   selection and the playhead back, so all three runs start from the same
 *   timeline and move the same clip from the same place.
 * - Moves are `page.mouse.move`, one `mousemove` each, rather than `dragTo` —
 *   the frame count is the benchmark's, not a helper's interpolation.
 * - The press and the first move after it are outside the measured window (see
 *   `measureGesture`), so a gesture's one-off start-up is not averaged into its
 *   per-frame figures.
 * - Geometry is read from the page rather than hard-coded: the benchmark asks
 *   where the clip, the track rows, the ruler and the playhead actually are and
 *   works in their coordinates.
 */

/** The timeline's default scale: one second is 50 px at zoom 1. */
const PIXELS_PER_SECOND = 50

/**
 * Where the clip drag drops `perf-clip-0`, in seconds.
 *
 * Past the 13 s scene, so the commit cannot be vetoed for an overlap — every
 * second of both media tracks between 0 and 13 is occupied, and a vetoed drag
 * would leave the clip where it started and trip the gesture's own probe. Also
 * far enough from the last clip edge at 13 s that the 10 px snap threshold
 * (0.2 s at this scale) cannot pull the drop back onto it.
 */
const DROP_SECONDS = 14

/** Where the marquee presses: empty track space, right of every clip. */
const MARQUEE_ORIGIN_SECONDS = 15

/** The far corner of the rectangle the marquee's pointer walks around. */
const MARQUEE_FAR_SECONDS = 4

/**
 * Where the marquee's last leg stops.
 *
 * Between the two corners, so the rectangle the release selects with is
 * 9.5 s–15 s over both media rows rather than the degenerate one a path that
 * returned to its own origin would leave behind.
 */
const MARQUEE_FINISH_SECONDS = 9.5

/** Where the playhead sits before a scrub, and where the scrub takes it. */
const SCRUB_FROM_SECONDS = 2
const SCRUB_TO_SECONDS = 12

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

interface TimelineGeometry {
  /** The scrolling track area, and how far it is scrolled. */
  container: Box & { scrollLeft: number; scrollTop: number }
  /** The ruler, for the click that parks the playhead before a scrub. */
  ruler: Box
  /** `perf-clip-0` — the clip the drag picks up. */
  clip0: Box
  /** The `V1` row (`perf-track-0`): the bottom media track. */
  v1: Box
  /** The `V2` row (`perf-track-1`): the media track above it. */
  v2: Box
}

/**
 * Ask the page where everything is.
 *
 * Read once, after the scene is loaded and before any gesture runs: nothing
 * these boxes describe moves between runs, because every run puts the timeline
 * back the way it found it.
 */
async function readTimelineGeometry(page: Page): Promise<TimelineGeometry> {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }
    const find = (selector: string) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`perf: no element matches ${selector}`)
      return element
    }

    // The track rows live in `.tracksContent`, which lives in the scrolling
    // `.trackContainer`. Walked rather than named, because both are CSS-module
    // class names and a benchmark should not depend on the hash Vite gave them.
    const row = find('[data-track-id]')
    const container = row.parentElement?.parentElement
    if (!container) throw new Error('perf: the track rows have no scrolling container')

    return {
      container: {
        ...box(container),
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      },
      ruler: box(find('[aria-label="Timeline ruler"]')),
      clip0: box(find('[data-clip-id="perf-clip-0"]')),
      v1: box(find('[data-track-id="perf-track-0"]')),
      v2: box(find('[data-track-id="perf-track-1"]')),
    }
  })
}

// ---------------------------------------------------------------------------
// Probes: what each gesture is supposed to change
// ---------------------------------------------------------------------------

/** The dragged clip's track and its left offset, as the DOM shows them. */
const clipPositionProbe = () => {
  const element = document.querySelector('[data-clip-id="perf-clip-0"]') as HTMLElement | null
  if (!element) return 'perf-clip-0 is not rendered'
  const track = element.closest('[data-track-id]')?.getAttribute('data-track-id') ?? 'none'
  return `${track}@${element.style.left}`
}

/**
 * Every clip's class list.
 *
 * Deliberately not "how many clips carry the selected class": the class names
 * are CSS-module hashes, and comparing the whole snapshot asks only whether the
 * selection changed the DOM at all, which is what the assertion means.
 */
const selectionProbe = () =>
  Array.from(document.querySelectorAll('[data-clip-id]'))
    .map((element) => `${element.getAttribute('data-clip-id')}:${element.className}`)
    .join('|')

/** Where the playhead is drawn. */
const playheadProbe = () => {
  const element = document.querySelector('[data-playhead]') as HTMLElement | null
  return element ? element.style.left : 'the playhead is not rendered'
}

test.describe('perf: timeline interaction', () => {
  test(`drags, marquees and scrubs the ${SCENE_CLIP_COUNT}-clip scene, ${GESTURE_MOVES} moves x ${PERF_RUNS} runs`, async ({
    page,
  }) => {
    await installPerfInstrumentation(page)
    const sourceVideoId = await loadPerfScene(page)

    const geometry = await readTimelineGeometry(page)
    const { container, ruler, clip0, v1, v2 } = geometry

    /** Viewport X of a timeline time, in the track container's coordinates. */
    const timeX = (seconds: number) =>
      container.left - container.scrollLeft + seconds * PIXELS_PER_SECOND
    const centreY = (box: Box) => box.top + box.height / 2

    const grab = { x: clip0.left + clip0.width / 2, y: centreY(clip0) }
    /** How far into the clip the pointer took hold — the drag's own offset. */
    const grabOffset = grab.x - clip0.left

    // Everything the gestures touch has to be inside the visible track area, or
    // the pointer would land on whatever is clipping it and the benchmark would
    // measure the wrong thing. Asserted rather than assumed: the viewport is
    // fixed by playwright.perf.config.ts, so this can only break if the editor's
    // layout changes — and then it should say so loudly, here, rather than as a
    // gesture that quietly did nothing.
    for (const [what, x] of [
      ['the clip drop', timeX(DROP_SECONDS) + grabOffset],
      ['the marquee origin', timeX(MARQUEE_ORIGIN_SECONDS)],
      ['the scrub end', timeX(SCRUB_TO_SECONDS)],
    ] as const) {
      expect(
        x,
        `${what} at x=${round(x)} is outside the visible track area ` +
          `(${round(container.left)}..${round(container.right)}) — the timeline got narrower`
      ).toBeLessThan(container.right)
    }
    for (const [what, box] of [
      ['the V1 row', v1],
      ['the V2 row', v2],
    ] as const) {
      expect(
        centreY(box),
        `${what} is not inside the visible track area — the timeline panel got shorter`
      ).toBeLessThan(container.bottom)
    }

    /** Linear interpolation, `t` running 0..1. */
    const mix = (from: number, to: number, t: number) => from + (to - from) * t
    /** Linear interpolation over the gesture's `GESTURE_MOVES` samples. */
    const along = (from: number, to: number, i: number) => mix(from, to, i / GESTURE_MOVES)

    const gestures: { spec: GestureSpec; reset: () => Promise<void> }[] = [
      {
        // Grab `perf-clip-0` at its centre and take it across the scene and up
        // onto `perf-track-1`, the media track above it (tracks are stacked
        // highest index first, so V2 is drawn above V1).
        spec: {
          name: 'clipDrag',
          origin: grab,
          point: (i) => ({
            x: along(grab.x, timeX(DROP_SECONDS) + grabOffset, i),
            y: along(grab.y, centreY(v2), i),
          }),
          probe: clipPositionProbe,
        },
        reset: async () => {
          await resetScene(page, sourceVideoId, geometry)
        },
      },
      {
        // Press on empty track space right of every clip, then walk three sides
        // of a rectangle over the two media rows — left along the bottom, up
        // the left edge, back right along the top — stopping half way so the
        // rectangle the release selects with really has an area and really does
        // span both rows. (A path that closed the loop would finish where it
        // started, and a marquee whose two corners coincide selects nothing.)
        spec: {
          name: 'marquee',
          origin: { x: timeX(MARQUEE_ORIGIN_SECONDS), y: centreY(v1) },
          point: (i) => {
            const t = i / GESTURE_MOVES
            const near = timeX(MARQUEE_ORIGIN_SECONDS)
            const far = timeX(MARQUEE_FAR_SECONDS)
            const finish = timeX(MARQUEE_FINISH_SECONDS)
            if (t < 1 / 3) return { x: mix(near, far, t * 3), y: centreY(v1) }
            if (t < 2 / 3) return { x: far, y: mix(centreY(v1), centreY(v2), t * 3 - 1) }
            return { x: mix(far, finish, t * 3 - 2), y: centreY(v2) }
          },
          probe: selectionProbe,
        },
        reset: async () => {
          await resetScene(page, sourceVideoId, geometry)
        },
      },
      {
        // Grab the playhead where the ruler click parked it and scrub right.
        spec: {
          name: 'playheadScrub',
          origin: { x: timeX(SCRUB_FROM_SECONDS), y: centreY(v2) },
          point: (i) => ({
            x: along(timeX(SCRUB_FROM_SECONDS), timeX(SCRUB_TO_SECONDS), i),
            y: centreY(v2),
          }),
          probe: playheadProbe,
        },
        reset: async () => {
          await resetScene(page, sourceVideoId, geometry)
          // Park the playhead inside the track area before grabbing it. At time
          // 0 it is drawn hard against the container's left edge, where half of
          // its handle is clipped and a press at its centre is a coin toss
          // between the playhead and whatever is behind it.
          await page.mouse.click(ruler.left + SCRUB_FROM_SECONDS * PIXELS_PER_SECOND, centreY(ruler))
          await expect(page.locator('[data-playhead]')).toHaveCSS(
            'left',
            `${SCRUB_FROM_SECONDS * PIXELS_PER_SECOND}px`
          )
        },
      },
    ]

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    const measured: Record<string, GestureMeasurement[]> = {}
    for (const { spec, reset } of gestures) {
      const runs: GestureMeasurement[] = []
      for (let run = 0; run < PERF_RUNS; run++) {
        await reset()
        runs.push(await measureGesture(page, cdp, spec))
      }
      measured[spec.name] = runs
    }

    const summary: Record<string, number> = {}
    for (const [name, runs] of Object.entries(measured)) {
      const at = (key: keyof GestureMeasurement) => runs.map((run) => run[key])
      summary[`${name}MoveEvents`] = median(at('moveEvents'))
      summary[`${name}WallMs`] = round(median(at('wallMs')))
      summary[`${name}TaskDurationMs`] = round(median(at('taskDurationMs')))
      summary[`${name}JsMsPerFrame`] = round(median(at('jsMsPerFrame')), 3)
      summary[`${name}LayoutCount`] = median(at('layoutCount'))
      summary[`${name}LayoutsPerFrame`] = round(median(at('layoutsPerFrame')))
      summary[`${name}RecalcStyleCount`] = median(at('recalcStyleCount'))
      summary[`${name}RecalcsPerFrame`] = round(median(at('recalcsPerFrame')))
      summary[`${name}LongTaskCount`] = median(at('longTaskCount'))
      summary[`${name}LongTaskTotalMs`] = round(median(at('longTaskTotalMs')))
      summary[`${name}HeapDeltaBytes`] = median(at('heapDeltaBytes'))
    }

    writePerfResult({
      name: 'timeline-interaction',
      runs: PERF_RUNS,
      scene: `${SCENE_CLIP_COUNT} clips / ${SCENE_TRACK_COUNT} tracks @ ${SCENE_RESOLUTION_LABEL}`,
      moves: GESTURE_MOVES,
      ...summary,
    })

    // Visible in the Playwright log, so a run tells you its numbers — and its
    // run-to-run spread, which the medians above hide — without opening the
    // merged report.
    console.log('timeline-interaction runs:', JSON.stringify(measured))

    // `PERF_PROFILE=1` adds a fourth, profiled run per gesture whose measurement
    // is thrown away. The sampler perturbs exactly the timing the medians above
    // report, so it must not be one of the three — it exists only to produce
    // `perf-results/timeline-<gesture>.cpuprofile`.
    if (PERF_PROFILE) {
      for (const { spec, reset } of gestures) {
        await reset()
        await measureGesture(page, cdp, spec, `timeline-${spec.name}`)
      }
    }
  })
})

/**
 * Put the timeline back the way every run needs to find it.
 *
 * `LOAD_PROJECT` restores the clips — `setProject` is a project-level
 * replacement, so a clip the last run dragged to 14 s is back at 0 s on its own
 * track. It does *not* touch the selection or the playhead, so both are reset
 * through the app's own handlers: a click on empty track space deselects and
 * seeks, and the transport's Home button takes the playhead to 0.
 */
async function resetScene(
  page: Page,
  sourceVideoId: string,
  { container }: TimelineGeometry
): Promise<void> {
  await postPerfScene(page, sourceVideoId)
  await expect(page.locator('[data-clip-id="perf-clip-0"]')).toHaveCSS('left', '0px')
  await page.mouse.click(
    container.left - container.scrollLeft + MARQUEE_ORIGIN_SECONDS * PIXELS_PER_SECOND,
    container.top + 4
  )
  await page.getByTitle('Go to start (Home)').click()
}
