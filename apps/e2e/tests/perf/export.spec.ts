import { test } from '@playwright/test'
import {
  PERF_RUNS,
  SCENE_CLIP_COUNT,
  SCENE_TRACK_COUNT,
  installPerfInstrumentation,
  loadPerfScene,
  measureExport,
  median,
  round,
  writePerfResult,
  type ExportMeasurement,
} from '../../utils/perf'

/**
 * Benchmark: exporting the generated 12-clip scene at 720p, both formats.
 *
 * The same scene the playback benchmark plays, so the two numbers describe the
 * same work through two pipelines: the preview composites it in real time, the
 * exporter composites and encodes it as fast as it can.
 *
 * MP4 and WebM are separate tests so one format failing (an unavailable H.264
 * encoder on a runner, say) still leaves the other's numbers in the report.
 */
const FORMATS = ['mp4', 'webm'] as const

for (const format of FORMATS) {
  test.describe(`perf: ${format} export`, () => {
    test(`exports the ${SCENE_CLIP_COUNT}-clip scene at 720p, ${PERF_RUNS} times`, async ({
      page,
    }) => {
      await installPerfInstrumentation(page)
      await loadPerfScene(page)

      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')

      const measurements: ExportMeasurement[] = []
      for (let run = 0; run < PERF_RUNS; run++) {
        measurements.push(await measureExport(page, cdp, format))
      }

      const at = (key: keyof ExportMeasurement) => measurements.map((m) => m[key])

      writePerfResult({
        name: `export-${format}`,
        runs: PERF_RUNS,
        scene: `${SCENE_CLIP_COUNT} clips / ${SCENE_TRACK_COUNT} tracks @ 1280x720`,
        format,
        resolution: '720p',
        wallMs: round(median(at('wallMs'))),
        framesEncoded: median(at('framesEncoded')),
        framesPerSecond: round(median(at('framesPerSecond'))),
        heapDeltaBytes: median(at('heapDeltaBytes')),
        encoderQueueHighWater: Math.max(...at('encoderQueueHighWater')),
        outputBytes: median(at('bytes')),
      })

      console.log(`export-${format} runs:`, JSON.stringify(measurements))
    })
  })
}
