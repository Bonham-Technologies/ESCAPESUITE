import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-347 (user-reported): a project reopened from a `.veditor` that
 * carries no waveform showed no waveform at all, because only the importers
 * ever computed one. Every file saved before ESCSUITE-97 is one of these: a
 * v1 JSON file whose `videos[i]` has no `meta`. Opened in a fresh context,
 * whose IndexedDB has no row for the source, the load must rebuild the
 * waveform from the restored bytes.
 *
 * The source is a WAV generated here, a 440 Hz tone, because the e2e fixtures
 * are silent (ESCSUITE-348 adds an A/V fixture and `expectWaveformDrawn`) and
 * the container's Chromium cannot decode AAC.
 */

/** A mono 16-bit PCM WAV of a sine tone. */
function toneWav(seconds: number, sampleRate = 8000, hz = 440): Buffer {
  const samples = Math.round(seconds * sampleRate)
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.5 * 32767), 44 + i * 2)
  }
  return wav
}

/** A v1 `.veditor` as a build before ESCSUITE-97 wrote it: no `meta` for its source. */
function legacyProjectFile(wav: Buffer, seconds: number): Buffer {
  const sourceId = 'legacy-tone'
  return Buffer.from(
    JSON.stringify({
      version: 1,
      project: {
        id: 'legacy-project',
        name: 'Legacy project',
        created: 1700000000000,
        modified: 1700000000000,
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [
            { id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [
            {
              id: 'clip1',
              sourceVideoId: sourceId,
              name: 'tone.wav',
              startTime: 0,
              endTime: seconds,
              duration: seconds,
              trackId: 'track1',
              timelinePosition: 0,
              blendMode: 'normal',
              transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
              effects: { blur: 0 },
              transition: { type: 'none', duration: 0.5 },
            },
          ],
          textOverlays: [],
          shapeOverlays: [],
          duration: seconds,
        },
      },
      videos: [{ id: sourceId, name: 'tone.wav', mimeType: 'audio/wav', data: wav.toString('base64') }],
    })
  )
}

test('a project file saved without waveforms shows its waveform once reopened', async ({ page }) => {
  test.setTimeout(60_000)
  const seconds = 2
  await page.goto('http://localhost:5175')
  await waitForAppReady(page, 'artist')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'legacy.veditor',
    mimeType: 'application/json',
    buffer: legacyProjectFile(toneWav(seconds), seconds),
  })
  await expect(page.getByText('Project loaded successfully')).toBeVisible({ timeout: 30_000 })

  const waveform = page.locator('[data-clip-id="clip1"] canvas[class*="waveform"]')
  await expect(waveform).toBeVisible({ timeout: 15_000 })
  // Drawn, not just mounted: a tone leaves painted pixels on the canvas.
  await expect
    .poll(() =>
      waveform.evaluate((canvas: HTMLCanvasElement) => {
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        let painted = 0
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
        return painted
      })
    )
    .toBeGreaterThan(0)
})
