import { statSync } from 'node:fs'
import { test, expect, Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { getRecordCount } from '../../utils/indexeddb'
import { waitForAppReady } from '../../utils/ready'

/**
 * Journey: Record (ESCAPECRAFT) → hand off → Edit (ESCAPEARTIST) → Export
 *
 * The whole product in one pass, with nothing to sign up for and nothing
 * gating any step:
 *   1. Open ESCAPECRAFT and record (synthetic camera/screen media)
 *   2. The recording lands in local storage and offers "open in Editor"
 *   3. ESCAPEARTIST imports it, puts it on the timeline and edits it
 *   4. Export produces a real file download
 *
 * Chromium only: exporting goes through WebCodecs, which Firefox and WebKit
 * don't implement (see the WebCodecs constraint in the repo README).
 */

const CRAFT_URL = 'http://localhost:5174'
const ARTIST_URL = 'http://localhost:5175'

/** Pull the newest recorded blob out of ESCAPECRAFT's IndexedDB as bytes. */
async function readRecordingBytes(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('video-editor-db')
      request.onerror = () => reject(new Error('Failed to open video-editor-db'))
      request.onsuccess = () => {
        const getAll = request.result
          .transaction('videos', 'readonly')
          .objectStore('videos')
          .getAll()
        getAll.onerror = () => reject(new Error('Failed to read videos store'))
        getAll.onsuccess = async () => {
          const records = getAll.result as Array<{ blob: Blob }>
          if (records.length === 0) {
            reject(new Error('No recordings stored'))
            return
          }
          const bytes = new Uint8Array(await records[0].blob.arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          resolve(btoa(binary))
        }
      }
    })
  })

  return Buffer.from(base64, 'base64')
}

test.describe('Journey: Record, Edit, Export', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Video export uses WebCodecs, which only Chromium-based browsers implement'
  )

  test('record in ESCAPECRAFT, edit in ESCAPEARTIST, export a file', async ({
    page,
    context,
  }) => {
    // Recording plus a real encode pass takes well past the default timeout
    test.setTimeout(180_000)

    await test.step('ESCAPECRAFT opens straight into the recorder', async () => {
      await mockSyntheticMedia(page)
      await grantMediaPermissions(page)

      await page.goto(CRAFT_URL)
      await waitForAppReady(page, 'craft')

      // Nothing gates the tool — it opens straight into the recorder
      await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
      expect(await page.getByRole('dialog').count()).toBe(0)

      // Capability detection is async and the source toggles stay disabled until
      // it finishes; starting a recording before then acquires no stream. The
      // Screen row is the innermost element matching both the class and the text.
      const screenSource = page
        .locator('[class*="sourceToggle"]')
        .filter({ hasText: 'Screen' })
        .last()
      await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
    })

    await test.step('record a few seconds of video', async () => {
      await page.getByRole('button', { name: 'Start recording' }).click()

      // Countdown first, then the pause control appears once recording starts
      await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
        timeout: 30_000,
      })
      await page.waitForTimeout(2500)
      await page.getByRole('button', { name: 'Stop recording' }).click()
    })

    const recording = await test.step('the recording is saved locally', async () => {
      await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
        timeout: 30_000,
      })

      expect(await getRecordCount(page, 'video-editor-db', 'videos')).toBeGreaterThan(0)

      const bytes = await readRecordingBytes(page)
      expect(bytes.length).toBeGreaterThan(1000)
      return bytes
    })

    await test.step('"open in Editor" hands the recording to ESCAPEARTIST', async () => {
      const popupPromise = context.waitForEvent('page')
      await page.getByRole('button', { name: /Open .+ in Editor/ }).click()
      const popup = await popupPromise

      // The editor is addressed by recording id; in production both apps are
      // served from one origin and share this IndexedDB directly.
      expect(popup.url()).toMatch(/\/artist\/\?loadVideo=[0-9a-f-]+$/)
      await popup.close()
    })

    const artist = await context.newPage()

    await test.step('ESCAPEARTIST opens straight into the editor', async () => {
      // ESCSUITE-177 review "Races" 1: waitForAppReady now resolves at
      // React's first commit (attachment), earlier than the old
      // `networkidle` ever did, which can land before ARTIST's own
      // asynchronous `getSessionState()` has decided whether to raise the
      // "Resume Previous Session?" prompt. `?suppressRestore=1` means
      // ARTIST never asks in the first place, rather than racing whichever
      // lands first.
      await artist.goto(`${ARTIST_URL}?suppressRestore=1`)
      await waitForAppReady(artist, 'artist')

      await expect(artist.getByRole('button', { name: 'Export video' })).toBeVisible()
      // A retrying assertion rather than a one-shot count: belt-and-braces
      // alongside `?suppressRestore=1` above, in case anything else async
      // ever puts up a dialog here.
      await expect(artist.getByRole('dialog')).toHaveCount(0)
    })

    await test.step('import the recording and put it on the timeline', async () => {
      // The dev servers run the apps on separate ports (separate origins), so
      // the shared IndexedDB handoff isn't available here — import the very
      // same recorded bytes through the media library instead.
      await artist.locator('input[type="file"]').setInputFiles({
        name: 'e2e-recording.webm',
        mimeType: 'video/webm',
        buffer: recording,
      })

      const addToTimeline = artist.getByRole('button', { name: 'Add to timeline' })
      await expect(addToTimeline).toBeVisible({ timeout: 60_000 })
      await addToTimeline.click()

      await expect(artist.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('edit the timeline', async () => {
      await artist.getByRole('button', { name: 'Add Text' }).click()
      await expect(artist.getByText(/^2 clips ·/)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('export downloads a video file', async () => {
      const exportButton = artist.getByRole('button', { name: 'Export video' })
      await expect(exportButton).toBeEnabled()
      await exportButton.click()

      const downloadWebM = artist.getByRole('button', { name: /download webm/i })
      await expect(downloadWebM).toBeVisible({ timeout: 15_000 })

      const downloadPromise = artist.waitForEvent('download', { timeout: 120_000 })
      await downloadWebM.click()
      const download = await downloadPromise

      expect(download.suggestedFilename()).toMatch(/\.webm$/)

      // A real encoded file, not an empty placeholder
      const path = await download.path()
      expect(path).toBeTruthy()
      expect(statSync(path).size).toBeGreaterThan(1000)
    })
  })
})
