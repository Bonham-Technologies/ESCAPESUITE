import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_FIXTURE_MP4, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-311 / O-U2 PROBE — not a regression test, a measurement.
 *
 * `?loadVideo=<id>` in two tabs puts the same ESCAPECRAFT take into two live
 * projects. Clear All in tab A deletes the take's bytes; tab B's live project
 * and its saved session slot still name the id. This probe LOGS what tab B then
 * does on export and on a reload-and-restore; it asserts only that its setup
 * happened.
 *
 * Deviation from the brief, on purpose: the two tabs are opened WITHOUT
 * `?suppressRestore=1`. With it, `useSessionRestore` never settles into a
 * prompt and the autosave stays off, so tab B would write no slot at all and
 * the "saved slot still names the id" half could not exist. The shared
 * database starts empty of sessions, so no prompt appears on either first load
 * (asserted as a tripwire).
 *
 * Opt-in: `ESCSUITE_311_PROBE=1`, against the combined build:
 *   pnpm build:deploy && ESCSUITE_311_PROBE=1 pnpm --filter=@escapesuite/e2e exec playwright test -c playwright.production.config.ts shared-source-two-tabs.probe
 */

test.skip(!process.env.ESCSUITE_311_PROBE, 'ESCSUITE-311 probe: set ESCSUITE_311_PROBE=1 to run')

const DB_NAME = 'video-editor-db'
const DB_VERSION = 1
const CRAFT_URL = 'http://localhost:5190/craft/'
const ARTIST_URL = 'http://localhost:5190/artist/'
const TAKE_ID = 'probe-311-take'
const PAD_ID = 'probe-311-padding'
const PROMPT = 'Resume Previous Session?'
const TAG = 'ESCSUITE-311 O-U2:'

/** A CRAFT-shaped single-file take holding the real 1 s fixture MP4, plus a padding row so the storage meter passes Clear All's 1 MiB gate. */
async function seedTake(page: Page, mp4: number[]): Promise<void> {
  await page.evaluate(
    ({ dbName, dbVersion, takeId, padId, mp4 }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          for (const store of ['videos', 'thumbnails', 'projects']) {
            if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
        }
        request.onerror = () => reject(new Error(`seed open failed: ${String(request.error)}`))
        request.onsuccess = () => {
          const tx = request.result.transaction('videos', 'readwrite')
          const store = tx.objectStore('videos')
          store.put({
            id: takeId,
            blob: new Blob([new Uint8Array(mp4)], { type: 'video/mp4' }),
            metadata: {
              id: takeId,
              name: 'Probe 311 take',
              duration: 1,
              width: 64,
              height: 48,
              frameRate: 30,
              mimeType: 'video/mp4',
              size: mp4.length,
              mediaType: 'video',
              source: 'recording',
              recordedAt: 1_700_000_000_000,
              hasAudio: false,
              takeId,
              role: 'screen',
              startOffset: 0,
            },
          })
          // Not a source of anyone's project: it only makes navigator.storage report > 1 MiB.
          store.put({
            id: padId,
            blob: new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'video/webm' }),
            metadata: { id: padId, name: 'padding', source: 'recording', mimeType: 'video/webm', size: 3 * 1024 * 1024 },
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error(`seed write failed: ${String(tx.error)}`))
        }
      }),
    { dbName: DB_NAME, dbVersion: DB_VERSION, takeId: TAKE_ID, padId: PAD_ID, mp4 }
  )
}

/** `getVideo(id)` as the page sees it: the stored row's blob size, or null when the row/bytes are gone. */
function storedBytes(page: Page, id: string): Promise<number | null> {
  return page.evaluate(
    ({ dbName, id }) =>
      new Promise<number | null>((resolve) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => resolve(null)
        request.onsuccess = () => {
          try {
            const get = request.result.transaction('videos', 'readonly').objectStore('videos').get(id)
            get.onsuccess = () => {
              const row = get.result as { blob?: Blob } | undefined
              resolve(row?.blob ? row.blob.size : null)
            }
            get.onerror = () => resolve(null)
          } catch {
            resolve(null)
          }
        }
      }),
    { dbName: DB_NAME, id }
  )
}

/** The `settings` rows that are saved sessions, with the source ids each names. */
function sessionSlots(page: Page): Promise<Array<{ key: string; sourceIds: string[]; clips: number }>> {
  return page.evaluate(
    (dbName) =>
      new Promise<Array<{ key: string; sourceIds: string[]; clips: number }>>((resolve) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => resolve([])
        request.onsuccess = () => {
          try {
            const store = request.result.transaction('settings', 'readonly').objectStore('settings')
            const keys = store.getAllKeys()
            const values = store.getAll()
            store.transaction.oncomplete = () => {
              const out: Array<{ key: string; sourceIds: string[]; clips: number }> = []
              ;(keys.result as IDBValidKey[]).forEach((key, i) => {
                const k = String(key)
                if (!k.startsWith('session:') && k !== 'current-session') return
                const v = values.result[i] as {
                  sourceVideos?: Array<{ id: string }>
                  project?: { timeline?: { clips?: unknown[] } }
                }
                out.push({
                  key: k,
                  sourceIds: (v.sourceVideos ?? []).map((s) => s.id),
                  clips: v.project?.timeline?.clips?.length ?? -1,
                })
              })
              resolve(out)
            }
          } catch {
            resolve([])
          }
        }
      }),
    DB_NAME
  )
}

const tabIdOf = (page: Page) => page.evaluate(() => sessionStorage.getItem('escapeartist-tab-id'))

/** What the container says about the file's streams: ffprobe when present, else codec-id strings. */
function describeWebm(bytes: Buffer): string {
  const strings = ['V_VP9', 'V_VP8', 'A_OPUS'].filter((s) => bytes.includes(s))
  let ffprobe = 'ffprobe unavailable'
  try {
    const dir = mkdtempSync(join(tmpdir(), 'probe311-'))
    const file = join(dir, 'b.webm')
    writeFileSync(file, bytes)
    ffprobe = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames,duration', '-count_frames', '-of', 'compact', file],
      { encoding: 'utf8', timeout: 30_000 }
    )
      .trim()
      .replace(/\n/g, ' | ')
  } catch {
    /* no ffprobe: the string scan above is the answer */
  }
  return `${bytes.length} bytes; EBML magic = ${bytes.subarray(0, 4).toString('hex') === '1a45dfa3'}; codec ids in file = [${strings.join(',')}]; ffprobe: ${ffprobe}`
}

test('ESCSUITE-311 O-U2: Clear All in tab A, then export and restore in tab B', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ acceptDownloads: true })

  const seeder = await context.newPage()
  await seeder.goto(CRAFT_URL)
  await waitForAppReady(seeder, 'craft')
  await seedTake(seeder, Array.from(readFileSync(ARTIST_FIXTURE_MP4)))
  expect(await storedBytes(seeder, TAKE_ID)).toBeGreaterThan(0)

  const openTab = async (): Promise<Page> => {
    const tab = await context.newPage()
    await tab.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}`)
    await waitForAppReady(tab, 'artist')
    await expect(tab.getByText(/^1 clip/).first()).toBeVisible({ timeout: 30_000 })
    await expect(tab.getByRole('dialog', { name: PROMPT })).toHaveCount(0)
    return tab
  }
  const tabA = await openTab()
  const tabB = await openTab()
  const bLogs: string[] = []
  tabB.on('console', (m) => bLogs.push(`${m.type()}: ${m.text()}`))
  tabB.on('pageerror', (e) => bLogs.push(`pageerror: ${e.message}`))

  const idA = await tabIdOf(tabA)
  const idB = await tabIdOf(tabB)
  console.log(`${TAG} tab ids: A=${idA} B=${idB} (distinct = ${idA !== idB})`)

  // Wait until B's own slot exists (autosave debounce 2 s) and names the take.
  await expect
    .poll(async () => (await sessionSlots(tabB)).filter((s) => s.sourceIds.includes(TAKE_ID)).length, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1)
  console.log(`${TAG} slots before Clear All = ${JSON.stringify(await sessionSlots(tabB))}`)

  // Clear All in A, recording the confirm's exact sentence.
  let confirmText = ''
  tabA.once('dialog', (dialog) => {
    confirmText = dialog.message()
    void dialog.accept()
  })
  const clearAll = tabA.getByRole('button', { name: 'Clear All' })
  await expect(clearAll).toBeVisible({ timeout: 20_000 })
  await expect(clearAll).toBeEnabled()
  await clearAll.click()
  await expect.poll(() => storedBytes(seeder, TAKE_ID), { timeout: 15_000 }).toBeNull()
  console.log(`${TAG} Clear All confirm sentence (tab A) = "${confirmText}"`)
  console.log(`${TAG} bytes gone after Clear All: stored row for ${TAKE_ID} = ${await storedBytes(seeder, TAKE_ID)}`)

  // Tab B is untouched: its live project still places the clip.
  console.log(`${TAG} tab B timeline line after A cleared = "${await tabB.getByText(/^\d+ clips?/).first().innerText()}"`)
  const slotsAfterClear = await sessionSlots(tabB)
  console.log(`${TAG} slots after Clear All = ${JSON.stringify(slotsAfterClear)}`)

  // (a) export WebM from B.
  bLogs.length = 0
  await openExportDialog(tabB)
  const download = tabB.waitForEvent('download', { timeout: 90_000 }).then((d) => ({ kind: 'download' as const, d }))
  const alert = tabB
    .locator('[role="alert"]')
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 })
    .then(() => ({ kind: 'alert' as const }))
  await tabB.getByRole('button', { name: 'Download WebM' }).first().click()
  const outcome = await Promise.race([download, alert]).catch((e: Error) => ({ kind: 'timeout' as const, message: e.message }))
  if (outcome.kind === 'download') {
    const path = await outcome.d.path()
    console.log(`${TAG} (a) export outcome = DOWNLOAD "${outcome.d.suggestedFilename()}": ${describeWebm(readFileSync(path))}`)
  } else if (outcome.kind === 'alert') {
    console.log(`${TAG} (a) export outcome = ERROR ALERT: "${(await tabB.locator('[role="alert"]').first().innerText()).replace(/\s+/g, ' ')}"`)
  } else {
    console.log(`${TAG} (a) export outcome = TIMEOUT ${outcome.message}`)
  }
  const dialogText = await tabB.getByRole('dialog').last().innerText().catch(() => '(no dialog text)')
  console.log(`${TAG} (a) export dialog text after run = "${dialogText.replace(/\s+/g, ' ').slice(0, 400)}"`)
  console.log(`${TAG} (a) tab B console during export = ${JSON.stringify(bLogs.filter((l) => /warn|error|pageerror/i.test(l)))}`)

  // (b) reload B WITHOUT suppressRestore (and without loadVideo, which would be refused as a re-import).
  bLogs.length = 0
  await tabB.goto(ARTIST_URL)
  await waitForAppReady(tabB, 'artist')
  console.log(`${TAG} (b) tab B id after reload = ${await tabIdOf(tabB)} (same tab, so same id = ${(await tabIdOf(tabB)) === idB})`)
  const prompt = tabB.getByRole('dialog', { name: PROMPT })
  const offered = await prompt
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  console.log(`${TAG} (b) restore offered = ${offered}`)
  if (offered) {
    console.log(`${TAG} (b) prompt text = "${(await prompt.innerText()).replace(/\s+/g, ' ')}"`)
    await tabB.getByRole('button', { name: 'Restore Session' }).click()
    await expect(prompt).toHaveCount(0, { timeout: 15_000 })
    await tabB.waitForTimeout(1500)
    console.log(`${TAG} (b) after restore: timeline line = "${await tabB.getByText(/^\d+ clips?/).first().innerText().catch(() => '(none)')}"`)
    console.log(`${TAG} (b) after restore: getVideo(${TAKE_ID}) in page = ${await storedBytes(tabB, TAKE_ID)} (null = byteless tile)`)
    const tiles = await tabB.locator('img').evaluateAll((imgs) =>
      imgs.map((i) => ({ alt: (i as HTMLImageElement).alt, src: (i as HTMLImageElement).src.slice(0, 40), ok: (i as HTMLImageElement).naturalWidth > 0 }))
    )
    console.log(`${TAG} (b) after restore: <img> elements = ${JSON.stringify(tiles)}`)
    console.log(`${TAG} (b) after restore: library buttons = ${JSON.stringify(await tabB.getByRole('button', { name: /Add to timeline|Remove/ }).allInnerTexts())}`)
  }
  console.log(`${TAG} (b) tab B console = ${JSON.stringify(bLogs.filter((l) => /warn|error|pageerror/i.test(l)))}`)

  await context.close()
})
