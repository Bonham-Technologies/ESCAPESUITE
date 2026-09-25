import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'

/**
 * ESCAPECRAFT records the webcam and each audio source as its own file
 * (ESCSUITE-14, slices 1 and 3).
 *
 * The take is real: `mockSyntheticMedia` hands the app an animated canvas for
 * the screen, a second one for the camera and an oscillator for each of the
 * microphone and the system audio, so `WebCodecsRecorder` genuinely runs two
 * `VideoEncoder`s, three `AudioEncoder`s and four Mediabunny outputs off one
 * clock. What is asserted is the user-visible outcome on both sides of storage:
 * four blobs under one `takeId`, the video halves loading in a `<video>` with a
 * finite duration and the audio halves decoding through Web Audio — which is
 * exactly what ESCAPEARTIST's mixer and waveform pass will do to them, so a
 * badly muxed Opus-only WebM fails here rather than in the editor — and four
 * library rows with the right labels and the right buttons.
 *
 * The fourth part needs asking for. System audio is off by default, and
 * `mockSyntheticMedia`'s `getDisplayMedia` adds its oscillator track only when
 * the capture asked for audio — which `requestScreenCapture(withSystemAudio)`
 * does exactly when that toggle is on. So this spec clicks it, and the
 * separate-tracks *benchmark* (`tests/perf/craft-recording.spec.ts`), which
 * never touches the source toggles, correctly counts three parts rather than
 * four: same app, one source fewer.
 *
 * Chromium only, and that is the feature rather than the test: the mode needs
 * `VideoEncoder` and `MediaStreamTrackProcessor`, and in a browser without them
 * the toggle is disabled with the reason said out loud
 * (`apps/craft/src/utils/separateTracksReadiness.ts`).
 */

const CRAFT_URL = 'http://localhost:5174'

interface StoredPart {
  id: string
  takeId?: string
  role?: string
  hasAudio?: boolean
  hasWebcam?: boolean
  mediaType?: string
  mimeType: string
  width: number
  height: number
  overlayPlacement?: { position: string; size: number; shape: string }
  size: number
  /**
   * What the browser makes of the stored blob: a `<video>`'s duration for a
   * video part, `decodeAudioData`'s for an audio one. A real number, or
   * "Infinity". Decoding rather than probing, for the audio parts, because
   * "an audio file the browser will not decode" is exactly the failure a
   * badly muxed Opus-only WebM would be.
   */
  reportedDuration: string
}

/**
 * Every stored recording, with what the browser makes of its blob.
 *
 * Read from the page rather than from the app's store: the claim is about what
 * reached IndexedDB, which is what ESCAPEARTIST will open (slice 2).
 */
async function readStoredParts(page: Page): Promise<StoredPart[]> {
  return page.evaluate(
    () =>
      new Promise<StoredPart[]>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('could not open video-editor-db'))
        request.onblocked = () => reject(new Error('video-editor-db is blocked by another connection'))
        request.onsuccess = () => {
          let getAll: IDBRequest<unknown[]>
          try {
            getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          } catch (error) {
            reject(new Error(`could not open the videos store — ${String(error)}`))
            return
          }
          getAll.onerror = () => reject(new Error('could not read the videos store'))
          getAll.onsuccess = async () => {
            const records = getAll.result as { id: string; blob: Blob; metadata: Record<string, unknown> }[]
            const probeVideo = (blob: Blob) =>
              new Promise<string>((done, fail) => {
                const video = document.createElement('video')
                video.preload = 'metadata'
                const url = URL.createObjectURL(blob)
                video.onloadedmetadata = () => {
                  URL.revokeObjectURL(url)
                  done(String(video.duration))
                }
                video.onerror = () => {
                  URL.revokeObjectURL(url)
                  fail(new Error(`a stored blob would not load in a <video> (${blob.size} bytes)`))
                }
                video.src = url
              })

            const probeAudio = async (blob: Blob) => {
              const context = new AudioContext()
              try {
                const decoded = await context.decodeAudioData(await blob.arrayBuffer())
                return String(decoded.duration)
              } finally {
                await context.close()
              }
            }

            const probe = (blob: Blob) =>
              blob.type.startsWith('audio/') ? probeAudio(blob) : probeVideo(blob)
            try {
              resolve(
                await Promise.all(
                  records.map(async (record) => ({
                    id: record.id,
                    takeId: record.metadata.takeId as string | undefined,
                    role: record.metadata.role as string | undefined,
                    hasAudio: record.metadata.hasAudio as boolean | undefined,
                    hasWebcam: record.metadata.hasWebcam as boolean | undefined,
                    mediaType: record.metadata.mediaType as string | undefined,
                    mimeType: record.metadata.mimeType as string,
                    width: record.metadata.width as number,
                    height: record.metadata.height as number,
                    overlayPlacement: record.metadata.overlayPlacement as StoredPart['overlayPlacement'],
                    size: record.blob.size,
                    reportedDuration: await probe(record.blob),
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

test.describe('ESCAPECRAFT separate-tracks recording', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The mode needs WebCodecs and MediaStreamTrackProcessor, and only Chromium can be granted camera permission headlessly'
  )

  test('stores the screen, the webcam and each audio source as parts of one take', async ({ page }) => {
    test.setTimeout(120_000)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // Capability detection is async; the source toggles stay disabled until it
    // answers, and a take started before then acquires no stream.
    //
    // `exact` is load-bearing, and so is *not* scoping to `[class*="sourceToggle"]`
    // the way the sibling specs do. `getByRole`'s `name` is a case-insensitive
    // substring by default, and the separate-tracks toggle below — accessible
    // name "Record webcam as a separate track", inside a wrapper that reuses the
    // same `sourceToggle` class — matches a bare `Webcam`. Scope-and-`.last()`
    // therefore stops addressing the webcam source the moment that toggle
    // appears. The exact aria-labels ("Screen", "Webcam") are unique app-wide.
    const sourceButton = (label: string) =>
      page.getByRole('button', { name: label, exact: true })

    await expect(sourceButton('Screen')).toBeEnabled({ timeout: 30_000 })
    const webcam = sourceButton('Webcam')
    await expect(webcam).toBeEnabled({ timeout: 30_000 })
    await webcam.click()
    await expect(webcam).toHaveAttribute('aria-pressed', 'true')

    // The toggle exists only while the webcam is on, and is off by default.
    const separateTracks = page.getByRole('button', { name: 'Record webcam as a separate track' })
    await expect(separateTracks).toBeEnabled({ timeout: 30_000 })
    await expect(separateTracks).toHaveAttribute('aria-pressed', 'false')
    await separateTracks.click()
    await expect(separateTracks).toHaveAttribute('aria-pressed', 'true')

    // The microphone is on by ESCAPECRAFT's own default, and the mic part is
    // asserted below — so the default is stated here rather than assumed: if it
    // ever flips, this fails where it is legible instead of as a missing part.
    await expect(sourceButton('Microphone')).toHaveAttribute('aria-pressed', 'true')

    // System audio is off by default, and `mockSyntheticMedia`'s
    // getDisplayMedia only adds an oscillator track when the capture asked for
    // one — which `requestScreenCapture(withSystemAudio)` does exactly when
    // this toggle is on. With it on, the take has all four sources: screen,
    // camera, microphone and system audio.
    const systemAudio = sourceButton('System Audio')
    await expect(systemAudio).toBeEnabled({ timeout: 30_000 })
    await systemAudio.click()
    await expect(systemAudio).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Stop recording' }).click()

    // Four rows, so every part was saved.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(4, {
      timeout: 60_000,
    })

    const parts = await readStoredParts(page)
    expect(parts).toHaveLength(4)
    const primary = parts.find((part) => part.role === 'screen')!
    const webcamPart = parts.find((part) => part.role === 'webcam')!
    const mic = parts.find((part) => part.role === 'mic')!
    const system = parts.find((part) => part.role === 'system')!

    // One take in four files.
    expect(primary.takeId).toBe(primary.id)
    for (const part of [webcamPart, mic, system]) {
      expect(part.takeId).toBe(primary.id)
      expect(part.id).not.toBe(primary.id)
    }

    // Every part is real and the browser can read it: the video halves load in
    // a <video> with a finite duration (Mediabunny writes Duration and Cues,
    // so neither needs the MediaRecorder repair), and the audio halves decode
    // through Web Audio, which is what ARTIST's audioMixer and waveform pass
    // will do to them.
    for (const part of [primary, webcamPart, mic, system]) {
      expect(part.size).toBeGreaterThan(1000)
      expect(Number.isFinite(Number(part.reportedDuration))).toBe(true)
      expect(Number(part.reportedDuration)).toBeGreaterThan(0)
    }

    // The mix stays on the primary — a screen-only download still has sound —
    // and each audio source is its own file besides.
    expect(primary.hasAudio).toBe(true)
    expect(webcamPart.hasAudio).toBe(false)
    expect(primary.hasWebcam).toBe(true)
    for (const part of [mic, system]) {
      expect(part.hasAudio).toBe(true)
      expect(part.hasWebcam).toBe(false)
      // Stored as audio, with no dimensions — the shape ESCAPEARTIST's own
      // audio importer produces, so an imported part behaves like an
      // uploaded one.
      expect(part.mediaType).toBe('audio')
      expect(part.mimeType).toBe('audio/webm')
      expect(part.width).toBe(0)
      expect(part.height).toBe(0)
      expect(part.overlayPlacement).toBeUndefined()
    }

    // The overlay geometry the take was recorded with, for ARTIST and for the
    // composite MP4 (slice 4).
    expect(primary.overlayPlacement).toEqual({
      position: 'bottom-right',
      size: 0.2,
      shape: 'circle',
    })
    expect(webcamPart.overlayPlacement).toBeUndefined()

    // ...and the library says which row is which, with the right buttons.
    await expect(page.getByText(/^Webcam track • /)).toHaveCount(1)
    await expect(page.getByText(/^Microphone track • /)).toHaveCount(1)
    await expect(page.getByText(/^System audio track • /)).toHaveCount(1)
    // Nothing on the primary row claims the downloads leave the camera out:
    // slice 4 made MP4 the composite, and M4A always had the whole mix.
    await expect(page.getByText(/not included yet/)).toHaveCount(0)
    // Conversions on the primary row only — one MP4 and one M4A in the whole
    // library, however many parts the take has.
    await expect(page.getByRole('button', { name: /Download .+ as MP4/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Download .+ as audio \(M4A\)/ })).toHaveCount(1)
    // One WebM download per row, so every part is reachable on its own.
    await expect(page.getByRole('button', { name: /^Download (?!.*as ).+/ })).toHaveCount(4)
  })
})
