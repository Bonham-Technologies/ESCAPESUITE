import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'

/**
 * ESCAPECRAFT records the webcam as its own file (ESCSUITE-14, slice 1).
 *
 * The take is real: `mockSyntheticMedia` hands the app an animated canvas for
 * the screen, a second one for the camera and an oscillator for the microphone,
 * so `WebCodecsRecorder` genuinely runs two `VideoEncoder`s and two Mediabunny
 * outputs off one clock. What is asserted is the user-visible outcome on both
 * sides of storage: two blobs under one `takeId`, each loading in a `<video>`
 * with a finite duration, and two library rows with the right labels and the
 * right buttons.
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
  overlayPlacement?: { position: string; size: number; shape: string }
  size: number
  /** What a <video> made of the stored blob: a real number, or "Infinity". */
  reportedDuration: string
}

/**
 * Every stored recording, with what a `<video>` makes of its blob.
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
            const probe = (blob: Blob) =>
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
            try {
              resolve(
                await Promise.all(
                  records.map(async (record) => ({
                    id: record.id,
                    takeId: record.metadata.takeId as string | undefined,
                    role: record.metadata.role as string | undefined,
                    hasAudio: record.metadata.hasAudio as boolean | undefined,
                    hasWebcam: record.metadata.hasWebcam as boolean | undefined,
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

  test('stores the screen and the webcam as two parts of one take', async ({ page }) => {
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

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Stop recording' }).click()

    // Two rows, so both parts were saved.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(2, {
      timeout: 60_000,
    })

    const parts = await readStoredParts(page)
    expect(parts).toHaveLength(2)
    const primary = parts.find((part) => part.role === 'screen')!
    const companion = parts.find((part) => part.role === 'webcam')!
    // One take in two files.
    expect(primary.takeId).toBe(primary.id)
    expect(companion.takeId).toBe(primary.id)
    // Both are real, seekable WebM — Mediabunny writes Duration and Cues, so
    // neither needs the MediaRecorder repair.
    for (const part of [primary, companion]) {
      expect(part.size).toBeGreaterThan(1000)
      expect(Number.isFinite(Number(part.reportedDuration))).toBe(true)
      expect(Number(part.reportedDuration)).toBeGreaterThan(0)
    }
    // Slice 1 leaves the mixed audio on the primary; the webcam half is silent.
    expect(primary.hasAudio).toBe(true)
    expect(companion.hasAudio).toBe(false)
    expect(primary.hasWebcam).toBe(true)
    // The overlay geometry the take was recorded with, for ARTIST (slice 2) and
    // for the composite MP4 (slice 4).
    expect(primary.overlayPlacement).toEqual({
      position: 'bottom-right',
      size: 0.2,
      shape: 'circle',
    })
    expect(companion.overlayPlacement).toBeUndefined()

    // ...and the library says which row is which, with the right buttons.
    await expect(page.getByText(/^Webcam track • /)).toHaveCount(1)
    await expect(
      page.getByText('MP4 and M4A cover the screen track only — the webcam track is not included yet.')
    ).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Download .+ — webcam as MP4/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Download .+ — webcam as audio \(M4A\)/ })).toHaveCount(0)
    // One WebM download per row, so the webcam file is reachable on its own.
    await expect(page.getByRole('button', { name: /^Download (?!.*as ).+/ })).toHaveCount(2)
  })
})
