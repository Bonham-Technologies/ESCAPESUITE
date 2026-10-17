import { test, expect, type Frame, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'

/**
 * Two ESCAPEARTIST frames in one host page keep a session each (ESCSUITE-332).
 *
 * Two same-origin frames in one top-level tab share its `sessionStorage`.
 * Before ESCSUITE-332 the tab id lived there, so the second frame renewed the
 * first's id and wrote over the shared key, and after a host reload the frames
 * swapped sessions — ESCSUITE-311's two-iframes probe measured it. A host now
 * names each frame with `?tabKey=`; an embedded editor derives its id from it
 * (`host:<tabKey>`) and never touches the shared key. This spec is that probe's
 * reload half turned into an assertion.
 *
 * Served the way `host-embedding.spec.ts` serves its host: from the editor's own
 * origin, by fulfilling one intercepted URL, so the frames are same-origin with
 * the host page and share its `sessionStorage` — the arrangement the defect needs.
 */

// ESCAPEARTIST's autosave debounce (AUTO_SAVE_DELAY in apps/artist/src/app/appConstants.ts).
const AUTO_SAVE_DELAY = 2000
const PROMPT = 'Resume Previous Session?'
const HOST_TITLE = 'e2e two-iframe host page'

/** The editor URL for one named frame: restore on, host named, frame named. */
const frameSrc = (tabKey: string) =>
  `/?hostOrigin=${encodeURIComponent(ARTIST_URL)}&tabKey=${encodeURIComponent(tabKey)}`

const hostHtml = (frames: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${HOST_TITLE}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #101014; }
      iframe { display: block; border: 0; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>${frames}</body>
</html>`

/** What the host page serves next; swapped between the first load and the reload. */
let currentHtml = hostHtml('')

async function openHostPage(page: Page): Promise<void> {
  const url = `${ARTIST_URL}/__e2e-host`
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: currentHtml })
  )
  await page.goto(url)
  await expect(page).toHaveTitle(HOST_TITLE)
}

/** Add one frame to the live host page and wait for its editor to mount. */
async function embed(page: Page, id: string, src: string): Promise<Frame> {
  const before = page.frames().length
  await page.evaluate(
    ({ frameId, frameSrcUrl }) => {
      const iframe = document.createElement('iframe')
      iframe.id = frameId
      iframe.src = frameSrcUrl
      document.body.appendChild(iframe)
    },
    { frameId: id, frameSrcUrl: src }
  )
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBeGreaterThan(before)
  const frame = page.frames()[page.frames().length - 1]
  await frame.waitForLoadState('domcontentloaded')
  await frame.locator('main').first().waitFor({ state: 'attached' })
  return frame
}

/** The session row keys in the shared database, read from the host page (same origin). */
function sessionKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => resolve([])
        request.onsuccess = () => {
          try {
            const keys = request.result
              .transaction('settings', 'readonly')
              .objectStore('settings')
              .getAllKeys()
            keys.onsuccess = () =>
              resolve((keys.result as IDBValidKey[]).map(String).filter((k) => k.startsWith('session:')))
            keys.onerror = () => resolve([])
          } catch {
            resolve([])
          }
        }
      })
  )
}

test.describe('two editors framed in one host page (ESCSUITE-332)', () => {
  test('each frame named with ?tabKey= is offered its own session after a host reload', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'ESCSUITE-332: measured on Chromium, as the ESCSUITE-311 probe was')
    test.setTimeout(120_000)

    await openHostPage(page)

    // Frame A first, so its tab lock is held before B starts — the order in
    // which, before the fix, B renewed and wrote over the shared id.
    const frameA = await embed(page, 'a', frameSrc('a'))
    await expect(frameA.getByRole('dialog', { name: PROMPT })).toHaveCount(0)
    await page.waitForTimeout(1500)
    const frameB = await embed(page, 'b', frameSrc('b'))
    await page.waitForTimeout(1500)
    await expect(frameB.getByRole('dialog', { name: PROMPT })).toHaveCount(0)

    // A different edit in each: A = one mp4 clip; B = a wav clip plus two text
    // clips. A saved session is only offered when it holds a source, hence the
    // imports; the clip counts, 1 against 3, tell the two prompts apart.
    await importMediaAndAddToTimeline(frameA)
    await importMediaAndAddToTimeline(frameB, {
      name: 'two-iframes-tone.wav',
      mimeType: 'audio/wav',
      buffer: makeToneWav(1),
    })
    // The imported clip is selected, and "Add Text" lives in the inspector's
    // empty state — deselect (Escape) before each add so the button is there.
    for (let i = 0; i < 2; i++) {
      await frameB.locator('body').press('Escape')
      await frameB.getByRole('button', { name: 'Add Text' }).click()
    }
    await expect(frameB.getByText(/^3 clips/).first()).toBeVisible({ timeout: 15_000 })
    await expect(frameA.getByText(/^1 clip/).first()).toBeVisible()

    // Past the autosave debounce: one slot per named frame, under its own name.
    await page.waitForTimeout(AUTO_SAVE_DELAY + 1500)
    await expect
      .poll(async () => (await sessionKeys(page)).sort(), { timeout: 15_000 })
      .toEqual(['session:host:a', 'session:host:b'])
    // Neither frame wrote the id key the two of them would have shared.
    expect(await page.evaluate(() => sessionStorage.getItem('escapeartist-tab-id'))).toBeNull()

    // Reload the host with both frames in its markup from the start, the way a
    // real host page loads — their startup checks now race.
    currentHtml = hostHtml(
      `<iframe id="a" src="${frameSrc('a')}"></iframe><iframe id="b" src="${frameSrc('b')}"></iframe>`
    )
    await page.reload()
    await expect(page).toHaveTitle(HOST_TITLE)

    const promptA = page.frameLocator('iframe#a').getByRole('dialog', { name: PROMPT })
    const promptB = page.frameLocator('iframe#b').getByRole('dialog', { name: PROMPT })
    await expect(promptA).toBeVisible({ timeout: 20_000 })
    await expect(promptB).toBeVisible({ timeout: 20_000 })
    await expect(promptA).toContainText('1 clip(s) on timeline')
    await expect(promptB).toContainText('3 clip(s) on timeline')
  })
})
