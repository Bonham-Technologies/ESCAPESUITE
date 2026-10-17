import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * A separate-tracks take whose microphone goes mid-take stores the microphone
 * part at its own length (ESCSUITE-318).
 *
 * The recorder finalises a companion early when its track ends, so the file
 * was always right — but every part used to be stored at the take's
 * wall-clock length, and ESCAPEARTIST, which trusts the stored figure, laid a
 * clip of the take's length over the shorter file. Measured before the fix: a
 * microphone ended ~1 s into a ~6.5 s take was stored at 6.51 s over a file
 * that decodes to 1.48 s.
 *
 * The take is real (`mockSyntheticMedia`: canvases for the screen and the
 * camera, an oscillator for the microphone). The mock has no way to end a
 * track, so the spec keeps a handle on every audio track `getUserMedia` hands
 * the app — that is the microphone; the camera's stream has no audio and the
 * system audio, off by default, would come from `getDisplayMedia` — and fires
 * `ended` on it, which is the event an unplugged device raises and the one
 * the recorder listens for. (`stop()` would not do: a track stopped by the
 * page fires no `ended`.)
 *
 * Chromium only, as the separate-tracks spec is: the mode needs WebCodecs and
 * `MediaStreamTrackProcessor`, and only Chromium can be granted camera
 * permission headlessly.
 */

const CRAFT_URL = 'http://localhost:5174'

interface StoredPart {
  role?: string
  duration: number
  /** What `decodeAudioData` makes of an audio part's bytes, in seconds; null for a video part. */
  decodedDuration: number | null
}

async function readStoredParts(page: Page): Promise<StoredPart[]> {
  return page.evaluate(
    () =>
      new Promise<StoredPart[]>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('could not open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result
            .transaction('videos', 'readonly')
            .objectStore('videos')
            .getAll()
          getAll.onerror = () => reject(new Error('could not read the videos store'))
          getAll.onsuccess = async () => {
            const records = getAll.result as { blob: Blob; metadata: Record<string, unknown> }[]
            const decode = async (blob: Blob) => {
              const context = new AudioContext()
              try {
                return (await context.decodeAudioData(await blob.arrayBuffer())).duration
              } finally {
                await context.close()
              }
            }
            try {
              resolve(
                await Promise.all(
                  records.map(async (record) => ({
                    role: record.metadata.role as string | undefined,
                    duration: record.metadata.duration as number,
                    decodedDuration: record.blob.type.startsWith('audio/')
                      ? await decode(record.blob)
                      : null,
                  }))
                )
              )
            } catch (error) {
              reject(error as Error)
            }
          }
        }
      })
  )
}

test.describe('ESCAPECRAFT separate-tracks companion length', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The mode needs WebCodecs and MediaStreamTrackProcessor, and only Chromium can be granted camera permission headlessly'
  )

  test('a microphone that ends mid-take is stored at its own length, not the take\'s', async ({ page }) => {
    test.setTimeout(120_000)
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    // After the mock's own init scripts, so this wraps the synthetic
    // getUserMedia rather than the browser's.
    await page.addInitScript(() => {
      const w = window as unknown as { __microphones: MediaStreamTrack[] }
      w.__microphones = []
      const mediaDevices = navigator.mediaDevices
      const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)
      mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        const stream = await getUserMedia(constraints)
        w.__microphones.push(...stream.getAudioTracks())
        return stream
      }
    })

    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')

    // `exact`: "Record webcam as a separate track" also matches a bare
    // "Webcam" (see separate-tracks.spec.ts).
    const sourceButton = (label: string) => page.getByRole('button', { name: label, exact: true })
    await expect(sourceButton('Screen')).toBeEnabled({ timeout: 30_000 })
    const webcam = sourceButton('Webcam')
    await expect(webcam).toBeEnabled({ timeout: 30_000 })
    await webcam.click()
    await expect(webcam).toHaveAttribute('aria-pressed', 'true')
    const separateTracks = page.getByRole('button', { name: 'Record webcam as a separate track' })
    await expect(separateTracks).toBeEnabled({ timeout: 30_000 })
    await separateTracks.click()
    await expect(separateTracks).toHaveAttribute('aria-pressed', 'true')
    await expect(sourceButton('Microphone')).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1000)

    // The microphone is unplugged.
    const ended = await page.evaluate(() => {
      const w = window as unknown as { __microphones: MediaStreamTrack[] }
      for (const track of w.__microphones) track.dispatchEvent(new Event('ended'))
      return w.__microphones.length
    })
    // At least the take's own microphone; an earlier, already-released one
    // (a permission check, say) takes the event to no effect.
    expect(ended, 'microphone tracks the app opened').toBeGreaterThanOrEqual(1)

    await page.waitForTimeout(5000)
    await page.getByRole('button', { name: 'Stop recording' }).click()

    // Three rows: the screen, the webcam and the microphone.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(3, {
      timeout: 60_000,
    })

    const parts = await readStoredParts(page)
    const primary = parts.find((part) => part.role === 'screen')!
    const mic = parts.find((part) => part.role === 'mic')!

    // The take ran ~6 s; the microphone went at ~1 s.
    expect(primary.duration, 'the take').toBeGreaterThan(5)
    expect(mic.duration, 'the microphone part as stored').toBeGreaterThan(0.5)
    expect(mic.duration, 'the microphone part as stored').toBeLessThan(3)
    // ...and the stored figure is the file's own length, not merely a smaller
    // number: within a chunk or two of what the browser decodes from it.
    expect(mic.decodedDuration, 'the microphone file decodes').not.toBeNull()
    expect(
      Math.abs(mic.duration - mic.decodedDuration!),
      `stored ${mic.duration}s against a file of ${mic.decodedDuration}s`
    ).toBeLessThan(0.3)
  })
})
