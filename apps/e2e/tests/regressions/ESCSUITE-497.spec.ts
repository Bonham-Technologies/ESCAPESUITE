import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-497: Save to a picked file with a clip whose media is no longer
 * stored in this browser.
 *
 * ESCSUITE-470 made Save refuse, naming the source, rather than write a project
 * file without it. But the refusal came after the save picker, which had
 * already made an empty file at the chosen path, and it applied to the first
 * Save too, where no existing copy was at risk: such a project could not be
 * saved at all in Chromium. Now the first Save (and Save As) writes a new file
 * without that media, as the download always did, and says so; a Save over the
 * project's existing file still refuses, before it asks for anything, and
 * leaves the file as it was.
 *
 * The stand-in picker is ESCSUITE-470's: headless Chromium has no dialog, so
 * `showSaveFilePicker` answers a handle in the origin-private file system,
 * made (or emptied) as Chromium's picker makes the chosen file.
 */

const PROJECT_FILE = 'Untitled Project.veditor'
/** The v2 `.veditor` magic (`core/projectFileFormat.ts`). */
const MAGIC = [0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a]

interface PickerWindow {
  showSaveFilePicker: (options: { suggestedName?: string }) => Promise<FileSystemFileHandle>
  __picks: number
}

async function installSavePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as PickerWindow
    w.__picks = 0
    w.showSaveFilePicker = async ({ suggestedName }) => {
      w.__picks += 1
      const dir = await navigator.storage.getDirectory()
      const handle = await dir.getFileHandle(suggestedName ?? 'untitled', { create: true })
      // Chromium's picker empties a file it is pointed at.
      const stream = await handle.createWritable()
      await stream.close()
      return handle
    }
  })
}

/** The bytes of a file in the origin-private file system, or null when there is none. */
async function readPrivateFile(page: Page, name: string): Promise<number[] | null> {
  return page.evaluate(async (fileName) => {
    const dir = await navigator.storage.getDirectory()
    try {
      const file = await (await dir.getFileHandle(fileName)).getFile()
      return [...new Uint8Array(await file.arrayBuffer())]
    } catch {
      return null
    }
  }, name)
}

/** Delete every stored source's bytes, as Clear All in another tab or a take deleted in CRAFT does. */
async function forgetStoredMedia(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('videos', 'readwrite')
          tx.objectStore('videos').clear()
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(new Error('clear failed'))
        }
      })
  )
}

const picks = (page: Page) => page.evaluate(() => (window as unknown as PickerWindow).__picks)

test.describe('ESCSUITE-497: saving a project whose media is no longer stored', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', "showSaveFilePicker is Chromium's alone")

  test('the first Save writes a new file without that media and says so; a Save over it refuses and leaves it alone', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await installSavePicker(page)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'tone.wav', mimeType: 'audio/wav', buffer: makeToneWav(1) })
    await forgetStoredMedia(page)

    // The first Save asks where to go, and saves there without the media.
    await page.getByRole('button', { name: 'Save project' }).click()
    await expect(
      page.getByText('Project saved without the media for "tone.wav", which is no longer stored in this browser.')
    ).toBeVisible({ timeout: 30_000 })
    expect(await picks(page)).toBe(1)
    const saved = await readPrivateFile(page, PROJECT_FILE)
    expect(saved, 'the picked file was not written').not.toBeNull()
    expect(saved!.slice(0, MAGIC.length), 'the picked file is not a project file').toEqual(MAGIC)

    // The next Save goes over that file: it refuses before it asks for
    // anything, and the file keeps what it held.
    await page.getByRole('button', { name: 'Save project' }).click()
    await expect(page.getByText(/Not saved: the media for "tone\.wav" is no longer stored in this browser/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/The file was left as it was\./)).toBeVisible()
    expect(await picks(page)).toBe(1)
    expect(await readPrivateFile(page, PROJECT_FILE)).toEqual(saved)
  })
})
