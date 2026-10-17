import { test, expect, type Frame, type Page } from '@playwright/test'
import {
  ARTIST_URL,
  importMediaAndAddToTimeline,
  makeToneWav,
} from '../../utils/artist'

/**
 * ESCSUITE-311 / O-U3 PROBE — not a regression test, a measurement.
 *
 * Two ESCAPEARTIST iframes in ONE host page, neither with `?suppressRestore=1`,
 * share one `sessionStorage` (same origin, same top-level browsing context).
 * `tabId.ts` keeps the tab id there, so both frames read the same
 * `escapeartist-tab-id`; the second frame's own-id probe (`useSessionRestore`)
 * finds the first frame's `escapeartist-tab:<id>` lock held, calls
 * `renewTabId()` and overwrites the shared key. After a host reload each frame
 * reads whatever the key holds. This probe LOGS what really happens; it asserts
 * only that its setup happened.
 *
 * Opt-in: `ESCSUITE_311_PROBE=1 pnpm --filter=@escapesuite/e2e exec playwright test tests/integration/two-iframes.probe.spec.ts --project=chromium`
 */

test.skip(!process.env.ESCSUITE_311_PROBE, 'ESCSUITE-311 probe: set ESCSUITE_311_PROBE=1 to run')

const TAB_ID_KEY = 'escapeartist-tab-id'
const AUTO_SAVE_DELAY = 2000
const PROMPT = 'Resume Previous Session?'

const bodyHtml = (frames: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>e2e two-iframe host page</title>
    <style>
      html, body { margin: 0; height: 100%; background: #101014; }
      iframe { display: inline-block; border: 0; width: 50vw; height: 100vh; }
    </style>
  </head>
  <body>${frames}</body>
</html>`

/** What the host page serves next; swapped between the first load and the reload. */
let currentHtml = bodyHtml('')

async function openHostPage(page: Page): Promise<void> {
  const url = `${ARTIST_URL}/__e2e-host`
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: currentHtml })
  )
  await page.goto(url)
  await expect(page).toHaveTitle('e2e two-iframe host page')
}

async function embed(page: Page, id: string): Promise<Frame> {
  const before = page.frames().length
  await page.evaluate((frameId) => {
    const iframe = document.createElement('iframe')
    iframe.id = frameId
    iframe.src = '/'
    document.body.appendChild(iframe)
  }, id)
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBeGreaterThan(before)
  const frame = page.frames()[page.frames().length - 1]
  await frame.waitForLoadState('domcontentloaded')
  await frame.locator('main').first().waitFor({ state: 'attached' })
  return frame
}

interface SlotSummary {
  key: string
  sources: string[]
  clips: number
  timestamp: number
}

/** Every saved session row, read from the host page (same origin as the frames). */
function readSlots(page: Page): Promise<SlotSummary[]> {
  return page.evaluate(
    () =>
      new Promise<SlotSummary[]>((resolve) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => resolve([])
        request.onsuccess = () => {
          try {
            const store = request.result.transaction('settings', 'readonly').objectStore('settings')
            const keysReq = store.getAllKeys()
            const valuesReq = store.getAll()
            const tx = store.transaction
            tx.oncomplete = () => {
              const out: SlotSummary[] = []
              ;(keysReq.result as IDBValidKey[]).forEach((key, i) => {
                const k = String(key)
                if (!k.startsWith('session:') && k !== 'current-session') return
                const v = valuesReq.result[i] as {
                  sourceVideos?: Array<{ name?: string }>
                  project?: { timeline?: { clips?: unknown[] } }
                  timestamp?: number
                }
                out.push({
                  key: k,
                  sources: (v.sourceVideos ?? []).map((s) => String(s.name)),
                  clips: v.project?.timeline?.clips?.length ?? -1,
                  timestamp: v.timestamp ?? 0,
                })
              })
              resolve(out)
            }
            tx.onerror = () => resolve([])
          } catch {
            resolve([])
          }
        }
      })
  )
}

const tabIdOf = (frame: Frame) =>
  frame.evaluate((key) => {
    try {
      return sessionStorage.getItem(key)
    } catch {
      return 'unreadable'
    }
  }, TAB_ID_KEY)

const hostTabId = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), TAB_ID_KEY)

test('ESCSUITE-311 O-U3: two ARTIST iframes in one host page, then a host reload', async ({ page }) => {
  test.setTimeout(120_000)

  await openHostPage(page)

  // Frame A first, so its tab lock is held before B asks about the shared id.
  const frameA = await embed(page, 'a')
  const idAfterALoad = await tabIdOf(frameA)
  console.log(`ESCSUITE-311 O-U3: after A loaded, shared sessionStorage id = ${idAfterALoad}`)
  await expect(frameA.getByRole('dialog', { name: PROMPT })).toHaveCount(0)
  // Let A's startup check settle and its autosave take the lock before B appears.
  await page.waitForTimeout(1500)

  const frameB = await embed(page, 'b')
  await page.waitForTimeout(1500)
  const idAfterBLoad = await tabIdOf(frameB)
  console.log(
    `ESCSUITE-311 O-U3: after B loaded, shared sessionStorage id = ${idAfterBLoad} ` +
      `(${idAfterBLoad === idAfterALoad ? 'UNCHANGED: B kept the id' : 'CHANGED: B renewed and overwrote the shared key'})`
  )
  await expect(frameA.getByRole('dialog', { name: PROMPT })).toHaveCount(0)
  await expect(frameB.getByRole('dialog', { name: PROMPT })).toHaveCount(0)

  // A different edit in each: A = one mp4 clip; B = a wav clip plus two text clips.
  // (A saved session is only offered when it holds a source, hence the imports.
  // The clip counts, 1 vs 3, are what tells the two projects apart in the prompt.)
  await importMediaAndAddToTimeline(frameA)
  await importMediaAndAddToTimeline(frameB, {
    name: 'probe-tone.wav',
    mimeType: 'audio/wav',
    buffer: makeToneWav(1),
  })
  await frameB.getByRole('button', { name: 'Add Text' }).click()
  await frameB.getByRole('button', { name: 'Add Text' }).click()
  await expect(frameB.getByText(/^3 clips/).first()).toBeVisible({ timeout: 15_000 })
  await expect(frameA.getByText(/^1 clip/).first()).toBeVisible()

  // Past the autosave debounce; then wait until both frames' slots exist.
  await page.waitForTimeout(AUTO_SAVE_DELAY + 1500)
  await expect
    .poll(async () => (await readSlots(page)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1)
  const slotsBefore = await readSlots(page)
  console.log(`ESCSUITE-311 O-U3: slots before host reload = ${JSON.stringify(slotsBefore)}`)
  console.log(
    `ESCSUITE-311 O-U3: shared id before reload = ${await hostTabId(page)} ` +
      `(A frame reads ${await tabIdOf(frameA)}, B frame reads ${await tabIdOf(frameB)})`
  )

  // Reload the host with both frames present from the start (static markup),
  // the way a real host page would load.
  currentHtml = bodyHtml('<iframe id="a" src="/"></iframe><iframe id="b" src="/"></iframe>')
  await page.reload()
  await expect(page).toHaveTitle('e2e two-iframe host page')
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBe(3)
  const frames = page.frames().slice(1)
  for (const frame of frames) await frame.locator('main').first().waitFor({ state: 'attached' })
  await page.waitForTimeout(4000)

  for (const [i, frame] of frames.entries()) {
    const label = i === 0 ? 'iframe#a (first in document)' : 'iframe#b (second in document)'
    const prompt = frame.getByRole('dialog', { name: PROMPT })
    const offered = (await prompt.count()) > 0
    const text = offered ? ((await prompt.innerText()).replace(/\s+/g, ' ').trim()) : ''
    console.log(
      `ESCSUITE-311 O-U3: after reload ${label}: sessionStorage id = ${await tabIdOf(frame)}; ` +
        `restore prompt offered = ${offered}${offered ? `; prompt = "${text}"` : ''}`
    )
  }
  console.log(
    `ESCSUITE-311 O-U3: expected if ids were per-frame: #a offered the 1-clip (mp4) project, #b the 3-clip (wav + text) one`
  )
  console.log(`ESCSUITE-311 O-U3: slots after reload (nothing answered) = ${JSON.stringify(await readSlots(page))}`)
  console.log(`ESCSUITE-311 O-U3: shared id after reload = ${await hostTabId(page)}`)
})
