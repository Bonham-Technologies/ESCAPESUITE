import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, openMobileInspector, seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { reopenProject } from '../../utils/timeline'
import { readWebmLayout } from '../../utils/webmLayout'

/**
 * ESCSUITE-470: ESCAPEARTIST exports and saves straight to a file the user
 * picks, where the browser has `showSaveFilePicker` (Chromium). An export used
 * to be joined into one Blob of the whole output and handed to an `<a
 * download>`, so a long export sat whole in the page's blob store first; and
 * every Save made another copy in Downloads.
 *
 * Headless Chromium has no dialog to show, so its picker rejects at once, and
 * the e2e configs launch it without one (`utils/filePickers.ts`). These cases
 * put a stand-in back: `showSaveFilePicker` and `showOpenFilePicker` answer a
 * handle in the origin-private file system, which has the same
 * `createWritable()` a picked file has, and the file is read back from there.
 *
 * The picker cases are Chromium's: it is the browser that has the API. The
 * last case runs in every browser and holds the download path, which is what
 * Firefox and Safari (and Chromium without the API) still take.
 */

/** Window fields the stand-in pickers and the Blob counter share with the test. */
interface PickerWindow {
  showSaveFilePicker: (options: { suggestedName?: string }) => Promise<FileSystemFileHandle>
  showOpenFilePicker: () => Promise<FileSystemFileHandle[]>
  __picks: number
  __pickerCancels: boolean
  __writes: number
  __writeDelayMs: number
  __failWrite: number
  __countBlobs: boolean
  __largestBlob: number
}

/**
 * Stand-in pickers over the origin-private file system. The save picker makes
 * (or reopens) the suggested file, as Chromium's makes the chosen one; the
 * open picker hands back `name`. Every writable the page opens counts its
 * writes, can be slowed (`__writeDelayMs`), and can refuse its Nth write as a
 * full disk does (`__failWrite`). And every Blob the page constructs while
 * `__countBlobs` is set is measured.
 */
async function installPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as PickerWindow
    w.__picks = 0
    w.__pickerCancels = false
    w.__writes = 0
    w.__writeDelayMs = 0
    w.__failWrite = 0
    w.__countBlobs = false
    w.__largestBlob = 0

    const instrument = (handle: FileSystemFileHandle): FileSystemFileHandle => {
      const createWritable = handle.createWritable.bind(handle)
      handle.createWritable = async (options?: FileSystemCreateWritableOptions) => {
        const stream = await createWritable(options)
        const write = stream.write.bind(stream)
        stream.write = async (data: FileSystemWriteChunkType) => {
          w.__writes += 1
          if (w.__writes === w.__failWrite) throw new DOMException('The disk is full.', 'QuotaExceededError')
          if (w.__writeDelayMs) await new Promise((resolve) => setTimeout(resolve, w.__writeDelayMs))
          return write(data)
        }
        return stream
      }
      return handle
    }
    w.showSaveFilePicker = async ({ suggestedName }) => {
      w.__picks += 1
      if (w.__pickerCancels) throw new DOMException('The user aborted a request.', 'AbortError')
      const dir = await navigator.storage.getDirectory()
      return instrument(await dir.getFileHandle(suggestedName ?? 'untitled', { create: true }))
    }
    w.showOpenFilePicker = async () => {
      const dir = await navigator.storage.getDirectory()
      return [instrument(await dir.getFileHandle('Untitled Project.veditor'))]
    }

    const NativeBlob = Blob
    class CountingBlob extends NativeBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options)
        if (w.__countBlobs) w.__largestBlob = Math.max(w.__largestBlob, this.size)
      }
    }
    // Every Blob is still a Blob, whoever built it.
    Object.defineProperty(CountingBlob, Symbol.hasInstance, { value: (x: unknown) => x instanceof NativeBlob })
    window.Blob = CountingBlob
  })
}

/** The bytes of a file in the origin-private file system, or null when there is none. */
async function readPrivateFile(page: Page, name: string): Promise<Buffer | null> {
  const base64 = await page.evaluate(async (fileName) => {
    const dir = await navigator.storage.getDirectory()
    let file: File
    try {
      file = await (await dir.getFileHandle(fileName)).getFile()
    } catch {
      return null
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  }, name)
  return base64 === null ? null : Buffer.from(base64, 'base64')
}

/** Duration and picture size of a private file as a `<video>` decodes it. */
async function decodePrivateFile(page: Page, name: string): Promise<{ duration: number; width: number }> {
  return page.evaluate(async (fileName) => {
    const dir = await navigator.storage.getDirectory()
    const file = await (await dir.getFileHandle(fileName)).getFile()
    const video = document.createElement('video')
    video.muted = true
    video.src = URL.createObjectURL(file)
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = () => reject(new Error(`the export does not decode: ${video.error?.message}`))
    })
    return { duration: video.duration, width: video.videoWidth }
  }, name)
}

async function openArtistWithTextClip(page: Page): Promise<void> {
  await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
  await waitForAppReady(page, 'artist')
  await seedTextClip(page)
}

const EXPORT_NAME = 'Untitled Project.webm'

test.describe('ESCSUITE-470: export and save to a file the user picks', () => {
  test.describe('where the browser can pick a file', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', "showSaveFilePicker is Chromium's alone")

    test('an export streams into the chosen file and never builds the output as a Blob', async ({ page }) => {
      test.setTimeout(120_000)
      await installPickers(page)
      await openArtistWithTextClip(page)
      let downloads = 0
      page.on('download', () => (downloads += 1))

      await page.getByRole('button', { name: 'Export video' }).click()
      await page.evaluate(() => ((window as unknown as PickerWindow).__countBlobs = true))
      await page.getByRole('button', { name: /download webm/i }).first().click()
      await expect(page.getByRole('status').filter({ hasText: 'Export complete!' })).toContainText(`Export complete! Saved to ${EXPORT_NAME}.`, {
        timeout: 90_000,
      })

      const bytes = await readPrivateFile(page, EXPORT_NAME)
      expect(bytes, 'nothing was written to the chosen file').not.toBeNull()
      // Media health: a WebM whose video frames each carry their own, rising
      // timecode, and which a <video> decodes for the text clip's five seconds.
      const layout = readWebmLayout(bytes!)
      expect(layout.videoBlocks.length).toBeGreaterThanOrEqual(140)
      for (let i = 1; i < layout.videoBlocks.length; i++) {
        expect(layout.videoBlocks[i].time).toBeGreaterThan(layout.videoBlocks[i - 1].time)
      }
      const decoded = await decodePrivateFile(page, EXPORT_NAME)
      expect(decoded.width).toBeGreaterThan(0)
      expect(decoded.duration).toBeCloseTo(5, 0)

      // The output never sat whole in a Blob: the download path joins it into
      // one exactly its size.
      const largestBlob = await page.evaluate(() => (window as unknown as PickerWindow).__largestBlob)
      test.info().annotations.push({
        type: 'measured',
        description: `output ${bytes!.length} bytes; largest Blob built during the export ${largestBlob} bytes`,
      })
      expect(largestBlob).toBeLessThan(bytes!.length / 4)
      expect(downloads, 'the export also downloaded').toBe(0)
    })

    test('a cancelled picker starts no export', async ({ page }) => {
      await installPickers(page)
      await openArtistWithTextClip(page)
      await page.evaluate(() => ((window as unknown as PickerWindow).__pickerCancels = true))

      await page.getByRole('button', { name: 'Export video' }).click()
      await page.getByRole('button', { name: /download webm/i }).first().click()

      await expect.poll(() => page.evaluate(() => (window as unknown as PickerWindow).__picks)).toBe(1)
      // The dialog is as it was: no progress, no error, the buttons still there.
      await expect(page.getByRole('progressbar')).toHaveCount(0)
      await expect(page.getByRole('alert').filter({ hasText: 'Export failed' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /download webm/i }).first()).toBeEnabled()
      expect(await page.evaluate(() => (window as unknown as PickerWindow).__writes)).toBe(0)
    })

    test('cancelling mid-export leaves no file behind', async ({ page }) => {
      test.setTimeout(120_000)
      await installPickers(page)
      await openArtistWithTextClip(page)
      // Slow every write, so the export is still running when Cancel lands.
      await page.evaluate(() => ((window as unknown as PickerWindow).__writeDelayMs = 300))

      await page.getByRole('button', { name: 'Export video' }).click()
      await page.getByRole('button', { name: /download webm/i }).first().click()
      await expect.poll(() => page.evaluate(() => (window as unknown as PickerWindow).__writes)).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()

      await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()
      // The file the picker made for this export is gone, not left half written.
      await expect.poll(() => readPrivateFile(page, EXPORT_NAME), { timeout: 15_000 }).toBeNull()
    })

    test('a full disk stops the export and says so', async ({ page }) => {
      test.setTimeout(120_000)
      await installPickers(page)
      await openArtistWithTextClip(page)
      await page.evaluate(() => ((window as unknown as PickerWindow).__failWrite = 2))

      await page.getByRole('button', { name: 'Export video' }).click()
      await page.getByRole('button', { name: /download webm/i }).first().click()

      await expect(page.getByRole('alert').filter({ hasText: 'Export failed' })).toContainText(
        `Could not write "${EXPORT_NAME}": the disk is full.`,
        { timeout: 60_000 }
      )
      // Stopped: the buttons are back, nothing more is written, and the file
      // the picker made is gone.
      await expect(page.getByRole('button', { name: /download webm/i }).first()).toBeEnabled()
      const writes = await page.evaluate(() => (window as unknown as PickerWindow).__writes)
      await page.waitForTimeout(1000)
      expect(await page.evaluate(() => (window as unknown as PickerWindow).__writes)).toBe(writes)
      expect(await readPrivateFile(page, EXPORT_NAME)).toBeNull()
    })

    test('Save after Open writes over the same file, and it reopens', async ({ page, browser }) => {
      test.setTimeout(120_000)
      await installPickers(page)
      await openArtistWithTextClip(page)

      // The first save asks where to go.
      await page.getByRole('button', { name: 'Save project' }).click()
      await expect(page.getByText('Project saved successfully')).toBeVisible({ timeout: 30_000 })
      expect(await page.evaluate(() => (window as unknown as PickerWindow).__picks)).toBe(1)
      const first = await readPrivateFile(page, 'Untitled Project.veditor')
      expect(first?.length).toBeGreaterThan(0)

      // Open it through the open picker, add a second clip, save again.
      await page.getByRole('button', { name: 'File menu' }).click()
      await page.getByRole('menuitem', { name: /Open Project/ }).click()
      await page.getByRole('button', { name: 'Discard & Load' }).click()
      await expect(page.getByText('Project loaded successfully')).toBeVisible({ timeout: 30_000 })
      await openMobileInspector(page)
      await page.getByRole('button', { name: 'Add Text' }).click()
      await expect(page.getByText(/^2 clips · /)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Project saved successfully')).toBeHidden({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Save project' }).click()
      await expect(page.getByText('Project saved successfully')).toBeVisible({ timeout: 30_000 })

      // No second picker: the save went over the file it was opened from.
      expect(await page.evaluate(() => (window as unknown as PickerWindow).__picks)).toBe(1)
      const second = await readPrivateFile(page, 'Untitled Project.veditor')
      expect(second!.equals(first!)).toBe(false)

      // And those bytes open, with both clips.
      const { page: reopened, context } = await reopenProject(browser, second!)
      try {
        await expect(reopened.getByText(/^2 clips · /)).toBeVisible()
      } finally {
        await context.close()
      }
    })
  })

  test('without the picker, an export still downloads', async ({ page }) => {
    test.setTimeout(120_000)
    await openArtistWithTextClip(page)
    expect(await page.evaluate(() => 'showSaveFilePicker' in window)).toBe(false)
    // No Save As either: Save downloads, as it always has.
    await page.getByRole('button', { name: 'File menu' }).click()
    await expect(page.getByRole('menuitem', { name: /^Save Project/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Save Project As/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Export video' }).click()
    const downloadWebM = page.getByRole('button', { name: /download webm/i }).first()
    test.skip(!(await downloadWebM.isEnabled()), 'This browser cannot encode WebM here')
    const download = page.waitForEvent('download', { timeout: 90_000 })
    await downloadWebM.click()
    // WebKit's download names a space as an underscore.
    expect((await download).suggestedFilename()).toMatch(/^Untitled[ _]Project\.webm$/)
  })
})
