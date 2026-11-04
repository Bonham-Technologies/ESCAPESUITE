import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-412: ESCAPEARTIST refused to export a fresh ESCAPECRAFT take in
 * Chromium — "This browser cannot read "e2e-recording.webm" frame by frame
 * (its seeks never completed). … or export in Chrome or Edge." — and turned
 * main red twice in a week through the record → edit → export journey.
 *
 * The take was the cause, not the machine. Two of its frames were captured
 * inside one 30 fps slot, which Mediabunny snaps them onto, so its key frame
 * at 2.033 s shares a WebM timecode with the delta frame before it, and
 * Chromium never finishes a seek past it (fixtures/seek-wedge/README.md). The export's element wedged at
 * frame 62 of 150, every time, and ESCSUITE-370's grace only made each of its
 * three requests longer.
 *
 * The exporter now reloads a source whose seeks stop completing, once, from a
 * copy whose timestamps all advance, before it refuses; and the refusal no
 * longer sends a Chromium user to Chrome or Edge.
 *
 *   * The CI take itself, imported and exported: before the fix it is refused
 *     at frame 62. Every frame the encoder is handed has the take drawn on it:
 *     the reload comes on the first wedged seek and that frame is composed
 *     again, where reloading on the third left frames 62 and 63 black.
 *   * The same take with its export `<video>` forced to never fire `seeked`
 *     on its first three requests: before the fix it is refused; now the
 *     first reloads the source, the fresh element outlasts the other two,
 *     and the export finishes.
 *   * Forced to never finish a seek at all, reload included: the refusal's
 *     copy is Chromium's own.
 *
 * Chromium only: the wedge, and the copy, are Chromium's.
 */

const TAKE = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/seek-wedge/craft-take-shared-key-timestamp.webm'
)

/**
 * Make the export's `<video>`s — the detached, `crossOrigin` ones the
 * exporter builds; the preview's live in the document — swallow their seeks
 * once `window.__wedgeSeeks` is set: `currentTime` stays put, `seeking` reads
 * true and `readyState` 1, and no `seeked` fires, as a wedged element does.
 * `limit` is how many requests are swallowed in all, across every element;
 * the rewind to 0 is never one of them.
 */
async function wedgeExportSeeks(page: Page, limit: number): Promise<void> {
  await page.addInitScript((max) => {
    const proto = HTMLMediaElement.prototype
    const currentTime = Object.getOwnPropertyDescriptor(proto, 'currentTime')!
    const seeking = Object.getOwnPropertyDescriptor(proto, 'seeking')!
    const readyState = Object.getOwnPropertyDescriptor(proto, 'readyState')!
    const wedged = new WeakSet<HTMLMediaElement>()
    let swallowed = 0
    const w = window as unknown as { __wedgeSeeks?: boolean; __swallowedSeeks?: number }
    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return currentTime.get!.call(this)
      },
      set(this: HTMLMediaElement, value: number) {
        const exportElement = this instanceof HTMLVideoElement && !this.isConnected && this.crossOrigin === 'anonymous'
        if (w.__wedgeSeeks && exportElement && value > 0 && swallowed < max) {
          swallowed += 1
          w.__swallowedSeeks = swallowed
          wedged.add(this)
          return
        }
        wedged.delete(this)
        currentTime.set!.call(this, value)
      },
    })
    Object.defineProperty(proto, 'seeking', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return wedged.has(this) || seeking.get!.call(this)
      },
    })
    Object.defineProperty(proto, 'readyState', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return wedged.has(this) ? 1 : readyState.get!.call(this)
      },
    })
  }, limit)
}

/**
 * Count the export's video frames, and those the encoder was handed with no
 * export `<video>` (detached, `crossOrigin`, as above) drawn since the frame
 * before: a frame whose source was wedged, drawn as the black fill alone.
 */
async function countUndrawnExportFrames(page: Page): Promise<() => Promise<{ encoded: number; undrawn: number }>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __exportFrames: { encoded: number; undrawn: number } }
    w.__exportFrames = { encoded: 0, undrawn: 0 }
    let drawn = false
    const drawImage = CanvasRenderingContext2D.prototype.drawImage as (...args: unknown[]) => void
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const [image] = args
      if (image instanceof HTMLVideoElement && !image.isConnected && image.crossOrigin === 'anonymous') drawn = true
      drawImage.apply(this, args)
    } as typeof CanvasRenderingContext2D.prototype.drawImage
    const encode = VideoEncoder.prototype.encode
    VideoEncoder.prototype.encode = function (this: VideoEncoder, ...args: Parameters<VideoEncoder['encode']>) {
      w.__exportFrames.encoded += 1
      if (!drawn) w.__exportFrames.undrawn += 1
      drawn = false
      return encode.apply(this, args)
    }
  })
  return () => page.evaluate(() => (window as unknown as { __exportFrames: { encoded: number; undrawn: number } }).__exportFrames)
}

/** Open ARTIST with the CI take on the timeline. */
async function openWithTake(page: Page): Promise<void> {
  await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, TAKE)
}

/** Export as WebM; the downloaded file's size, or the failure the dialog showed. */
async function exportWebM(page: Page): Promise<{ size: number } | { failure: string }> {
  await openExportDialog(page)
  const download = page.waitForEvent('download', { timeout: 120_000 })
  const failed = page.getByRole('alert').filter({ hasText: 'Export failed' })
  const failure = failed.waitFor({ state: 'visible', timeout: 120_000 }).then(() => failed.innerText())
  download.catch(() => {})
  failure.catch(() => {})
  await page.getByRole('button', { name: /download webm/i }).click()
  return Promise.race([
    download.then(async (d) => ({ size: statSync((await d.path())!).size })),
    failure.then((text) => ({ failure: text })),
  ])
}

test.describe('ESCSUITE-412: a CRAFT take whose seeks wedge in Chromium still exports', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', "The wedge and the refusal's copy are Chromium's")

  test('the take CI recorded, whose key frame shares a timecode, exports in full', async ({ page }) => {
    test.setTimeout(150_000)
    const reloads: string[] = []
    page.on('console', (m) => {
      if (m.text().includes('reloaded it from a repaired copy')) reloads.push(m.text())
    })
    const exportFrames = await countUndrawnExportFrames(page)
    await openWithTake(page)

    const outcome = await exportWebM(page)

    expect(outcome, 'the export failed instead of downloading').not.toHaveProperty('failure')
    expect((outcome as { size: number }).size).toBeGreaterThan(1000)
    // The export got past the take's own wedge by the reload, not by luck.
    expect(reloads).toHaveLength(1)
    // And no frame went into the file without the take on it.
    const { encoded, undrawn } = await exportFrames()
    expect(encoded).toBeGreaterThan(80)
    expect(undrawn, `${undrawn} of ${encoded} exported frames were black`).toBe(0)
  })

  test('an export whose first three seeks never complete reloads the source and finishes', async ({ page }) => {
    test.setTimeout(150_000)
    await wedgeExportSeeks(page, 3)
    await openWithTake(page)
    await page.evaluate(() => {
      ;(window as unknown as { __wedgeSeeks: boolean }).__wedgeSeeks = true
    })

    const outcome = await exportWebM(page)

    expect(await page.evaluate(() => (window as unknown as { __swallowedSeeks?: number }).__swallowedSeeks)).toBe(3)
    expect(outcome, 'the export failed instead of downloading').not.toHaveProperty('failure')
    expect((outcome as { size: number }).size).toBeGreaterThan(1000)
  })

  test("an export whose seeks never complete, even after the reload, refuses in Chromium's own words", async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await wedgeExportSeeks(page, Number.MAX_SAFE_INTEGER)
    await openWithTake(page)
    await page.evaluate(() => {
      ;(window as unknown as { __wedgeSeeks: boolean }).__wedgeSeeks = true
    })

    const outcome = await exportWebM(page)

    expect(outcome).toHaveProperty('failure')
    const { failure } = outcome as { failure: string }
    expect(failure).toContain('cannot read "craft-take-shared-key-timestamp.webm" frame by frame')
    // This is Chromium: sending the user to Chrome or Edge would send them nowhere.
    expect(failure).not.toMatch(/Chrome or Edge/)
  })
})
