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
  recordSeparateTracksTake,
  type Mp4ConversionMeasurement,
  type TakeMeasurement,
} from '../../utils/craftPerf'
import { PERF_PROFILE, PERF_RUNS, median, round, writePerfResult } from '../../utils/perf'
import { canConvertToMp4 } from '../../utils/webcodecs'

/**
 * Benchmarks: what ESCAPECRAFT costs while it is recording, and while it is
 * converting a recording to MP4.
 *
 * Five benchmarks, one per pipeline the app actually has:
 *
 * | Benchmark | Path under test |
 * |---|---|
 * | `craft-screen-recording` | `WebCodecsRecorder` — every captured frame handed to `VideoEncoder.encode` on the main thread |
 * | `craft-pip-recording` | `Compositor` + MediaRecorder — an rAF draw loop on the main thread, encoding off it |
 * | `craft-separate-tracks-recording` | `WebCodecsRecorder` with **two** `VideoEncoder`s on one clock, and the `Compositor` drawing the preview only |
 * | `craft-mp4-conversion` | `convertToMP4` — decode, draw, `VideoFrame`, encode, mux, all in the page |
 * | `craft-composite-mp4-conversion` | `convertToMP4` again, with a second `<video>` drawn through `drawOverlay` into the same canvas — the composite of a separate-tracks take |
 *
 * Each is its own `test()` with its own page load, so one failing (no H.264
 * encoder on a runner, a capture device that would not open) still leaves the
 * others' numbers in the report — the same arrangement as the two export
 * benchmarks.
 *
 * They assert nothing about speed. The only `expect`s are inside
 * `utils/craftPerf.ts`, and every one of the twelve says the benchmark measured
 * the wrong thing rather than that the machine was slow: a take that stopped
 * mid-window; a "WebCodecs" take that encoded nothing, or that drew video into
 * a canvas at all (which would mean `WebCodecsRecorder` had taken its
 * `startVideoElementCapture` fallback); a PiP take that composited nothing, or
 * whose `videoDraws` came out odd (which would mean a capture track was not
 * ready for some frames, so the two-draws-per-composited-frame divisor is
 * wrong); a separate-tracks take that did not run exactly two video encoders, or
 * one of whose two encoded nothing, or that did not run exactly two **audio**
 * encoders (the mix on the primary plus the microphone companion), with the same
 * two draw checks over the compositor now that it is drawing the preview only —
 * two encoders' frames counted, and the compositor drawing for the preview only;
 * a conversion that encoded no frames; and a composite conversion whose two
 * videos were not drawn once each per encoded frame (either the overlay was
 * never drawn, or the screen was passed over twice).
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
    separateTracks: false,
    mode: 'screen',
    recorder: 'webcodecs',
    profile: 'craft-screen',
  },
  {
    name: 'craft-pip-recording',
    title: 'PiP (screen + webcam)',
    webcam: true,
    separateTracks: false,
    mode: 'screen + webcam (PiP)',
    recorder: 'mediarecorder',
    profile: 'craft-pip',
  },
  {
    name: 'craft-separate-tracks-recording',
    title: 'separate tracks (screen + webcam)',
    webcam: true,
    separateTracks: true,
    mode: 'screen + webcam (separate tracks)',
    recorder: 'webcodecs',
    profile: 'craft-separate-tracks',
  },
] as const

for (const arm of TAKE_MODES) {
  test.describe(`perf: ESCAPECRAFT ${arm.title} recording`, () => {
    test(`records ${TAKE_SECONDS}s ${arm.title} takes at ${CAPTURE_SIZE_LABEL}, ${PERF_RUNS} times`, async ({
      page,
    }) => {
      await installCraftPerfInstrumentation(page)
      await openCraft(page, { webcam: arm.webcam, separateTracks: arm.separateTracks })

      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')

      const measurements: TakeMeasurement[] = []
      for (let run = 0; run < PERF_RUNS; run++) {
        // Every run is a fresh take on the same page, so the recordings list
        // grows a row each time — which is what a user's second and third take
        // sees too. Nothing is cleared between runs on purpose: a benchmark
        // that reset the library every time would measure a state only the
        // first take of a session is ever in.
        measurements.push(
          await measureTake(page, cdp, {
            webcam: arm.webcam,
            separateTracks: arm.separateTracks,
          })
        )
      }

      // Generic in the key, not `keyof TakeMeasurement` collapsed to a union:
      // `framesEncodedPerEncoder` is a `number[]`, so a non-generic helper would
      // hand `median()` a `(number | number[])[]`.
      const at = <K extends keyof TakeMeasurement>(key: K) => measurements.map((m) => m[key])

      writePerfResult({
        name: arm.name,
        runs: PERF_RUNS,
        mode: arm.mode,
        recorder: arm.recorder,
        captureSize: CAPTURE_SIZE_LABEL,
        windowSeconds: TAKE_WINDOW_SECONDS,
        // Several of the numbers below are a hard zero in each mode —
        // `framesEncoded`/`framesPerSecond`/`encoderQueueHighWater` for PiP,
        // `compositedFps`/`videoDraws`/`videoDrawsPerSecond` for screen, and the
        // two per-encoder counts for both of them — and they are written out
        // anyway so all three rows have the same JSON shape. A reader of the
        // table has a few rows to skip; a reader of the JSON has one schema
        // instead of three, and `headline()` can pick the mode's real rate by
        // asking which of them is non-zero. `measureTake` explains why each zero
        // is a zero rather than an unobservable. Only the separate-tracks arm
        // reports every one of them non-zero, because it is the only mode that
        // both encodes in the page and composites.
        framesEncoded: median(at('framesEncoded')),
        framesPerSecond: round(median(at('framesPerSecond'))),
        // Per-encoder, screen first: a mode whose whole point is two encoders
        // should report what each of them did. Written on every arm so the three
        // rows keep one JSON shape — the screen arm runs a single encoder and so
        // repeats `framesEncoded` under `screenFramesEncoded`, which is what that
        // encoder is, and PiP constructs no `VideoEncoder` at all so both are 0.
        screenFramesEncoded: median(at('framesEncodedPerEncoder').map((per) => per[0] ?? 0)),
        webcamFramesEncoded: median(at('framesEncodedPerEncoder').map((per) => per[1] ?? 0)),
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
        await measureTake(
          page,
          cdp,
          { webcam: arm.webcam, separateTracks: arm.separateTracks },
          arm.profile
        )
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
      await measureMp4Conversion(page, cdp, { profileName: 'craft-mp4' })
    }
  })
})

test.describe('perf: ESCAPECRAFT composite MP4 conversion', () => {
  test(`converts a ${TAKE_SECONDS}s separate-tracks take to one MP4, ${PERF_RUNS} times`, async ({
    page,
  }) => {
    await installCraftPerfInstrumentation(page)
    await openCraft(page, { webcam: true, separateTracks: true })

    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264')

    // One take, converted three times, exactly as the plain arm does: the
    // conversion is bound by the take's own length, so re-recording between
    // runs would add six seconds a run and change nothing measured.
    await recordSeparateTracksTake(page)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    const measurements: Mp4ConversionMeasurement[] = []
    for (let run = 0; run < PERF_RUNS; run++) {
      measurements.push(await measureMp4Conversion(page, cdp, { composite: true }))
    }

    const at = (key: keyof Mp4ConversionMeasurement) => measurements.map((m) => m[key])

    writePerfResult({
      name: 'craft-composite-mp4-conversion',
      runs: PERF_RUNS,
      captureSize: CAPTURE_SIZE_LABEL,
      takeSeconds: TAKE_SECONDS,
      wallMs: round(median(at('wallMs'))),
      framesEncoded: median(at('framesEncoded')),
      framesPerSecond: round(median(at('framesPerSecond'))),
      // Published here and nowhere else: the plain arm's is one per frame by
      // construction, and this arm's is the two the overlay costs.
      videoDraws: median(at('videoDraws')),
      taskDurationMs: round(median(at('taskDurationMs'))),
      taskMsPerFrame: round(median(at('taskMsPerFrame')), 3),
      heapDeltaBytes: median(at('heapDeltaBytes')),
      encoderQueueHighWater: Math.max(...at('encoderQueueHighWater')),
      outputBytes: median(at('outputBytes')),
    })

    console.log('craft-composite-mp4-conversion runs:', JSON.stringify(measurements))

    if (PERF_PROFILE) {
      await measureMp4Conversion(page, cdp, {
        composite: true,
        profileName: 'craft-composite-mp4',
      })
    }
  })
})
