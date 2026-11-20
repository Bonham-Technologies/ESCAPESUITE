import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './cspGuard'
import { importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-467: the offline ESCAPEARTIST file does its real work under its own
 * Content-Security-Policy.
 *
 * The rest of this suite mostly opens the editor and exports a text clip. This
 * imports a real video, edits the project (a text overlay on top), and
 * exports it as WebM, MP4 and GIF, with the MP4's frames decoded by the
 * inlined decode worker, which runs from a blob: URL the policy has to admit.
 * The `cspGuard` fixture fails the test if the policy refused anything along
 * the way. Run both served over http and from `file://`, where the worker's
 * URL is `blob:null/…`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIST_FILE = pathToFileURL(path.resolve(HERE, '../../../artist/dist/index.html')).href

// Same shape as tests/export/decode-worker.spec.ts declares on Window.
declare global {
  interface Window {
    __decodeWorker: { framesReady: number; workersStarted: number }
  }
}

/** Count decode-worker starts and the FRAME_READY replies they post back. */
async function countDecodeWorker(page: Page) {
  await page.addInitScript(() => {
    window.__decodeWorker = { framesReady: 0, workersStarted: 0 }
    const RealWorker = window.Worker
    class CountingWorker extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        window.__decodeWorker.workersStarted++
        this.addEventListener('message', (event: MessageEvent) => {
          if ((event.data as { type?: string } | null)?.type === 'FRAME_READY') window.__decodeWorker.framesReady++
        })
      }
    }
    window.Worker = CountingWorker
  })
}

async function exportAs(page: Page, format: 'WebM' | 'MP4' | 'GIF'): Promise<string> {
  await openExportDialog(page)
  await openExportAdvancedOptions(page)
  const radio = page.getByRole('radio', { name: new RegExp(format) })
  if (!(await radio.isEnabled())) return 'unsupported'
  await radio.check()
  const download = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: `Download ${format}` }).first().click()
  const name = (await download).suggestedFilename()
  await expect(page.getByText('Export complete!').first()).toBeVisible({ timeout: 30_000 })
  // Back to the editor for the next format.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()
  return name
}

for (const [how, url] of [
  ['served over http', 'http://localhost:5185/?suppressRestore=1'],
  ['opened from file://', `${ARTIST_FILE}?suppressRestore=1`],
] as const) {
  test(`ESCAPEARTIST Standalone ${how} - edits a real video and exports WebM, MP4 and GIF under its offline policy`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit cannot store an imported Blob in IndexedDB under Playwright (ESCSUITE-258)')
    test.setTimeout(240_000)

    await countDecodeWorker(page)
    await page.goto(url)
    await waitForAppReady(page, 'artist')

    // Edit: a real, decodable video on the timeline, then a text overlay over it.
    await importMediaAndAddToTimeline(page)
    await page.getByRole('button', { name: 'Add Text' }).click()
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    expect(await exportAs(page, 'WebM')).toMatch(/\.webm$/)
    expect(await exportAs(page, 'GIF')).toMatch(/\.gif$/)

    const mp4 = await exportAs(page, 'MP4')
    test.skip(mp4 === 'unsupported', 'This browser has no H.264 encoder; MP4 export is disabled with its reason')
    expect(mp4).toMatch(/\.mp4$/)

    // The MP4's source frames came from the inlined decode worker, not the
    // in-page <video> fallback a refused worker would leave.
    if (browserName === 'chromium' || browserName === 'firefox') {
      const counts = await page.evaluate(() => window.__decodeWorker)
      expect(counts.workersStarted).toBeGreaterThan(0)
      expect(counts.framesReady).toBeGreaterThan(0)
    }
  })
}
