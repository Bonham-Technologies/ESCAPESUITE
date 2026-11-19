import { readFileSync } from 'node:fs'
import { test, expect, type BrowserContext } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, inspector } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { exportWebM, timelineClips } from '../../utils/timeline'
import { AV_FIXTURE_TIMING, AV_FIXTURE_WEBM } from '../../utils/mediaHealth'
import { ANALYSIS_ORIGIN, mediabunnyBundle } from '../../utils/avSync'

/**
 * ESCSUITE-471: clip speed. A clip can play from 0.25× to 4×, so the waiting
 * parts of a screen recording play faster; its length on the timeline is its
 * source span over its speed, and its sound is resampled with the picture up
 * to 2×.
 *
 * The clip is the A/V fixture (`tone-gap.webm`): 5 s of testsrc2 (every frame
 * differs) over a tone with digital silence from 2 s to 3 s. Set to 2× from the
 * inspector, it must take 2.5 s of timeline, and its WebM export must run
 * 2.5 s (within one frame), with the silence at 1–1.5 s and, at every instant
 * checked, the picture the source showed at twice that time: the sound and the
 * picture stay in step. The picture is matched against the source's own frames
 * (a downscaled mean absolute difference), so the reading needs no marker
 * burnt into the fixture.
 */

const SPEED = 2
const FPS = 30
/** One frame at the fixture's rate: how far a length may be off (AC1). */
const ONE_FRAME = 1 / FPS
/** The sped clip's length. */
const SPED_LENGTH = AV_FIXTURE_TIMING.duration / SPEED
/** Output frames whose picture is checked: 0.5 s, the silence's two edges, inside it, and 2 s. */
const CHECKED_FRAMES = [15, 30, 37, 45, 60]

interface SpedExportReading {
  /** The container's length, and its video track's, seconds. */
  duration: number
  videoDuration: number
  /** The decoded sound's length, seconds. */
  audioDuration: number
  /** The longest run of 10 ms windows under 0.01 RMS, seconds of the export. */
  silence: { start: number; end: number }
  /** Per checked output frame: the source frame (offset from `SPEED ×` its time) its picture is closest to. */
  frames: { frame: number; bestOffset: number; bestDiff: number; unspedDiff: number; outputLuma: number; sourceLuma: number }[]
}

/**
 * Read the export in a blank page on a secure origin (as `readAvSync` does),
 * with Mediabunny's browser bundle: its length, its sound's silence, and which
 * frame of the source each checked frame of its picture shows.
 */
async function readSpedExport(context: BrowserContext, exported: Buffer): Promise<SpedExportReading> {
  const page = await context.newPage()
  try {
    const base = `${ANALYSIS_ORIGIN}/__clip-speed`
    await page.route(`${base}/index.html`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Clip speed</title>' })
    )
    await page.route(`${base}/export`, (route) => route.fulfill({ contentType: 'application/octet-stream', body: exported }))
    await page.route(`${base}/source`, (route) =>
      route.fulfill({ contentType: 'application/octet-stream', body: readFileSync(AV_FIXTURE_WEBM) })
    )
    await page.goto(`${base}/index.html`)
    await page.addScriptTag({ content: mediabunnyBundle() })

    return await page.evaluate(
      async ({ base, speed, fps, checked, sourceSeconds }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const MB = (window as any).Mediabunny
        const bytesOf = async (url: string) => (await fetch(url)).arrayBuffer()
        const exported = await bytesOf(`${base}/export`)
        const source = await bytesOf(`${base}/source`)
        const open = (bytes: ArrayBuffer) => new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS })

        const output = open(exported)
        const duration: number = await output.computeDuration()
        const outTrack = await output.getPrimaryVideoTrack()
        if (!outTrack) throw new Error('the export has no video track')
        const videoDuration: number = await outTrack.computeDuration()

        // --- Sound: the silence, in 10 ms windows. ---
        const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(exported.slice(0))
        const samples = audio.getChannelData(0)
        const windowFrames = Math.round(audio.sampleRate / 100)
        let run = 0
        let best = { start: 0, end: 0 }
        for (let w = 0; (w + 1) * windowFrames <= samples.length; w++) {
          let sum = 0
          for (let i = w * windowFrames; i < (w + 1) * windowFrames; i++) sum += samples[i] * samples[i]
          run = Math.sqrt(sum / windowFrames) < 0.01 ? run + 1 : 0
          if (run > 0 && run / 100 > best.end - best.start) best = { start: (w + 1 - run) / 100, end: (w + 1) / 100 }
        }

        // --- Picture: which source frame each checked output frame shows. ---
        // The 640×360 fixture sits at its own size in the middle of the 1080p
        // project's frame (`fit` none): the export is cropped to that third.
        const sink = (track: unknown, crop?: { left: number; top: number; width: number; height: number }) =>
          new MB.CanvasSink(track, { width: 64, height: 36, fit: 'fill', ...(crop ? { crop } : {}) })
        const ow: number = outTrack.displayWidth
        const oh: number = outTrack.displayHeight
        const outSink = sink(outTrack, { left: Math.round(ow / 3), top: Math.round(oh / 3), width: Math.round(ow / 3), height: Math.round(oh / 3) })
        const srcTrack = await open(source).getPrimaryVideoTrack()
        const srcSink = sink(srcTrack)
        const luma = async (from: { getCanvas: (t: number) => Promise<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null> }, t: number) => {
          const wrapped = await from.getCanvas(t)
          if (!wrapped) throw new Error(`no frame at ${t} s`)
          const ctx = wrapped.canvas.getContext('2d') as CanvasRenderingContext2D
          const { data } = ctx.getImageData(0, 0, 64, 36)
          const out = new Float32Array(64 * 36)
          for (let p = 0; p < out.length; p++) out[p] = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2]
          return out
        }
        const diff = (a: Float32Array, b: Float32Array) => {
          let sum = 0
          for (let p = 0; p < a.length; p++) sum += Math.abs(a[p] - b[p])
          return sum / a.length
        }
        // Frame centres, so no time sits on a frame's edge.
        const centre = (frame: number) => (frame + 0.5) / fps
        const frames = []
        for (const frame of checked) {
          const picture = await luma(outSink, centre(frame))
          let bestOffset = 0
          let bestDiff = Infinity
          for (let offset = -6; offset <= 6; offset++) {
            const at = centre(frame * speed + offset)
            if (at <= 0 || at >= sourceSeconds) continue
            const d = diff(picture, await luma(srcSink, at))
            if (d < bestDiff) {
              bestDiff = d
              bestOffset = offset
            }
          }
          const mean = (l: Float32Array) => l.reduce((sum, v) => sum + v, 0) / l.length
          frames.push({
            frame,
            bestOffset,
            bestDiff,
            unspedDiff: diff(picture, await luma(srcSink, centre(frame))),
            outputLuma: mean(picture),
            sourceLuma: mean(await luma(srcSink, centre(frame * speed))),
          })
        }
        return { duration, videoDuration, audioDuration: audio.duration, silence: best, frames }
      },
      { base, speed: SPEED, fps: FPS, checked: CHECKED_FRAMES, sourceSeconds: AV_FIXTURE_TIMING.duration }
    )
  } finally {
    await page.close()
  }
}

test.describe('ESCSUITE-471: a clip at 2× plays its source twice as fast, picture and sound together', () => {
  test.beforeEach(async ({ page }) => {
    // Vercel Analytics' dev script is a third-party host: never reached from a test.
    await page.route('https://va.vercel-scripts.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    )
  })

  test('set from the inspector, a 5 s clip takes 2.5 s of timeline and exports as 2.5 s of WebM in sync', async ({
    page,
    context,
    browserName,
  }) => {
    test.setTimeout(180_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, AV_FIXTURE_WEBM)

    const clip = timelineClips(page).first()
    const before = (await clip.boundingBox())!.width
    await clip.click({ position: { x: 8, y: 8 } })

    // The inspector's Speed section, collapsed until opened.
    await inspector(page).getByRole('button', { name: /^Speed/ }).click()
    await inspector(page).getByRole('button', { name: `${SPEED}×`, exact: true }).click()
    await expect(inspector(page).getByRole('button', { name: `${SPEED}×`, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(inspector(page).getByText('The sound plays higher, in step with the picture.')).toBeVisible()

    // The timeline: half the width, and the clip says its speed.
    await expect(clip).toContainText(`${SPEED}×`)
    await expect.poll(async () => (await clip.boundingBox())!.width / before, { message: 'the clip is half as long' }).toBeCloseTo(1 / SPEED, 2)

    const reading = await readSpedExport(context, await exportWebM(page))

    // AC1: the export runs 2.5 s, within one frame.
    expect(Math.abs(reading.videoDuration - SPED_LENGTH), `video runs ${reading.videoDuration} s`).toBeLessThanOrEqual(ONE_FRAME + 1e-6)
    expect(Math.abs(reading.duration - SPED_LENGTH), `file runs ${reading.duration} s`).toBeLessThanOrEqual(ONE_FRAME + 1e-6)

    // AC2: the sound is sped with the picture — the source's 2–3 s silence
    // at 1–1.5 s — and each frame shows the source at twice its time.
    expect(Math.abs(reading.audioDuration - SPED_LENGTH), `sound runs ${reading.audioDuration} s`).toBeLessThanOrEqual(ONE_FRAME + 0.03)
    const { silence } = reading
    const expected = { start: AV_FIXTURE_TIMING.silence.start / SPEED, end: AV_FIXTURE_TIMING.silence.end / SPEED }
    // One frame, plus the 10 ms window the silence is read in.
    const tolerance = ONE_FRAME + 0.01
    expect(Math.abs(silence.start - expected.start), `silence starts at ${silence.start} s`).toBeLessThanOrEqual(tolerance)
    expect(Math.abs(silence.end - expected.end), `silence ends at ${silence.end} s`).toBeLessThanOrEqual(tolerance)
    // WebKit (Playwright's Linux build) exports a WebM whose picture its own
    // WebCodecs decodes as black, at 1× as at 2× (checked when this spec was
    // written): a limit of the engine here, not of speed. Its length and its
    // sound are still checked above; Chromium and Firefox check the picture.
    if (browserName === 'webkit' && reading.frames.every((f) => f.outputLuma === 0)) {
      test.info().annotations.push({ type: 'skipped-check', description: 'WebKit decodes its WebM export as black: picture not compared' })
      return
    }
    for (const f of reading.frames) {
      expect(f.outputLuma, `output frame ${f.frame} is not black`).toBeGreaterThan(0)
      const at = `output frame ${f.frame} (${(f.frame / FPS).toFixed(3)} s)`
      expect(Math.abs(f.bestOffset), `${at} shows source frame ${f.frame * SPEED + f.bestOffset}, not ${f.frame * SPEED}: ${JSON.stringify(reading.frames)}`).toBeLessThanOrEqual(1)
      if (f.frame > 0) expect(f.bestDiff, `${at} is closer to the source at 2× than at 1×`).toBeLessThan(f.unspedDiff)
    }
    test.info().annotations.push({ type: 'reading', description: `${browserName}: ${JSON.stringify(reading)}` })
  })
})
