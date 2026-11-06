import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { pixelsPerSecond, timelineClips } from '../../utils/timeline'
import { waveformCanvas } from '../../utils/mediaHealth'

/**
 * ESCSUITE-418: on a long clip the timeline's waveform drifted off the sound.
 * Each peak was one sample short of 10 ms (159 samples at 16 kHz, 479 at
 * 48 kHz) on any track not a whole number of 10 ms long, but was drawn as
 * `duration / peaks.length`, so the drawn waveform ran 0.2–0.6 % of the
 * clip's length off the audio: users trimming at the waveform's quiet spots
 * cut into speech.
 *
 * The clip is a WAV generated here, two minutes of 16 kHz tone with a 0.6 s
 * gap at 100 s, made a whole sample over a whole number of 10 ms long so the
 * old bucketing shows. At the timeline's highest zoom (500 px a second, so a
 * 10 ms peak is 5 px) the waveform's gap must be drawn where the audio's gap
 * is, to within two peaks; before the fix it was drawn ~0.63 s (~310 px) late.
 */

const RATE = 16_000
const SECONDS = 120.013
const GAP = { start: 100, end: 100.6 }
/** The timeline's scale at its highest zoom (`setZoom` clamps to 10; 50 px a second at zoom 1). */
const MAX_PPS = 500
/** How far the drawn gap's edges may sit from the audio's: two 10 ms peaks at `MAX_PPS`. */
const TOLERANCE_PX = 10

/**
 * A mono 16-bit WAV: a 400 Hz square wave at half scale, silent over `gap`.
 * Built with `fill` a half-period at a time, not a closure per sample.
 */
function toneGapWav(): Buffer {
  const samples = Math.round(SECONDS * RATE)
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(RATE, 24)
  wav.writeUInt32LE(RATE * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(samples * 2, 40)
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, samples)
  const half = RATE / 400 / 2
  for (let at = 0, high = true; at < samples; at += half, high = !high) pcm.fill(high ? 16_384 : -16_384, at, at + half)
  pcm.fill(0, Math.round(GAP.start * RATE), Math.round(GAP.end * RATE))
  return wav
}

/**
 * The first quiet stretch of at least 0.3 s the clip's waveform canvas draws,
 * in clip seconds, read from its pixels: a column is quiet when under a
 * quarter of the loudest column's painted height (a silent peak still paints
 * its 1 px centre line). `null` until the canvas draws one.
 */
function drawnGap(page: Page): Promise<{ start: number; end: number } | null> {
  return waveformCanvas(page, timelineClips(page).first()).evaluate(
    (el, seconds) => {
      const canvas = el as HTMLCanvasElement
      if (canvas.width === 0 || canvas.height === 0) return null
      const clipBox = canvas.closest('[data-clip-id]')!.getBoundingClientRect()
      const box = canvas.getBoundingClientRect()
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const columns: number[] = []
      for (let x = 0; x < canvas.width; x++) {
        let painted = 0
        for (let y = 0; y < canvas.height; y++) if (data[(y * canvas.width + x) * 4 + 3] > 0) painted++
        columns.push(painted)
      }
      const loudest = Math.max(...columns)
      const timeAt = (x: number) => ((box.left + (x / canvas.width) * box.width - clipBox.left) / clipBox.width) * seconds
      for (let x = 0; x < columns.length; x++) {
        if (columns[x] >= loudest / 4) continue
        let end = x
        while (end < columns.length && columns[end] < loudest / 4) end++
        // A run that touches the canvas's edge may go on past it: not a gap the canvas shows whole.
        if (x > 0 && end < columns.length && timeAt(end) - timeAt(x) >= 0.3) return { start: timeAt(x), end: timeAt(end) }
        x = end
      }
      return null
    },
    SECONDS
  )
}

test.describe('ESCSUITE-418: the waveform of a long clip is drawn where its sound is', () => {
  test('a gap 100 s into a two-minute 16 kHz clip is drawn at 100 s at the highest zoom', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'long-tone-gap.wav', mimeType: 'audio/wav', buffer: toneGapWav() })

    // Zoom in to the limit: 1.25× a click from 1, clamped at 10.
    const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' })
    for (let i = 0; i < 11; i++) await zoomIn.click()
    const clip = timelineClips(page).first()
    await expect.poll(() => pixelsPerSecond(clip, SECONDS), { message: 'the timeline is at its highest zoom' }).toBeCloseTo(MAX_PPS, 0)

    // Scroll the gap into view, a little in from the left edge.
    await page.locator('[class*="trackContainer"]').first().evaluate((el, left) => {
      el.scrollLeft = left
    }, GAP.start * MAX_PPS - 300)

    await expect.poll(() => drawnGap(page), { message: 'the waveform draws the gap', timeout: 15_000 }).not.toBeNull()
    const gap = (await drawnGap(page))!
    const offPx = { start: (gap.start - GAP.start) * MAX_PPS, end: (gap.end - GAP.end) * MAX_PPS }
    expect(Math.abs(offPx.start), `the gap is drawn from ${gap.start.toFixed(3)} s, ${offPx.start.toFixed(1)} px off the audio's`).toBeLessThanOrEqual(TOLERANCE_PX)
    expect(Math.abs(offPx.end), `the gap is drawn to ${gap.end.toFixed(3)} s, ${offPx.end.toFixed(1)} px off the audio's`).toBeLessThanOrEqual(TOLERANCE_PX)
  })
})
