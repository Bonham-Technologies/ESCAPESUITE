import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext } from '@playwright/test'
import { MARKER_PERIOD_MS } from './media-mocks'

/**
 * A/V sync of a finished file, measured in the browser (ESCSUITE-368).
 *
 * The file must come from a take recorded against
 * `mockSyntheticMedia(..., { markers: true })`: a 100 ms 1 kHz beep every
 * {@link MARKER_PERIOD_MS} on the sound, and on every frame of the picture its
 * paint time (`performance.now() − t0`, ms) as a 32-cell timecode strip along
 * the top-left edge. It is the same reading `scripts/av-drift-report.mjs`
 * takes with ffmpeg, made where CI has no ffmpeg:
 *
 * - **Sound**: `decodeAudioData` — the decoded samples laid end to end — or,
 *   with `byTimestamp`, each decoded chunk placed at its packet's timestamp, as
 *   a player plays the file. A MediaRecorder Opus track has holes where the
 *   recorder lost audio (ESCSUITE-368), so its raw take is read by timestamp;
 *   an ESCAPEARTIST export is read end to end, which proves the export placed
 *   its sound itself. Each beep's onset is the first millisecond whose peak
 *   passes a third of the file's peak after at least 50 ms of quiet; a burst
 *   that is not 60–200 ms long is not a beep.
 * - **Picture**: Mediabunny (the demuxer and decoder both apps ship) decodes
 *   the frames within ±2 s of each beep, cropped to the strip, and reads each
 *   frame's paint time with its parity bit. The picture's wall time at the beep
 *   is the beep's file time plus the 90th percentile of `paint − frame time`
 *   over those frames — the freshest content, as the report takes it, since a
 *   frame is up to one paint interval older than its capture.
 * - **Offset** per beep = picture wall time − the beep's slot on the schedule
 *   (positive: the sound lags its picture). A constant offset (codec priming, a
 *   first audio packet that is not at 0) cancels in {@link AvSyncReading.driftMs}.
 *
 * The page it runs in is a blank document on the CRAFT origin served by a route
 * (a secure context, so WebCodecs is there), not one of the apps, so the
 * Mediabunny bundle injected into it meets no second copy.
 */

export interface AvSyncReading {
  /** Seconds of decoded sound. */
  audioSeconds: number
  /** `[beep onset in the decoded sound, s, offset ms]`, in file order. */
  offsets: [number, number][]
  /** Last offset minus first, ms: how far the sound moved against its picture over the file. */
  driftMs: number
  /** Least-squares slope of the offsets, ms per minute. */
  slopeMsPerMin: number
  /**
   * The sound's container timestamps against its decoded length: the span from
   * the first packet to the end of the last, minus the decoded samples' length,
   * ms. Near zero when the packets tile; a MediaRecorder track's jitter
   * cancels; what is left is its holes, time the timestamps say passed that
   * the samples, laid end to end, do not cover. A diagnostic for a failure
   * message, not part of the offset.
   */
  ptsHolesMs: number
  /** Frames whose timecode decoded, and those that failed parity or sat far off the trend. */
  frames: number
  badFrames: number
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIST_PACKAGE = path.resolve(HERE, '../../artist/package.json')

/**
 * Mediabunny's self-contained browser bundle (it defines `window.Mediabunny`),
 * resolved through ESCAPEARTIST's own dependency so the measurement decodes with
 * the version the editor ships.
 */
function mediabunnyBundle(): string {
  const entry = createRequire(ARTIST_PACKAGE).resolve('mediabunny')
  const root = entry.slice(0, entry.lastIndexOf(`${path.sep}dist${path.sep}`))
  return readFileSync(path.join(root, 'dist', 'bundles', 'mediabunny.min.cjs'), 'utf8')
}

const ANALYSIS_ORIGIN = 'http://localhost:5174'

/**
 * Measure `file`'s A/V offset at every marker beep, in a fresh page of
 * `context`; with `byTimestamp`, the sound placed by its packets' timestamps
 * rather than laid end to end.
 */
export async function readAvSync(
  context: BrowserContext,
  file: string,
  { byTimestamp = false }: { byTimestamp?: boolean } = {}
): Promise<AvSyncReading> {
  const page = await context.newPage()
  try {
    const pageUrl = `${ANALYSIS_ORIGIN}/__av-sync/index.html`
    const fileUrl = `${ANALYSIS_ORIGIN}/__av-sync/media`
    await page.route(pageUrl, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>A/V sync</title>' })
    )
    await page.route(fileUrl, (route) =>
      route.fulfill({ contentType: 'application/octet-stream', body: readFileSync(file) })
    )
    await page.goto(pageUrl)
    await page.addScriptTag({ content: mediabunnyBundle() })

    return await page.evaluate(
      async ({ fileUrl, periodMs, byTimestamp }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const MB = (window as any).Mediabunny
        const bytes = await (await fetch(fileUrl)).arrayBuffer()
        const input = new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS })

        // --- Sound: beep onsets in the decoded samples. ---
        const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes.slice(0))
        const rate = audio.sampleRate
        let samples = audio.getChannelData(0)
        if (byTimestamp) {
          // One decoded chunk per packet, in decode order (neither mediabunny
          // nor AudioDecoder passes a packet's timestamp through), each written
          // at its packet's timestamp from the first.
          const track = await input.getPrimaryAudioTrack()
          if (!track) throw new Error('the file has no audio track')
          const packets = new MB.EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })
          const chunks: [number, Float32Array][] = []
          let end = 0
          let first = NaN
          for await (const sample of new MB.AudioSampleSink(track).samples()) {
            const packet = await packets.next()
            const stamp: number = packet.done ? NaN : packet.value.timestamp
            if (Number.isNaN(first)) first = stamp
            if (sample.sampleRate !== rate) throw new Error(`decoded at ${sample.sampleRate} Hz`)
            const plane = new Float32Array(sample.numberOfFrames)
            sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
            const at = Math.round((stamp - first) * rate)
            chunks.push([at, plane])
            end = Math.max(end, at + plane.length)
            sample.close()
          }
          await packets.return(undefined)
          samples = new Float32Array(end)
          for (const [at, plane] of chunks) samples.set(plane, at)
        }
        const block = Math.round(rate / 1000)
        const peaks = new Float32Array(Math.floor(samples.length / block))
        let loudest = 0
        for (let b = 0; b < peaks.length; b++) {
          let peak = 0
          for (let i = b * block; i < (b + 1) * block; i++) peak = Math.max(peak, Math.abs(samples[i]))
          peaks[b] = peak
          loudest = Math.max(loudest, peak)
        }
        const threshold = loudest / 3
        const beeps: number[] = []
        let quiet = 0
        for (let b = 0; b < peaks.length; b++) {
          if (peaks[b] < threshold) {
            quiet++
            continue
          }
          if (quiet >= 50) {
            let end = b
            let gap = 0
            while (end < peaks.length && gap < 20) {
              gap = peaks[end] < threshold ? gap + 1 : 0
              end++
            }
            const lengthMs = end - gap - b
            if (lengthMs >= 60 && lengthMs <= 200) {
              let first = b * block
              while (Math.abs(samples[first]) < threshold) first++
              beeps.push(first / rate)
            }
          }
          quiet = 0
        }

        let ptsHolesMs = NaN
        const audioTrack = await input.getPrimaryAudioTrack()
        if (audioTrack) {
          let first = NaN
          let end = -Infinity
          for await (const packet of new MB.EncodedPacketSink(audioTrack).packets(undefined, undefined, { metadataOnly: true })) {
            if (Number.isNaN(first)) first = packet.timestamp
            end = Math.max(end, packet.timestamp + packet.duration)
          }
          ptsHolesMs = (end - first - audio.duration) * 1000
        }

        // --- Picture: paint time per frame near each beep. ---
        const track = await input.getPrimaryVideoTrack()
        if (!track) throw new Error('the file has no video track')
        const width: number = track.displayWidth
        // The strip's cells are floor(1280 / 40) = 32 px of the 1280-wide capture:
        // 1/40 of the frame's width, at whatever size the file carries it.
        const cell = width / 40
        const SCALE = 8
        const sink = new MB.CanvasSink(track, {
          crop: { left: 0, top: 0, width: Math.round(cell * 32), height: Math.max(1, Math.round(cell)) },
          width: 32 * SCALE,
          height: SCALE,
          fit: 'fill',
        })
        const frames = new Map<number, number>()
        let bad = 0
        const windows: [number, number][] = []
        for (const t of beeps) {
          const from = Math.max(0, t - 2)
          const last = windows[windows.length - 1]
          if (last && from <= last[1]) last[1] = t + 2
          else windows.push([from, t + 2])
        }
        for (const [from, to] of windows) {
          for await (const { canvas, timestamp } of sink.canvases(from, to)) {
            const ctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D
            const row = ctx.getImageData(0, Math.floor(SCALE / 2), 32 * SCALE, 1).data
            let value = 0
            let parity = 0
            let check = 0
            for (let bit = 0; bit < 32; bit++) {
              const p = (bit * SCALE + SCALE / 2) * 4
              const on = 0.299 * row[p] + 0.587 * row[p + 1] + 0.114 * row[p + 2] >= 128 ? 1 : 0
              if (bit < 31) {
                parity ^= on
                value = value * 2 + on
              } else {
                check = on
              }
            }
            if (check === parity) frames.set(timestamp, value)
            else bad++
          }
        }
        // A decode that passes parity but sits far off its neighbours' trend
        // (two flipped bits) is dropped against the median lag.
        const decoded = [...frames.entries()].sort((a, b) => a[0] - b[0])
        const lagsAll = decoded.map(([t, paint]) => paint - t * 1000).sort((a, b) => a - b)
        const medianLag = lagsAll[Math.floor(lagsAll.length / 2)]
        const kept = decoded.filter(([t, paint]) => Math.abs(paint - t * 1000 - medianLag) < 5000)
        bad += decoded.length - kept.length

        const offsets: [number, number][] = []
        for (const t of beeps) {
          const lags = kept
            .filter(([ft]) => ft >= t - 2 && ft <= t + 2)
            .map(([ft, paint]) => paint - ft * 1000)
            .sort((a, b) => a - b)
          if (lags.length === 0) continue
          const wall = t * 1000 + lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.9))]
          offsets.push([t, wall - Math.round(wall / periodMs) * periodMs])
        }
        return { audioSeconds: audio.duration, offsets, ptsHolesMs, frames: kept.length, badFrames: bad }
      },
      { fileUrl, periodMs: MARKER_PERIOD_MS, byTimestamp }
    ).then((raw) => {
      const { offsets } = raw
      const driftMs = offsets.length > 1 ? offsets[offsets.length - 1][1] - offsets[0][1] : NaN
      return { ...raw, driftMs, slopeMsPerMin: slope(offsets.map(([t, ms]) => [t / 60, ms])) }
    })
  } finally {
    await page.close()
  }
}

function slope(points: [number, number][]): number {
  const n = points.length
  if (n < 2) return NaN
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxx = 0
  let sxy = 0
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2
    sxy += (x - mx) * (y - my)
  }
  return sxx > 0 ? sxy / sxx : NaN
}

/** One line for logs and failure messages. */
export function describeAvSync(r: AvSyncReading): string {
  const fmt = (ms: number) => `${ms >= 0 ? '+' : ''}${ms.toFixed(1)}`
  return (
    `${r.offsets.length} beeps over ${r.audioSeconds.toFixed(1)} s, drift ${fmt(r.driftMs)} ms ` +
    `(slope ${fmt(r.slopeMsPerMin)} ms/min; ${r.frames} timecoded frames, ${r.badFrames} rejected; ` +
    `audio timestamps hold ${r.ptsHolesMs.toFixed(0)} ms more than its samples); ` +
    `offsets ms: ${r.offsets.map(([t, ms]) => `${t.toFixed(1)}s ${fmt(ms)}`).join(', ')}`
  )
}
