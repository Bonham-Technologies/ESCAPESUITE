import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Frame, type Page } from '@playwright/test'
import { openExportDialog } from '../../utils/artist'
import { grantMediaPermissions } from '../../utils/media-mocks'

/**
 * The host embedding contract.
 *
 * ESCAPEARTIST and ESCAPECRAFT are designed to be dropped into someone else's
 * page in an iframe. That arrangement is a contract — the host expects `READY`
 * when the editor comes up, `EXPORT_COMPLETE` carrying the finished file, and
 * `SEND_TO_EDITOR` when a recording is handed over instead of a popup window;
 * the apps expect `?suppressRestore=1` and `?title=` to be honoured. Unit tests
 * cover each half in isolation with a stubbed `window.parent`; only a real
 * frame proves the two halves meet.
 *
 * Same-origin embedding: the dev servers put each app on its own port, so a
 * host page served from anywhere else would be cross-origin and could neither
 * share the app's IndexedDB (which is how sessions and recordings are seeded
 * here) nor be scripted through `page.evaluate`. The host page is therefore
 * served *from the app's own origin* by fulfilling one intercepted URL, and the
 * app is embedded from `/` beneath it.
 */

const ARTIST_ORIGIN = 'http://localhost:5175'
const CRAFT_ORIGIN = 'http://localhost:5174'
const FIXTURE_MP4 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/headless/source.mp4'
)

/** A message as captured by the host window (Blobs reduced to what survives evaluate). */
interface CapturedMessage {
  type: string
  format?: string
  name?: string
  id?: string
  blobSize?: number
  blobType?: string
}

const HOST_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>e2e host page</title>
    <style>
      html, body { margin: 0; height: 100%; background: #101014; }
      iframe { display: block; border: 0; width: 100vw; height: 100vh; }
    </style>
    <script>
      // Installed before any frame exists so no message can be missed.
      window.__hostMessages = [];
      window.addEventListener('message', function (event) {
        window.__hostMessages.push(event.data);
      });
    </script>
  </head>
  <body></body>
</html>`

/** Serve a bare host page from the app's own origin and navigate to it. */
async function openHostPage(page: Page, origin: string): Promise<void> {
  const url = `${origin}/__e2e-host`
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOST_HTML })
  )
  await page.goto(url)
  await expect(page).toHaveTitle('e2e host page')
}

/** Embed `src` (app-relative) in the host page and hand back the frame. */
async function embed(page: Page, src: string): Promise<Frame> {
  const before = page.frames().length
  await page.evaluate((frameSrc) => {
    const iframe = document.createElement('iframe')
    iframe.src = frameSrc
    document.body.appendChild(iframe)
  }, src)

  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBeGreaterThan(before)
  const frame = page.frames()[page.frames().length - 1]
  await frame.waitForLoadState('domcontentloaded')
  return frame
}

/** Drop every embedded frame from the host page. */
async function unembedAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.innerHTML = ''
  })
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBe(1)
}

/** Everything the host window has received so far. */
function hostMessages(page: Page): Promise<CapturedMessage[]> {
  return page.evaluate(() => {
    const raw = (window as unknown as { __hostMessages: unknown[] }).__hostMessages ?? []
    return raw
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map((m) => {
        const payload = (m.payload ?? {}) as Record<string, unknown>
        const blob = payload.blob
        return {
          type: String(m.type),
          format: typeof payload.format === 'string' ? payload.format : undefined,
          name: typeof payload.name === 'string' ? payload.name : undefined,
          id: typeof payload.id === 'string' ? payload.id : undefined,
          // A Blob cannot cross the evaluate boundary — measure it in the page.
          blobSize: blob instanceof Blob ? blob.size : undefined,
          blobType: blob instanceof Blob ? blob.type : undefined,
        }
      })
  })
}

/** Wait until the host window has received a message of `type`. */
async function waitForHostMessage(
  page: Page,
  type: string,
  timeout = 15_000
): Promise<CapturedMessage> {
  await page.waitForFunction(
    (wanted) => {
      const raw = (window as unknown as { __hostMessages: Array<{ type?: string }> })
        .__hostMessages ?? []
      return raw.some((m) => m && m.type === wanted)
    },
    type,
    { timeout }
  )
  const message = (await hostMessages(page)).find((m) => m.type === type)
  if (!message) throw new Error(`Message ${type} vanished between poll and read`)
  return message
}

/**
 * Write a session into ESCAPEARTIST's storage directly.
 *
 * The prompt only appears for a session that holds source videos, and the
 * schema mirrors `packages/shared/src/storage` (v1, four stores) so the host
 * page can create the database before the app has ever opened it.
 */
async function seedArtistSession(page: Page, projectName: string): Promise<void> {
  await page.evaluate(async (name) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('video-editor-db', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
      }
      request.onerror = () => reject(new Error('open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('settings', 'readwrite')
        tx.objectStore('settings').put(
          {
            project: {
              id: 'seeded-project',
              name,
              timeline: { clips: [], tracks: [], duration: 5 },
              modified: Date.now(),
            },
            sourceVideos: [
              {
                id: 'seeded-video',
                name: 'seeded.webm',
                duration: 5,
                width: 64,
                height: 48,
                frameRate: 30,
                mimeType: 'video/webm',
                size: 1024,
              },
            ],
            currentTime: 0,
            selectedClipId: null,
            zoom: 1,
            timestamp: Date.now(),
          },
          'current-session'
        )
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(new Error('write failed'))
      }
    })
  }, projectName)
}

/** Write a finished recording into ESCAPECRAFT's storage directly. */
async function seedCraftRecording(page: Page, name: string): Promise<string> {
  return page.evaluate(async (recordingName) => {
    const id = crypto.randomUUID()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('video-editor-db', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
      }
      request.onerror = () => reject(new Error('open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('videos', 'readwrite')
        tx.objectStore('videos').put({
          id,
          blob: new Blob([new Uint8Array(2048)], { type: 'video/webm' }),
          metadata: {
            id,
            name: recordingName,
            duration: 5,
            width: 64,
            height: 48,
            frameRate: 30,
            mimeType: 'video/webm',
            size: 2048,
            source: 'recording',
            recordedAt: Date.now(),
          },
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(new Error('write failed'))
      }
    })
    return id
  }, name)
}

test.describe('Host embedding contract', () => {
  // Exporting goes through WebCodecs, and the whole contract is only shipped
  // for Chromium-based hosts (see the WebCodecs constraint in the README).
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The embedding contract is exercised on Chromium only (WebCodecs)'
  )

  test('ESCAPEARTIST announces READY and honours suppressRestore and title', async ({
    page,
  }) => {
    test.setTimeout(90_000)

    await openHostPage(page, ARTIST_ORIGIN)
    await seedArtistSession(page, 'Seeded Session')

    await test.step('without suppressRestore the seeded session does prompt', async () => {
      // Proves the seed is real, so the assertion below is about the flag and
      // not about an empty database.
      const frame = await embed(page, '/')
      await expect(frame.getByRole('heading', { name: 'Resume Previous Session?' })).toBeVisible({
        timeout: 30_000,
      })
      await unembedAll(page)
    })

    const frame = await test.step('embedded with suppressRestore and a host title', async () => {
      const embedded = await embed(page, '/?suppressRestore=1&title=Host%20Title')
      await expect(embedded.getByRole('button', { name: 'Export video' })).toBeVisible({
        timeout: 30_000,
      })
      return embedded
    })

    await test.step('the host received READY', async () => {
      const ready = await waitForHostMessage(page, 'READY')
      expect(ready.type).toBe('READY')
    })

    await test.step('the restore prompt stays away', async () => {
      // The prompt is decided after an async storage read; give that read time
      // to have finished and lost before calling the absence a pass.
      await expect(
        frame.getByRole('heading', { name: 'Resume Previous Session?' })
      ).toHaveCount(0)
      await page.waitForTimeout(1000)
      await expect(
        frame.getByRole('heading', { name: 'Resume Previous Session?' })
      ).toHaveCount(0)
    })

    await test.step('the host title names the project', async () => {
      await expect(frame.getByRole('textbox', { name: 'Project name' })).toHaveValue('Host Title')
    })

    await test.step('the seeded session is left in storage, not cleared', async () => {
      const stored = await page.evaluate(async () => {
        return new Promise<string | null>((resolve) => {
          const request = indexedDB.open('video-editor-db')
          request.onerror = () => resolve(null)
          request.onsuccess = () => {
            const get = request.result
              .transaction('settings', 'readonly')
              .objectStore('settings')
              .get('current-session')
            get.onerror = () => resolve(null)
            get.onsuccess = () => {
              const session = get.result as { project?: { name?: string } } | undefined
              resolve(session?.project?.name ?? null)
            }
          }
        })
      })
      expect(stored).toBe('Seeded Session')
    })
  })

  test('ESCAPEARTIST hands the finished export to the host', async ({ page }) => {
    // A real encode pass, even of a 1-second 64x48 clip, outruns the default.
    test.setTimeout(120_000)

    await openHostPage(page, ARTIST_ORIGIN)
    const frame = await embed(page, '/?suppressRestore=1')

    await test.step('put the fixture clip on the timeline', async () => {
      await expect(frame.getByRole('button', { name: 'Export video' })).toBeVisible({
        timeout: 30_000,
      })
      await frame.locator('input[type="file"]').setInputFiles(FIXTURE_MP4)

      const addToTimeline = frame.getByRole('button', { name: 'Add to timeline' })
      await expect(addToTimeline).toBeVisible({ timeout: 60_000 })
      await addToTimeline.click()
      await expect(frame.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('export WebM from inside the frame', async () => {
      await openExportDialog(frame)
      await frame.getByRole('button', { name: /download webm/i }).click()
    })

    await test.step('the host received EXPORT_COMPLETE with a real file', async () => {
      const complete = await waitForHostMessage(page, 'EXPORT_COMPLETE', 60_000)
      expect(complete.format).toBe('webm')
      expect(complete.name).toMatch(/\.webm$/)
      // A real encoded file, not an empty placeholder (the fixture exports ~3 KB).
      expect(complete.blobSize).toBeGreaterThan(1000)
      expect(complete.blobType).toContain('webm')
    })
  })

  test('ESCAPECRAFT posts SEND_TO_EDITOR instead of opening a window', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000)

    await grantMediaPermissions(page)
    await openHostPage(page, CRAFT_ORIGIN)
    const recordingId = await seedCraftRecording(page, 'Seeded Recording')

    const frame = await embed(page, '/')
    const sendToEditor = frame.getByRole('button', { name: 'Open Seeded Recording in Editor' })
    await expect(sendToEditor).toBeVisible({ timeout: 30_000 })

    const pagesBefore = context.pages().length
    await sendToEditor.click()

    const message = await waitForHostMessage(page, 'SEND_TO_EDITOR')
    expect(message.id).toBe(recordingId)

    // A popup would mean the host lost control of navigation.
    await page.waitForTimeout(500)
    expect(context.pages().length).toBe(pagesBefore)
  })
})
