import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-395: a take whose last Cluster held a single block was saved with a
 * Duration about one Cluster short, so CRAFT's own player showed a 3 s
 * microphone take as 0:02 (it takes the length from the file once it is
 * finite) and other players did the same with the downloaded file.
 *
 * `webm-duration-fix` takes the last frame's length from the gap between the
 * last two blocks; when the final Cluster holds one block, the one before it
 * is in the previous Cluster with a larger relative timecode, and the gap is
 * negative. The save now floors the Duration at the last block.
 *
 * Which blocks land in the last Cluster is up to the browser's muxer, so the
 * spec cannot wait for a real recording to end that way. An init script lets
 * the real MediaRecorder record a microphone-only take and hands the app the
 * fixture's bytes in its place (`fixtures/last-cluster-one-block/README.md`):
 * a MediaRecorder-shaped Opus take with blocks every 20 ms to 3000 ms and a
 * Cluster every second, the last one holding the 3000 ms block alone. The
 * save repairs it exactly as it would a real take. Before the fix the stored
 * Duration was 2020 ms.
 */

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = readFileSync(
  resolve(here, '../../fixtures/last-cluster-one-block/mic-take-last-cluster-one-block.webm')
).toString('base64')

test('a take whose last Cluster holds one block plays back at its full length', async ({ page, browserName }) => {
  // Same WebKit Blob-in-IndexedDB gap as the other real recording specs
  // (ESCSUITE-177): this test needs the take saved at the end.
  test.skip(
    browserName === 'webkit',
    'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
  )
  test.setTimeout(120_000)
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.addInitScript((base64: string) => {
    const take = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'audio/webm' })
    const Real = window.MediaRecorder
    class FixtureRecorder extends Real {
      private delivered = false
      get ondataavailable() {
        return super.ondataavailable
      }
      set ondataavailable(handler: ((this: MediaRecorder, event: BlobEvent) => unknown) | null) {
        super.ondataavailable = handler
          ? () => {
              // The whole take arrives in the first chunk; later chunks are
              // empty, which the recorder drops.
              const data = this.delivered ? new Blob([]) : take
              this.delivered = true
              return handler.call(this, { data } as BlobEvent)
            }
          : null
      }
    }
    window.MediaRecorder = FixtureRecorder
  }, FIXTURE)

  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')

  // A microphone-only take goes through MediaRecorder, and so through the repair.
  const screen = page.getByRole('button', { name: 'Screen', exact: true })
  await expect(screen).toBeEnabled({ timeout: 30_000 })
  await screen.click()
  await expect(screen).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
  // Long enough for MediaRecorder to deliver a chunk (it is started with a 1 s timeslice).
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()

  await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole('button', { name: /^Play / }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Without the fix: "0:00 / 0:02".
  await expect(dialog.locator('[class*="timeDisplay"]')).toHaveText(/\/ 0:03$/, { timeout: 15_000 })
})
