import { test } from '@playwright/test'
import {
  CAPTURE_SIZE_LABEL,
  TAKE_SECONDS,
  TAKE_WINDOW_SECONDS,
  installCraftPerfInstrumentation,
  measureMp4Conversion,
  measureTake,
  openCraft,
  recordPlainTake,
  type Mp4ConversionMeasurement,
  type TakeMeasurement,
} from '../../utils/craftPerf'
import { PERF_PROFILE, PERF_RUNS, median, round, writePerfResult } from '../../utils/perf'
import { canConvertToMp4 } from '../../utils/webcodecs'

/**
 * Benchmarks: what ESCAPECRAFT costs while it is recording, and while it is
 * converting a recording to MP4.
 *
 * Three benchmarks, one per pipeline the app actually has:
 *
 * | Benchmark | Path under test |
 * |---|---|
 * | `craft-screen-recording` | `WebCodecsRecorder` — every captured frame handed to `VideoEncoder.encode` on the main thread |
 * | `craft-pip-recording` | `Compositor` + MediaRecorder — an rAF draw loop on the main thread, encoding off it |
 * | `craft-mp4-conversion` | `convertToMP4` — decode, draw, `VideoFrame`, encode, mux, all in the page |
 *
 * Each is its own `test()` with its own page load, so one failing (no H.264
 * encoder on a runner, a capture device that would not open) still leaves the
 * others' numbers in the report — the same arrangement as the two export
 * benchmarks.
 *
 * They assert nothing about speed. The only `expect`s are inside
 * `utils/craftPerf.ts`, and every one of the six says the benchmark measured
 * the wrong thing rather than that the machine was slow: a take that stopped
 * mid-window; a "WebCodecs" take that encoded nothing, or that drew video into
 * a canvas at all (which would mean `WebCodecsRecorder` had taken its
 * `startVideoElementCapture` fallback); a PiP take that composited nothing, or
 * whose `videoDraws` came out odd (which would mean a capture track was not
 * ready for some frames, so the two-draws-per-composited-frame divisor is
 * wrong); and a conversion that encoded no frames.
 *
 * The capture devices are `mockSyntheticMedia`'s canvas and oscillator, which
 * means a 33 ms `setInterval` painting the source canvas runs on the page's own
 * main thread inside every measured window here. It is identical in every arm
 * of any comparison and small next to a 720p encode, but it is not nothing —
 * see `docs/performance/2026-09-17-craft-baseline.md`.
 */

const TAKE_MODES = [
  {
    name: 'craft-screen-recording',
    title: 'screen',
    webcam: false,
    mode: 'screen',
    recorder: 'webcodecs',
    profile: 'craft-screen',
  },
  {
    name: 'craft-pip-recording',
    title: 'PiP (screen + webcam)',
    webcam: true,
    mode: 'screen + webcam (PiP)',
    recorder: 'mediarecorder',
    profile: 'craft-pip',
  },
] as const

for (const arm of TAKE_MODES) {
  test.describe(`perf: ESCAPECRAFT ${arm.title} recording`, () => {
    test(`records ${TAKE_SECONDS}s ${arm.title} takes at ${CAPTURE_SIZE_LABEL}, ${PERF_RUNS} times`, async ({
      page,
    }) => {
      await installCraftPerfInstrumentation(page)
      await openCraft(page, { webcam: arm.webcam })

      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')

      const measurements: TakeMeasurement[] = []
      for (let run = 0; run < PERF_RUNS; run++) {
        // Every run is a fresh take on the same page, so the recordings list
        // grows a row each time — which is what a user's second and third take
        // sees too. Nothing is cleared between runs on purpose: a benchmark
        // that reset the library every time would measure a state only the
        // first take of a session is ever in.
        measurements.push(await measureTake(page, cdp, { webcam: arm.webcam }))
      }

      const at = (key: keyof TakeMeasurement) => measurements.map((m) => m[key])

      writePerfResult({
        name: arm.name,
        runs: PERF_RUNS,
        mode: arm.mode,
        recorder: arm.recorder,
        captureSize: CAPTURE_SIZE_LABEL,
        windowSeconds: TAKE_WINDOW_SECONDS,
        // Three of the six numbers below are a hard zero in each mode —
        // `framesEncoded`/`framesPerSecond`/`encoderQueueHighWater` for PiP,
        // `compositedFps`/`videoDraws`/`videoDrawsPerSecond` for screen — and
        // they are written out anyway so both rows have the same JSON shape.
        // A reader of the table has six rows to skip; a reader of the JSON has
        // one schema instead of two, and `headline()` can pick the mode's real
        // rate by asking which of them is non-zero. `measureTake` explains why
        // each zero is a zero rather than an unobservable.
        framesEncoded: median(at('framesEncoded')),
        framesPerSecond: round(median(at('framesPerSecond'))),
        videoDraws: median(at('videoDraws')),
        videoDrawsPerSecond: round(median(at('videoDrawsPerSecond'))),
        compositedFps: round(median(at('compositedFps'))),
        rafPerSecond: round(median(at('rafPerSecond'))),
        taskDurationMs: round(median(at('taskDurationMs'))),
        taskMsPerFrame: round(median(at('taskMsPerFrame')), 3),
        layoutCount: median(at('layoutCount')),
        recalcStyleCount: median(at('recalcStyleCount')),
        longTaskCount: median(at('longTaskCount')),
        longTaskTotalMs: round(median(at('longTaskTotalMs'))),
        heapDeltaBytes: median(at('heapDeltaBytes')),
        // A high-water mark, like `export.spec.ts` reports: the deepest the
        // queue got in any run, not the middling run's depth.
        encoderQueueHighWater: Math.max(...at('encoderQueueHighWater')),
        outputBytes: median(at('outputBytes')),
      })

      // Visible in the Playwright log, so a run tells you its numbers without
      // opening the merged report.
      console.log(`${arm.name} runs:`, JSON.stringify(measurements))

      // `PERF_PROFILE=1` adds a fourth, profiled take whose measurement is
      // thrown away — the sampler perturbs the very timing the medians above
      // report, so it must not be one of the three. It exists only to produce
      // `perf-results/${arm.profile}.cpuprofile`.
      if (PERF_PROFILE) {
        await measureTake(page, cdp, { webcam: arm.webcam }, arm.profile)
      }
    })
  })
}

test.describe('perf: ESCAPECRAFT MP4 conversion', () => {
  test(`converts a ${TAKE_SECONDS}s take to MP4, ${PERF_RUNS} times`, async ({ page }) => {
    await installCraftPerfInstrumentation(page)
    await openCraft(page, { webcam: false })

    // The same question the app's own gate asks, asked of the browser in front
    // of us rather than of its name — `tests/escapecraft/mp4-download.spec.ts`
    // skips on exactly this. A browser that cannot encode H.264 shows the
    // button disabled, which is correct behaviour and not a benchmark.
    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264')

    // One take, converted three times. The conversion is bound by the take's
    // own length, so re-recording between runs would add six seconds a run and
    // change nothing about what is measured.
    await recordPlainTake(page)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    const measurements: Mp4ConversionMeasurement[] = []
    for (let run = 0; run < PERF_RUNS; run++) {
      measurements.push(await measureMp4Conversion(page, cdp))
    }

    const at = (key: keyof Mp4ConversionMeasurement) => measurements.map((m) => m[key])

    writePerfResult({
      name: 'craft-mp4-conversion',
      runs: PERF_RUNS,
      captureSize: CAPTURE_SIZE_LABEL,
      // `takeSeconds`, not `windowSeconds`: this benchmark has no measured
      // window — it times a whole conversion, click to file. What six seconds
      // describes is the *source take*, whose length is the floor `wallMs` is
      // measured against because `convertToMP4` runs at playback speed. Writing
      // it as `windowSeconds` would have the report label it "Measured window",
      // which is the one thing it is not.
      takeSeconds: TAKE_SECONDS,
      wallMs: round(median(at('wallMs'))),
      framesEncoded: median(at('framesEncoded')),
      framesPerSecond: round(median(at('framesPerSecond'))),
      taskDurationMs: round(median(at('taskDurationMs'))),
      taskMsPerFrame: round(median(at('taskMsPerFrame')), 3),
      heapDeltaBytes: median(at('heapDeltaBytes')),
      encoderQueueHighWater: Math.max(...at('encoderQueueHighWater')),
      outputBytes: median(at('outputBytes')),
    })

    console.log('craft-mp4-conversion runs:', JSON.stringify(measurements))

    if (PERF_PROFILE) {
      await measureMp4Conversion(page, cdp, 'craft-mp4')
    }
  })
})
