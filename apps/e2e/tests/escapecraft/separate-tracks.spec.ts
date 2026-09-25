import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { canConvertToMp4 } from '../../utils/webcodecs'

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

/**
 * Record one real four-part take: screen, camera, microphone and system audio.
 *
 * Shared by both tests in this file, because both need the same take and only
 * one of them is about how it was made. Every wait and every `aria-pressed`
 * check is the original test's, unchanged — a click that did not land would
 * otherwise show up as a missing part rather than as a missing click.
 */
async function recordSeparateTracksTake(page: Page): Promise<void> {
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
  // name "Record webcam as a separate track" — matches a bare `Webcam`.
  // Scope-and-`.last()` therefore stops addressing the webcam source the moment
  // that toggle appears. Its wrapper carries its own `separateTracksToggle`
  // class since ESCSUITE-68, so the scoped shape is no longer ambiguous either —
  // but the substring name match is the half of the trap a class cannot fix.
  // The exact aria-labels ("Screen", "Webcam") are unique app-wide.
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
}

test.describe('ESCAPECRAFT separate-tracks recording', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The mode needs WebCodecs and MediaStreamTrackProcessor, and only Chromium can be granted camera permission headlessly'
  )

  test('stores the screen, the webcam and each audio source as parts of one take', async ({ page }) => {
    test.setTimeout(120_000)

    await recordSeparateTracksTake(page)

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

  /** What the page makes of a downloaded MP4, and of one frame of it. */
  interface Mp4Probe {
    width: number
    height: number
    duration: number
    /** Widest per-channel range inside the overlay's own box. */
    overlaySpread: number
    /** …and inside a box of the same size on the other side of the frame. */
    plainSpread: number
  }

  /**
   * Decode `base64` in the page, draw a frame from the middle of it, and measure
   * how much the pixels vary in two boxes.
   *
   * `mockSyntheticMedia` paints a flat `hsl()` fill with one line of text near
   * the vertical centre, so a screen-only frame is uniform in *both* boxes to
   * within codec noise. The overlay — its white border, the circular clip's
   * edges, the camera's own picture — is the only thing that can put a large
   * range into one box and not the other, which makes this claim independent of
   * which hue either source canvas happened to be on.
   */
  async function probeMp4(page: Page, base64: string): Promise<Mp4Probe> {
    return page.evaluate(async (encoded) => {
      const binary = atob(encoded)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error('the downloaded MP4 would not load in a <video>'))
          video.src = url
        })
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve()
          video.onerror = () => reject(new Error('the downloaded MP4 would not seek'))
          video.currentTime = video.duration / 2
        })

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)

        // The overlay's box: bottom-right, 20% of the width, 16:9, 20px inset —
        // the default placement, which is what this take was recorded with.
        const boxWidth = Math.round(canvas.width * 0.2)
        const boxHeight = Math.round((boxWidth * 9) / 16)
        const inset = 20
        const spread = (x: number, y: number): number => {
          const { data } = ctx.getImageData(x, y, boxWidth, boxHeight)
          const min = [255, 255, 255]
          const max = [0, 0, 0]
          for (let i = 0; i < data.length; i += 4) {
            for (let channel = 0; channel < 3; channel++) {
              const value = data[i + channel]
              if (value < min[channel]) min[channel] = value
              if (value > max[channel]) max[channel] = value
            }
          }
          return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
        }

        const boxY = canvas.height - boxHeight - inset
        return {
          width: canvas.width,
          height: canvas.height,
          duration: video.duration,
          overlaySpread: spread(canvas.width - boxWidth - inset, boxY),
          plainSpread: spread(inset, boxY),
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }, base64)
  }

  test('downloads one MP4 with the webcam composited back into it', async ({ page }) => {
    test.setTimeout(240_000)

    await recordSeparateTracksTake(page)
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(4, {
      timeout: 60_000,
    })
    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264')

    const parts = await readStoredParts(page)
    const primary = parts.find((part) => part.role === 'screen')!

    // One MP4 button in the whole library, on the primary row: the conversions
    // are the take's, not a part's.
    const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ })
    await expect(mp4Button).toHaveCount(1)
    await expect(mp4Button).toBeEnabled()

    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
    await mp4Button.click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp4$/)
    const bytes = readFileSync(await download.path())
    expect(bytes.byteLength).toBeGreaterThan(1000)

    // Not merely "a file arrived": the bytes go back into the page and are
    // decoded there. An MP4 the browser cannot read is not a video.
    const probe = await probeMp4(page, bytes.toString('base64'))
    // The composite is the *screen's* frame with the camera drawn into it, so
    // it is the screen part's size and not the camera's.
    expect(probe.width).toBe(primary.width)
    expect(probe.height).toBe(primary.height)
    expect(probe.duration).toBeGreaterThan(1)

    // The synthetic screen is a flat fill, so the left-hand box is uniform to
    // within codec noise…
    expect(probe.plainSpread).toBeLessThanOrEqual(12)
    // …and the corner the overlay was recorded in is not. This is the claim:
    // without the composite these two numbers would be the same.
    expect(probe.overlaySpread).toBeGreaterThan(60)

    // Back to idle: no progress row, and the button live again.
    await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toHaveCount(0)
    await expect(mp4Button).toBeEnabled()
    // Nothing was said: the file is what was asked for. (A camera part that
    // could not be read would say so — see MP4_SAVED_WITHOUT_WEBCAM.)
    await expect(page.getByText(/without the webcam/)).toHaveCount(0)
  })
})
