import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-398: in Safari, Start never reached the recording state.
 *
 * Without `MediaStreamTrackProcessor` (Safari and Firefox), the WebCodecs
 * recorder reads frames off a `<video>` of its own. It built that element
 * `visibility:hidden` and awaited its `play()` with no bound. WebKit renders a
 * MediaStream only into an element laid out on screen, so that `play()` never
 * settled, and neither did Start. An on-screen but transparent element does
 * play in WebKit, but not reliably while CRAFT's preview already renders the
 * same track.
 *
 * Now the take's own element is transparent rather than hidden, a capture that
 * has not started in time borrows the preview, and with nothing playing at all
 * the take fails with a notice.
 *
 * The init script reproduces WebKit's rules in any engine: it removes
 * `MediaStreamTrackProcessor`, so the fallback runs, and makes `play()` never
 * settle for the elements WebKit would not play. In the nightly's WebKit
 * project the real rules apply as well.
 */

const VIDEO_CAPTURE_UNAVAILABLE =
  'The picture could not be read for recording (the browser never started playing it) — nothing was recorded. Try again, or use Chrome or Edge.'

/** Which `<video>` elements the init script refuses to play. */
type Refuse = 'hidden' | 'capture-element' | 'every-video'

async function openCraft(page: Page, refuse: Refuse): Promise<void> {
  await page.addInitScript((refuse: Refuse) => {
    delete (window as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const source = this.srcObject
      const trackIds = source instanceof MediaStream ? source.getVideoTracks().map((t) => t.id) : []
      if (trackIds.length > 0) {
        const never = new Promise<void>(() => {})
        if (refuse === 'every-video') return never
        if (refuse === 'hidden' && getComputedStyle(this).visibility === 'hidden') return never
        // The recorder's own element is the one appended straight to <body>;
        // CRAFT's preview lives inside the app.
        if (refuse === 'capture-element' && this.parentElement === document.body) return never
      }
      return play.call(this)
    }
    if (refuse === 'every-video') {
      // The preview autoplays without calling play(), so it would still have
      // frames to lend: report no frame anywhere, as a browser that renders none.
      const readyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')!
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        configurable: true,
        get(this: HTMLMediaElement) {
          return this.srcObject instanceof MediaStream ? HTMLMediaElement.HAVE_NOTHING : readyState.get!.call(this)
        },
      })
    }
  }, refuse)
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')
  // Capability detection is async; Start acquires no stream if clicked before
  // it finishes.
  const screenSource = page
    .locator('[class*="sourceToggle"]')
    .filter({ hasText: 'Screen' })
    .last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
}

/** Record a short screen take and wait for it to be saved. */
async function recordATake(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500) // a take's length, not an arbitrary pause
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })
}

test.describe('ESCSUITE-398: Start never hangs on frame capture', () => {
  test('a browser that will not play a hidden video still records', async ({ page, browserName }) => {
    // The take is saved to IndexedDB, which Playwright's WebKit refuses Blobs
    // in (ESCSUITE-397); reaching the recording state is this ticket's part.
    await openCraft(page, 'hidden')
    if (browserName === 'webkit') {
      await page.getByRole('button', { name: 'Start recording' }).click()
      await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 20_000 })
      return
    }
    await recordATake(page)
  })

  // WebKit's own rule, measured: an on-screen transparent element plays alone,
  // but with the preview already rendering the track it started in about one
  // run in six. Here it never does, so the take has to borrow the preview.
  test('a capture video that never starts borrows the preview of the same track', async ({ page, browserName }) => {
    await openCraft(page, 'capture-element')
    if (browserName === 'webkit') {
      await page.getByRole('button', { name: 'Start recording' }).click()
      await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 20_000 })
      return
    }
    await recordATake(page)
  })

  test('with no video playing at all, the take fails with a notice', async ({ page }) => {
    await openCraft(page, 'every-video')
    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByText(VIDEO_CAPTURE_UNAVAILABLE)).toBeVisible({ timeout: 20_000 })
    // Back to idle: Start is offered again and no take is running.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toHaveCount(0)
  })
})
