import { expect, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * Driving a PiP take in ESCAPECRAFT and asking whether what it stored is
 * seekable.
 *
 * A PiP take (screen + webcam) is the interesting one: `recorder-factory.ts`
 * sends it down the **MediaRecorder** path, which is the only path whose output
 * needs repairing — `useRecordingSave` runs `fixWebMMetadata()` (and so
 * `webm-duration-fix`) over it before storing. A screen-only take in Chromium
 * takes the WebCodecs path instead and never touches that code, which is why
 * every other ESCAPECRAFT spec stayed green while the repair was broken.
 *
 * "Seekable" is asserted as the property a user would notice rather than as
 * bytes: an unrepaired MediaRecorder WebM has no Duration element, so a
 * `<video>` fed the stored blob reports `duration === Infinity` on
 * `loadedmetadata` and will not scrub. A repaired one reports a real number.
 *
 * Shared by the dev-server spec (`tests/escapecraft/pip-seekable.spec.ts`) and
 * the production-layout one (`tests/production/pip-seekable.spec.ts`) so the
 * two cannot drift: the whole point is that both build pipelines are checked.
 */

/**
 * The `NOT_SEEKABLE` notice. `apps/e2e` has no dependency on craft, so the text
 * can only be copied — and a copy asserted with `toHaveCount(0)` passes when it
 * goes stale, which is the wrong failure direction. The full string is kept here
 * as documentation (it is verbatim from `apps/craft/src/utils/notices.ts`) and
 * the assertion is made against the fragment below, which survives rewording of
 * the sentence around it.
 */
export const NOT_SEEKABLE_NOTICE =
  'Saved, but the recording may not be seekable — the container repair failed.'

/** The load-bearing part of it, which is what gets asserted. */
export const NOT_SEEKABLE_FRAGMENT = /may not be seekable/

export interface ConsoleCapture {
  /** Every console line and page error, newest last. */
  readonly messages: string[]
  /** Lines matching `pattern`. */
  matching(pattern: RegExp): string[]
}

/** Record everything the page says, so a swallowed failure still leaves a trace. */
export function captureConsole(page: Page): ConsoleCapture {
  const messages: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    messages.push(`[${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    messages.push(`[pageerror] ${error.message}`)
  })
  return {
    messages,
    matching: (pattern: RegExp) => messages.filter((line) => pattern.test(line)),
  }
}

/**
 * Record one PiP take (screen + webcam) and wait for it to reach the library.
 *
 * `mockSyntheticMedia` / `grantMediaPermissions` must already have been applied
 * and the page must not yet have navigated.
 */
export async function recordPipTake(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')

  // Capability detection is async; the source toggles stay disabled until it
  // finishes and a take started before then acquires no stream.
  //
  // `exact` is load-bearing, and so is *not* scoping to `[class*="sourceToggle"]`.
  // `getByRole`'s `name` is a case-insensitive substring by default, and
  // ESCAPECRAFT's "Record webcam as a separate track" toggle (ESCSUITE-14)
  // contains "webcam" — so a bare `Webcam` matches it too, and scope-and-`.last()`
  // stopped addressing the webcam source the moment that toggle appeared (it is
  // rendered only once screen and webcam are both on, which is exactly this
  // helper's second step). That toggle's wrapper no longer shares the source
  // rows' `sourceToggle` class either (ESCSUITE-68), but the substring match is
  // the half of the trap a class cannot fix, so `exact` stays. The exact
  // aria-labels ("Screen", "Webcam") are unique app-wide.
  const sourceButton = (label: string) =>
    page.getByRole('button', { name: label, exact: true })

  await expect(sourceButton('Screen')).toBeEnabled({ timeout: 30_000 })
  const webcam = sourceButton('Webcam')
  await expect(webcam).toBeEnabled({ timeout: 30_000 })

  // Screen is on by default; adding the webcam makes it a PiP take, which is
  // what routes the recording through the compositor and MediaRecorder.
  await webcam.click()
  await expect(webcam).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
    timeout: 30_000,
  })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
    timeout: 30_000,
  })
}

export interface StoredDuration {
  /** Whether `<video>.duration` was a real number on `loadedmetadata`. */
  finite: boolean
  /** What it reported, stringified — `"Infinity"` for an unrepaired WebM. */
  reported: string
  /** Bytes stored, so an empty take cannot pass as a seekable one. */
  size: number
}

/**
 * Load the stored recording out of `video-editor-db` and report what a `<video>`
 * makes of it. Reads the blob the app actually wrote, not the one it offered for
 * download, so a repair that silently fell back to the raw blob is visible here.
 *
 * `getAll()` returns key order and the keys are uuid v4, so "last" is not
 * "newest" — this is only unambiguous because the callers record exactly one
 * take in a fresh browser context. Recording a second take before calling this
 * would need the store queried by `createdAt` instead.
 */
export async function storedRecordingDuration(page: Page): Promise<StoredDuration> {
  return page.evaluate(() => {
    return new Promise<{ finite: boolean; reported: string; size: number }>((resolve, reject) => {
      const request = indexedDB.open('video-editor-db')
      request.onerror = () => reject(new Error('Failed to open video-editor-db'))
      request.onsuccess = () => {
        const getAll = request.result
          .transaction('videos', 'readonly')
          .objectStore('videos')
          .getAll()
        getAll.onerror = () => reject(new Error('Failed to read videos store'))
        getAll.onsuccess = () => {
          const records = getAll.result as Array<{ blob: Blob }>
          if (records.length === 0) {
            reject(new Error('No recordings stored'))
            return
          }
          const blob = records[records.length - 1].blob
          const video = document.createElement('video')
          video.preload = 'metadata'
          const objectUrl = URL.createObjectURL(blob)
          const done = (outcome: { finite: boolean; reported: string; size: number }) => {
            URL.revokeObjectURL(objectUrl)
            resolve(outcome)
          }
          video.onloadedmetadata = () =>
            done({
              finite: Number.isFinite(video.duration),
              reported: String(video.duration),
              size: blob.size,
            })
          video.onerror = () => {
            URL.revokeObjectURL(objectUrl)
            reject(new Error('The stored blob would not load in a <video>'))
          }
          video.src = objectUrl
        }
      }
    })
  })
}

/**
 * The whole assertion, so the two specs say the same thing: nothing in the
 * console blamed `webm-duration-fix`, no `NOT_SEEKABLE` notice reached the
 * header's live region, and the stored blob has a finite duration.
 */
export async function expectSeekableTake(page: Page, log: ConsoleCapture): Promise<void> {
  // The property that matters first, so a failure says what the user would see
  // rather than which line logged about it.
  const stored = await storedRecordingDuration(page)
  expect(stored.size).toBeGreaterThan(1000)
  expect(
    stored.finite,
    `stored recording reported duration ${stored.reported}; an unrepaired MediaRecorder WebM reports Infinity`
  ).toBe(true)
  expect(Number(stored.reported)).toBeGreaterThan(0)

  await expect(page.getByText(NOT_SEEKABLE_FRAGMENT)).toHaveCount(0)
  expect(log.matching(/fixWebmDuration is not a function/)).toEqual([])
  expect(log.matching(/WebM metadata repair failed/)).toEqual([])
}
