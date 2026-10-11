import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-274 (after ESCSUITE-227): every ESCAPEARTIST tab autosaves to a slot
 * of its own — `settings` / `session:<tabId>` in `video-editor-db`, the id kept
 * in that tab's `sessionStorage` — and holds the Web Lock
 * `escapeartist-tab:<tabId>` for as long as it lives
 * (`apps/artist/src/app/sessionLock.ts`). The startup prompt offers the newest
 * slot whose tab lock is free: a tab that closed or crashed, never a live one.
 *
 * Before the ticket every tab shared one slot and one lock: when the owning tab
 * crashed, the next tab became the owner and its next edit overwrote the
 * crashed tab's session. Here tab A edits and then closes — `page.close()`
 * releases its lock, standing in for a crash — tab B, open throughout, goes on
 * editing, and a fresh tab C is offered A's session, not B's live one. Three
 * tabs in one browser context: one origin, one database, one lock manager.
 */

/** ESCAPEARTIST's autosave debounce (`AUTO_SAVE_DELAY`) is 2 s; give it room. */
const PAST_THE_DEBOUNCE_MS = 3_000

interface Slot {
  name: string | null
  sources: number
  clips: number
}

/** This tab's id, the key of its slot (`apps/artist/src/app/tabId.ts`). */
function tabIdOf(page: Page): Promise<string | null> {
  return page.evaluate(() => sessionStorage.getItem('escapeartist-tab-id'))
}

/** Every tab's slot, keyed by tab id, read through `page`. */
function readSlots(page: Page): Promise<Record<string, Slot>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, Slot>>((resolve) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => resolve({})
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('settings')) {
            db.close()
            resolve({})
            return
          }
          const store = db.transaction('settings', 'readonly').objectStore('settings')
          const range = IDBKeyRange.bound('session:', 'session:￿')
          const keys = store.getAllKeys(range)
          const values = store.getAll(range)
          values.onerror = () => {
            db.close()
            resolve({})
          }
          values.onsuccess = () => {
            const slots: Record<string, Slot> = {}
            ;(keys.result as string[]).forEach((key, index) => {
              const session = values.result[index] as {
                project?: { name?: string; timeline?: { clips?: unknown[] } }
                sourceVideos?: unknown[]
              }
              slots[key.slice('session:'.length)] = {
                name: session.project?.name ?? null,
                sources: session.sourceVideos?.length ?? 0,
                clips: session.project?.timeline?.clips?.length ?? 0,
              }
            })
            db.close()
            resolve(slots)
          }
        }
      })
  )
}

/** What one tab's own slot holds, or `null`. */
async function slotOf(reader: Page, tabId: string): Promise<Slot | null> {
  return (await readSlots(reader))[tabId] ?? null
}

/** Open ESCAPEARTIST in a new tab of `from`'s context, named by `?title=`. */
async function openTab(from: Page, title: string): Promise<Page> {
  const tab = await from.context().newPage()
  await tab.goto(`${ARTIST_URL}/?title=${encodeURIComponent(title)}`)
  await waitForAppReady(tab, 'artist')
  return tab
}

test.describe('One session slot per ESCAPEARTIST tab (ESCSUITE-274)', () => {
  // Tab A's work is a real imported source, and on WebKit the shared
  // `importMediaAndAddToTimeline` helper (`utils/artist.ts`) fails before any
  // session logic runs — the same failure `escapeartist/video-import.spec.ts`
  // shows on WebKit on main (2 of its 9 cases), so it is pre-existing and not
  // this spec's subject. Chromium and Firefox run it.
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit fails inside importMediaAndAddToTimeline before any session logic runs — pre-existing on main, as in video-import.spec.ts'
  )

  test('a crashed tab\'s session survives another tab\'s edits and is offered to a fresh tab', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    // Tab A: a real source and a clip, autosaved into A's own slot.
    await page.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab A')}`)
    await waitForAppReady(page, 'artist')
    const tabA = page
    const idA = (await tabIdOf(tabA))!
    expect(idA).toBeTruthy()
    await importMediaAndAddToTimeline(tabA)
    await expect
      .poll(() => slotOf(tabA, idA), { timeout: 15_000 })
      .toEqual({ name: 'Tab A', sources: 1, clips: 1 })

    const tabB = await test.step('(a) a second tab is not offered the first tab\'s live session', async () => {
      const tab = await openTab(tabA, 'Tab B')
      // The startup check is a lock probe and one storage read; give it well
      // past that before calling the absence a pass.
      await tab.waitForTimeout(1_500)
      await expect(tab.getByRole('dialog', { name: 'Resume Previous Session?' })).toHaveCount(0)
      expect(await tabIdOf(tab)).not.toBe(idA)
      return tab
    })
    const idB = (await tabIdOf(tabB))!

    await test.step('(b) the first tab closes — its lock goes with it, as in a crash', async () => {
      await tabA.close()
    })

    await test.step('(c) the second tab edits, into its own slot, and leaves the first tab\'s alone', async () => {
      await seedTextClip(tabB)
      await expect
        .poll(() => slotOf(tabB, idB), { timeout: 15_000 })
        .toEqual({ name: 'Tab B', sources: 0, clips: 1 })
      await tabB.waitForTimeout(PAST_THE_DEBOUNCE_MS)
      expect(await slotOf(tabB, idA)).toEqual({ name: 'Tab A', sources: 1, clips: 1 })
    })

    await test.step('(d) a fresh tab is offered the closed tab\'s session, not the live tab\'s newer one', async () => {
      const tabC = await openTab(tabB, 'Tab C')
      const prompt = tabC.getByRole('dialog', { name: 'Resume Previous Session?' })
      await expect(prompt).toBeVisible({ timeout: 15_000 })
      await expect(prompt.getByText('Tab A', { exact: true })).toBeVisible()
      await expect(prompt.getByText('Tab B', { exact: true })).toHaveCount(0)

      // Restoring adopts it: A's row is gone, the session is under C's id, and
      // B's live slot is untouched.
      const idC = (await tabIdOf(tabC))!
      await tabC.getByRole('button', { name: 'Restore Session' }).click()
      await expect
        .poll(() => readSlots(tabC), { timeout: 15_000 })
        .toEqual({
          [idB]: { name: 'Tab B', sources: 0, clips: 1 },
          [idC]: { name: 'Tab A', sources: 1, clips: 1 },
        })
    })
  })
})
