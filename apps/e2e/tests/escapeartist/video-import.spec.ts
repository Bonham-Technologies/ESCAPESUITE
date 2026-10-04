import { test, expect } from '@playwright/test'
import {
  ARTIST_FIXTURE_MP4,
  importMediaAndAddToTimeline,
  seedTextClip,
  openExportDialog,
  openExportAdvancedOptions,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEARTIST Video Import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('server responds', async ({ page }) => {
    // The editor itself is what "responds" — a doctype/`<div id="root">`
    // check survives any amount of React failure (ESCSUITE-201/202 K-3), so
    // assert the control every other test in this describe depends on.
    await expect(page.getByText('Media Library')).toBeVisible()
  })

  test('shows import/upload button', async ({ page }) => {
    // The real drop zone (`VideoUploader.tsx`) — its file `<input>` is
    // `display: none`, so the visible affordance is its own text.
    await expect(page.getByText('Drop media or click to browse')).toBeVisible()
  })

  test('has media library section', async ({ page }) => {
    await expect(page.getByText('Media Library')).toBeVisible()

    // A real import actually lands a row in it, under the file's own name.
    await page.locator('input[type="file"]').setInputFiles(ARTIST_FIXTURE_MP4)
    await expect(page.getByText('source.mp4')).toBeVisible({ timeout: 30_000 })
  })

  test('has timeline component', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add new track' })).toBeVisible()
    // Even an empty project has a track to hold whatever lands on it.
    await expect(page.locator('[data-track-id]')).toHaveCount(1)

    await importMediaAndAddToTimeline(page)
  })

  test('has preview area with canvas', async ({ page }) => {
    // Before anything is on the timeline there is no canvas at all — just
    // the "Add clips to the timeline to preview" placeholder — so the real
    // claim this test makes needs a clip on it first.
    await expect(page.locator('canvas')).toHaveCount(0)

    await importMediaAndAddToTimeline(page)

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()

    // And it actually draws the imported source, not an empty backing store.
    await page.getByTitle('Go to start (Home)').click()
    const countNonBlackPixels = () =>
      page.evaluate(() => {
        const el = document.querySelector('canvas') as HTMLCanvasElement
        const ctx = el.getContext('2d')!
        const { data } = ctx.getImageData(0, 0, el.width, el.height)
        let count = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) count++
        }
        return count
      })
    // Polled rather than a fixed sleep: the decode settles asynchronously
    // after the seek, and a poll only waits as long as it actually takes.
    await expect.poll(countNonBlackPixels).toBeGreaterThan(0)
  })
})

test.describe('ESCAPEARTIST Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('has playback controls', async ({ page }) => {
    await expect(page.getByTitle('Go to start (Home)')).toBeVisible()
    await expect(page.getByTitle('Play (Space)')).toBeVisible()
    await expect(page.getByTitle('Go to end (End)')).toBeVisible()
  })

  test('has pause button or combined play/pause', async ({ page }) => {
    // One combined transport button, titled by state — click it and watch
    // the title (its accessible name) flip.
    await seedTextClip(page)
    const playButton = page.getByTitle('Play (Space)')
    await expect(playButton).toBeVisible()

    await playButton.click()
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()
  })

  test('has export button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()
  })

  test('has save project option', async ({ page }) => {
    await page.getByRole('button', { name: 'File menu' }).click()
    await expect(page.getByText('Save Project')).toBeVisible()
  })
})

test.describe('ESCAPEARTIST Export Options', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('export dialog can be triggered', async ({ page }) => {
    // Export is disabled until the timeline holds a clip
    await seedTextClip(page)
    await openExportDialog(page)

    await expect(page.getByRole('button', { name: 'Download WebM' }).first()).toBeEnabled()
  })

  test('has format selection options', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    await expect(page.getByRole('radio', { name: /WebM/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /MP4/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /GIF/ })).toBeVisible()
  })
})
