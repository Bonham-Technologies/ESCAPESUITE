import { test } from '@playwright/test'
import {
  PERF_PROFILE,
  PERF_RUNS,
  PLAYBACK_SECONDS,
  PLAYBACK_WARMUP_SECONDS,
  SCENE_CLIP_COUNT,
  SCENE_TRACK_COUNT,
  installPerfInstrumentation,
  loadPerfScene,
  measurePlayback,
  median,
  round,
  writePerfResult,
  type PlaybackMeasurement,
} from '../../utils/perf'

/**
 * Benchmark: preview playback of the generated 12-clip scene.
 *
 * What it answers: how many frames the preview actually composites per second
 * while two video tracks, two overlays and a transition are on screen, and what
 * it costs the main thread to do it.
 *
 * It asserts nothing. A regression shows up as a number in `perf-report.json`,
 * not as a red test — a CPU-speed threshold would fail on a slow runner and
 * pass on a fast one regardless of the code.
 */
test.describe('perf: preview playback', () => {
  test(`plays the ${SCENE_CLIP_COUNT}-clip scene for ${PLAYBACK_SECONDS}s, ${PERF_RUNS} times`, async ({
    page,
  }) => {
    await installPerfInstrumentation(page)
    await loadPerfScene(page)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    const measurements: PlaybackMeasurement[] = []
    for (let run = 0; run < PERF_RUNS; run++) {
      // Every run starts from the top of the timeline, so all three composite
      // exactly the same frames in the same order.
      await page.getByTitle('Go to start (Home)').click()
      measurements.push(await measurePlayback(page, cdp, PLAYBACK_SECONDS))
    }

    const at = (key: keyof PlaybackMeasurement) => measurements.map((m) => m[key])

    writePerfResult({
      name: 'preview-playback',
      runs: PERF_RUNS,
      scene: `${SCENE_CLIP_COUNT} clips / ${SCENE_TRACK_COUNT} tracks @ 1280x720`,
      windowSeconds: PLAYBACK_SECONDS - PLAYBACK_WARMUP_SECONDS,
      renderedFps: round(median(at('renderedFps'))),
      longTaskCount: median(at('longTaskCount')),
      longTaskTotalMs: round(median(at('longTaskTotalMs'))),
      heapDeltaBytes: median(at('heapDeltaBytes')),
      taskDurationMs: round(median(at('taskDurationMs'))),
      layoutCount: median(at('layoutCount')),
      recalcStyleCount: median(at('recalcStyleCount')),
    })

    // Visible in the Playwright log, so a run tells you its numbers without
    // opening the merged report.
    console.log('preview-playback runs:', JSON.stringify(measurements))

    // `PERF_PROFILE=1` adds a fourth, profiled window whose measurement is
    // thrown away. The sampler perturbs the very timing the medians above
    // report, so it must not be one of the three — it is an extra run that
    // exists only to produce `perf-results/preview.cpuprofile`.
    if (PERF_PROFILE) {
      await page.getByTitle('Go to start (Home)').click()
      await measurePlayback(page, cdp, PLAYBACK_SECONDS, 'preview')
    }
  })
})
