import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { CAPTURE_SIZE, CRAFT_URL } from '../../utils/craftPerf'
import { grantMediaPermissions, mockSyntheticMedia } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-321 U-1 probe — not a test, a measurement run by hand.
 *
 * A Firefox AudioWorklet take's Opus packets were read as `0, 0.014, 0.034,
 * 0.054…` where Chromium's read `0, 0.020, 0.040…`. This records one short
 * screen + microphone take (WebCodecs recorder, AudioWorklet capture) and
 * prints, side by side:
 *
 * - what the page fed the `AudioEncoder` (each `AudioData`'s timestamp and
 *   frame count — the first is the piece of the chunk `start()` landed in),
 * - what the encoder handed back (each `EncodedAudioChunk`'s timestamp and
 *   duration, and the OpusHead pre-skip in the first `decoderConfig`),
 * - what the downloaded WebM holds (ffprobe: the stream's start time and
 *   initial padding, and the first six audio packets' `pts_time` /
 *   `duration_time`).
 *
 * So one run says whether the 6 ms comes from the capture (the inputs would
 * not tile), from the encoder (its output timestamps would sit 312 frames —
 * libopus's lookahead — before the inputs'), or from the muxer.
 *
 * Opt-in: skipped unless `ESCSUITE_321_PROBE=1`, and collected only by its own
 * config (`playwright.first-packet-probe.config.ts`; the perf config ignores
 * `*.probe.spec.ts`, the default config all of `tests/perf/`):
 *
 *     ESCSUITE_321_PROBE=1 pnpm --filter @escapesuite/e2e exec playwright test \
 *       --config=playwright.first-packet-probe.config.ts --project=firefox
 *
 * (and `--project=chromium` for the control). Needs `ffprobe` on PATH, or
 * `FFPROBE` naming it. `ESCSUITE_321_SECONDS` sets the take (default 5).
 * Output goes to the console and to
 * `apps/e2e/av-drift-results/escsuite-321-<browser>/probe.json` beside the WebM.
 */

const ENABLED = !!process.env.ESCSUITE_321_PROBE
const SECONDS = Number(process.env.ESCSUITE_321_SECONDS ?? 5)
const FFPROBE = process.env.FFPROBE ?? 'ffprobe'
const HERE = path.dirname(fileURLToPath(import.meta.url))

interface EncoderLog {
  inputs: { encoder: number; timestamp: number; frames: number; sampleRate: number }[]
  outputs: { encoder: number; timestamp: number; duration: number | null; bytes: number }[]
  preSkip: { encoder: number; preSkip: number | null; descriptionBytes: number }[]
}

/** Wrap `AudioEncoder` before the app loads: log the first inputs and outputs of each encoder. */
async function instrumentAudioEncoder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Original = (window as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder
    if (!Original) return
    const log: EncoderLog = { inputs: [], outputs: [], preSkip: [] }
    ;(window as unknown as { __escsuite321: EncoderLog }).__escsuite321 = log
    const KEEP = 12
    let made = 0
    class LoggedAudioEncoder extends Original {
      private readonly probeIndex: number
      constructor(init: AudioEncoderInit) {
        const index = made++
        let sawConfig = false
        super({
          output: (chunk, meta) => {
            if (log.outputs.filter((o) => o.encoder === index).length < KEEP) {
              log.outputs.push({ encoder: index, timestamp: chunk.timestamp, duration: chunk.duration, bytes: chunk.byteLength })
            }
            const description = meta?.decoderConfig?.description
            if (!sawConfig && meta?.decoderConfig) {
              sawConfig = true
              let preSkip: number | null = null
              let descriptionBytes = 0
              if (description) {
                const bytes = ArrayBuffer.isView(description)
                  ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
                  : new Uint8Array(description)
                descriptionBytes = bytes.length
                // OpusHead: 'OpusHead'(8) version(1) channels(1) pre-skip(u16 LE)
                if (bytes.length >= 12) preSkip = bytes[10] | (bytes[11] << 8)
              }
              log.preSkip.push({ encoder: index, preSkip, descriptionBytes })
            }
            return init.output(chunk, meta)
          },
          error: init.error,
        })
        this.probeIndex = index
      }
      encode(data: AudioData): void {
        if (log.inputs.filter((i) => i.encoder === this.probeIndex).length < KEEP) {
          log.inputs.push({
            encoder: this.probeIndex,
            timestamp: data.timestamp,
            frames: data.numberOfFrames,
            sampleRate: data.sampleRate,
          })
        }
        super.encode(data)
      }
    }
    ;(window as unknown as { AudioEncoder: typeof AudioEncoder }).AudioEncoder = LoggedAudioEncoder
  })
}

function ffprobe(args: string[]): string {
  const result = spawnSync(FFPROBE, ['-v', 'error', ...args], { encoding: 'utf8' })
  if (result.error) throw new Error(`${FFPROBE}: ${result.error.message} (the probe needs ffprobe on PATH)`)
  if (result.status !== 0) throw new Error(`${FFPROBE} exited ${result.status}: ${result.stderr}`)
  return result.stdout.trim()
}

test.describe('ESCSUITE-321 U-1: the first Opus packets of a worklet take', () => {
  test.skip(!ENABLED, 'Opt-in: set ESCSUITE_321_PROBE=1 and run with --config=playwright.first-packet-probe.config.ts')

  test(`a ${SECONDS}s screen + microphone take`, async ({ page, browserName }) => {
    test.slow()
    const resultsDir = path.resolve(HERE, '../../av-drift-results', `escsuite-321-${browserName}`)
    rmSync(resultsDir, { recursive: true, force: true })
    mkdirSync(resultsDir, { recursive: true })

    const consoleLines: string[] = []
    page.on('console', (message) => consoleLines.push(message.text()))

    await instrumentAudioEncoder(page)
    await mockSyntheticMedia(page, { ...CAPTURE_SIZE, markers: true })
    await grantMediaPermissions(page)
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')

    const source = (label: string) => page.getByRole('button', { name: label, exact: true })
    await expect(source('Screen')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 })
    await expect(source('Microphone')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(SECONDS * 1000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(1, { timeout: 120_000 })

    // Tripwire: this probe is about the AudioWorklet path.
    const pathLine = consoleLines.find((l) => l.startsWith('Recording audio through'))
    expect(pathLine, 'the capture path line').toMatch(/through an AudioWorklet/)

    const raw = page.getByRole('button', { name: /^Download (?!.+ as ).+$/ })
    await expect(raw).toHaveCount(1)
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await raw.click()
    const download = await downloadPromise
    const file = path.join(resultsDir, download.suggestedFilename())
    await download.saveAs(file)

    const encoder = await page.evaluate(
      () => (window as unknown as { __escsuite321?: EncoderLog }).__escsuite321 ?? null
    )
    const stream = ffprobe([
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,start_time,initial_padding,time_base',
      '-of', 'default=nw=1', file,
    ])
    const packets = ffprobe([
      '-select_streams', 'a:0',
      '-show_entries', 'packet=pts_time,duration_time',
      '-of', 'csv=p=0', file,
    ])
      .split('\n')
      .slice(0, 6)

    const result = { browserName, pathLine, encoder, stream, packets, file }
    writeFileSync(path.join(resultsDir, 'probe.json'), JSON.stringify(result, null, 2))
    console.log(`\nESCSUITE-321 probe (${browserName}): ${pathLine}`)
    console.log('AudioEncoder inputs (µs, frames):', JSON.stringify(encoder?.inputs.slice(0, 6)))
    console.log('AudioEncoder outputs (µs, µs):', JSON.stringify(encoder?.outputs.slice(0, 6)))
    console.log('OpusHead pre-skip:', JSON.stringify(encoder?.preSkip))
    console.log(`WebM audio stream:\n${stream}`)
    console.log(`First six packets (pts_time,duration_time):\n${packets.join('\n')}\n→ ${resultsDir}`)
    expect(encoder?.inputs.length ?? 0, 'the page fed the encoder').toBeGreaterThan(1)
  })
})
