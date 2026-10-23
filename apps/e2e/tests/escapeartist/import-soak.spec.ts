import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'
import { AV_FIXTURE_WEBM } from '../../utils/mediaHealth'
import {
  RESOURCE_KINDS,
  describeGrowth,
  installResourceProbe,
  readLiveCounts,
  type ResourceCounts,
  type ResourceSnapshot,
} from '../../utils/resourceProbe'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-365: the import and restore paths, soaked.
 *
 * The ESCSUITE-350 soak (`soak.spec.ts`) imports once and then drives the
 * preview; nothing there makes resources on the way *in*. A leak on import is
 * the ESCSUITE-339 kind: an `AudioContext` opened to decode an audio file and
 * never closed when the decode fails. Chromium caps live AudioContexts, so a
 * user who imports enough undecodable files eventually gets no audio at all.
 *
 * Each cycle imports two files through the library's file input:
 *
 * - the A/V fixture (`fixtures/av/tone-gap.webm`, VP9/Opus, which every
 *   Chromium decodes; the H.264/AAC twin is not used because headless shells
 *   without proprietary codecs cannot decode it), which goes through the video
 *   path: metadata and frame-rate probe `<video>`, thumbnail `<video>`,
 *   streamed waveform decode (`AudioDecoder`), stored thumbnail blob URL;
 * - `fixtures/av/undecodable-opus.webm` (`make-undecodable.mjs`), a sound 2 s
 *   WebM whose every Opus packet is invalid, as `audio/webm`: the `<audio>`
 *   probe reads its 2 s, the streamed waveform decode errors, and the
 *   whole-file fallback opens an `AudioContext` whose `decodeAudioData`
 *   rejects (`decodeWholeFileWaveform`, `apps/artist/src/utils/waveform.ts`),
 *   which must be closed on that failure.
 *
 * Both go on the timeline, then come off it (select, Delete) and out of the
 * library (Remove media), which revokes their thumbnail URLs and lets the
 * preview release its `<video>`. Every {@link RESTORE_EVERY}th cycle also
 * reloads with both on the timeline and restores the autosaved session from
 * the "Resume Previous Session?" prompt before deleting them, so the restore
 * path's blob URLs and elements must be released by the same delete. A
 * restore reads the stored waveform, so it decodes nothing and opens no
 * AudioContext. The reload restarts the page's counts, so the checks after
 * cycles 6, 8 and 10 compare a reloaded page with cycle 1's; and since a
 * restore happens once per page, a resource it leaked would be only 1 over
 * the baseline, inside {@link ALLOWED_GROWTH}. So on a restore cycle the check
 * allows no growth at all ({@link NO_GROWTH}), polled for up to 5 s so an
 * asynchronous release can land.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Live counts need a forced GC, which goes through Chromium’s DevTools protocol'
)

const CYCLES = 10
const CHECK_EVERY = 2
const RESTORE_EVERY = 5

const UNDECODABLE = {
  name: 'undecodable-opus.webm',
  mimeType: 'audio/webm',
  buffer: readFileSync(
    resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/av/undecodable-opus.webm')
  ),
}
const AV = { name: 'tone-gap.webm', mimeType: 'video/webm', buffer: readFileSync(AV_FIXTURE_WEBM) }

/**
 * How far each live count may rise above its cycle-1 value before the soak
 * calls it a leak.
 *
 * Every check reads the page with both files deleted, after a forced GC, so a
 * correct app is back where cycle 1 left it. Measured on this spec (headless
 * Chromium 1194, repeated runs): every live count was 0 at every check, cycle
 * 1 included, while each cycle made one `AudioContext`, two `AudioDecoder`s,
 * seven blob URLs and five media elements and released them all. So the
 * allowance is only for a release that is asynchronous and caught mid-flight
 * by the sample: one of each kind. A leak of one resource per cycle is 2 over
 * the baseline by the second check (cycle 4) and fails there: dropping the
 * `audioContext.close()` on `decodeWholeFileWaveform`'s failure path does.
 */
const ALLOWED_GROWTH: ResourceCounts = {
  audioContext: 1,
  offlineAudioContext: 1,
  videoDecoder: 1,
  audioDecoder: 1,
  worker: 1,
  objectUrl: 1,
  mediaElement: 1,
}

/** A restore cycle's allowance: none (see the header). */
const NO_GROWTH: ResourceCounts = {
  audioContext: 0,
  offlineAudioContext: 0,
  videoDecoder: 0,
  audioDecoder: 0,
  worker: 0,
  objectUrl: 0,
  mediaElement: 0,
}

const fileInput = (page: Page) => page.locator('input[type="file"]')
const addButtons = (page: Page) => page.getByRole('button', { name: 'Add to timeline' })

async function openEditor(page: Page): Promise<void> {
  await installResourceProbe(page)
  // Remove media asks before it deletes.
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
}

/** Import both files and put each on the timeline. */
async function importBoth(page: Page, n: number): Promise<void> {
  await fileInput(page).setInputFiles(AV)
  await expect(addButtons(page), `cycle ${n}: the A/V file never reached the library`).toHaveCount(1, {
    timeout: 30_000,
  })
  await addButtons(page).first().click()
  await expect(page.getByText(/^1 clip ·/)).toBeVisible({ timeout: 15_000 })

  await fileInput(page).setInputFiles(UNDECODABLE)
  await expect(addButtons(page), `cycle ${n}: the undecodable file never reached the library`).toHaveCount(
    2,
    { timeout: 30_000 }
  )
  await addButtons(page).nth(1).click()
  await expect(page.getByText(/^2 clips ·/)).toBeVisible({ timeout: 15_000 })
}

/** Reload and take the "Resume Previous Session?" offer: both clips come back. */
async function reloadAndRestore(page: Page, n: number, importedAt: number): Promise<void> {
  await waitForSavedSession(page, 2, importedAt)
  await page.reload()
  await waitForAppReady(page, 'artist')
  const prompt = page.getByRole('dialog', { name: 'Resume Previous Session?' })
  await expect(prompt, `cycle ${n}: no session offered`).toBeVisible({ timeout: 15_000 })
  await prompt.getByRole('button', { name: 'Restore Session' }).click()
  await expect(page.getByText(/^2 clips ·/), `cycle ${n}: the clips did not come back`).toBeVisible({
    timeout: 15_000,
  })
  await expect(addButtons(page)).toHaveCount(2)
}

/** Both clips off the timeline, then both files out of the library. */
async function deleteBoth(page: Page, n: number): Promise<void> {
  const clips = page.locator('[data-clip-id]')
  for (const remaining of [1, 0]) {
    await clips.first().click()
    await page.keyboard.press('Delete')
    await expect(clips, `cycle ${n}: a clip did not leave the timeline`).toHaveCount(remaining)
  }
  const remove = page.getByRole('button', { name: 'Remove media' })
  for (const remaining of [1, 0]) {
    await remove.first().click()
    await expect(remove, `cycle ${n}: a file did not leave the library`).toHaveCount(remaining)
  }
  await expect(page.getByText('No media uploaded yet')).toBeVisible()
}

/** AudioContexts made since the page loaded, closed or not. No GC needed. */
function audioContextsMade(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __resourceProbe: { created: { audioContext: number } } }).__resourceProbe.created
        .audioContext
  )
}

function line(n: number, s: ResourceSnapshot): string {
  return `after cycle ${n}: live ${JSON.stringify(s.live)} made ${JSON.stringify(s.created)}`
}

test.describe('ESCAPEARTIST import soak (ESCSUITE-365)', () => {
  test(`${CYCLES} import → delete cycles, with a restore every ${RESTORE_EVERY}, leave no resource behind`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openEditor(page)

    let baseline: ResourceCounts | null = null
    const history: string[] = []
    for (let n = 1; n <= CYCLES; n++) {
      const opened = await audioContextsMade(page)
      const importedAt = Date.now()
      await importBoth(page, n)
      // The failed decode opened its AudioContext: the path this soak is for
      // really ran, every cycle.
      expect(
        (await audioContextsMade(page)) - opened,
        `cycle ${n}: the undecodable file's import opened no AudioContext — the fallback decode did not run, ` +
          'or the streamed AudioDecoder accepted the invalid Opus packets (Chromium change after a Playwright bump?)'
      ).toBe(1)
      const restored = n % RESTORE_EVERY === 0
      if (restored) await reloadAndRestore(page, n, importedAt)
      await deleteBoth(page, n)
      if (n !== 1 && n % CHECK_EVERY !== 0 && !restored) continue

      let now = await readLiveCounts(page)
      baseline ??= now.live
      const base = baseline
      if (restored) {
        // No growth at all after a restore: poll so an asynchronous release lands.
        await expect
          .poll(
            async () => {
              now = await readLiveCounts(page)
              return describeGrowth(base, now, NO_GROWTH)
            },
            { message: `cycle ${n}: live resources left after the restore and delete`, timeout: 5_000 }
          )
          .toEqual([])
      }
      history.push(line(n, now))
      const growth = describeGrowth(base, now, restored ? NO_GROWTH : ALLOWED_GROWTH)
      expect(growth, `live resources grew over ${n} cycles:\n${growth.join('\n')}\n${history.join('\n')}`).toEqual([])
    }
    // On the report, so a passing run still shows what it measured.
    test.info().annotations.push({ type: 'live counts', description: history.join(' | ') })
    expect(Object.keys(baseline!).sort()).toEqual([...RESOURCE_KINDS].sort())
  })
})

/**
 * Wait for the autosave (`app/useSessionAutosave.ts`, 2 s after the last
 * edit) to write a session holding `clips` clips, saved after `since`, so the
 * reload has this cycle's session to offer. The autosave never overwrites the
 * slot with an empty project, so an earlier cycle's 2-clip session is still
 * there until it does: the timestamp tells them apart.
 */
async function waitForSavedSession(page: Page, clips: number, since: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (since) =>
            new Promise<number>((resolve, reject) => {
              const request = indexedDB.open('video-editor-db')
              request.onerror = () => reject(new Error('open failed'))
              request.onsuccess = () => {
                const db = request.result
                const all = db.transaction('settings', 'readonly').objectStore('settings').getAll()
                all.onerror = () => reject(new Error('read failed'))
                all.onsuccess = () => {
                  const sessions = all.result as Array<{
                    timestamp?: number
                    project?: { timeline?: { clips?: unknown[] } }
                  }>
                  const fresh = sessions.filter((s) => (s?.timestamp ?? 0) > since)
                  resolve(Math.max(0, ...fresh.map((s) => s?.project?.timeline?.clips?.length ?? 0)))
                  db.close()
                }
              }
            }),
          since
        ),
      { message: `the autosave never wrote a session holding ${clips} clips`, timeout: 15_000 }
    )
    .toBe(clips)
}
