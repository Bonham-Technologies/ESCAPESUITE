import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
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
 *
 * ESCSUITE-283: a fresh tab claims a departed tab's slot through a lock of its
 * own, `escapeartist-offer:<tabId>`, held while the slot is on offer (the tab
 * lock itself is only probed), so two fresh tabs opened together after A
 * closes are not both offered A's session — the second case below.
 *
 * ESCSUITE-306: a free tab lock is not proof the tab is gone for good. Chrome's
 * Memory Saver (on by default) discards a background tab — its page, and so its
 * lock, is gone — but the tab stays in the strip with its `sessionStorage`, id
 * and all, and reloads looking for its own slot when it is clicked. Start Fresh
 * in another tab therefore leaves another tab's slot in storage, and that tab
 * does not offer it again — the third case below.
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
      // A real source, so B's slot is one the prompt would offer (a slot with
      // no media never is): in (d) only B's live lock keeps it from being
      // offered, and it is the newer of the two.
      await importMediaAndAddToTimeline(tabB)
      await expect
        .poll(() => slotOf(tabB, idB), { timeout: 15_000 })
        .toEqual({ name: 'Tab B', sources: 1, clips: 1 })
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
          [idB]: { name: 'Tab B', sources: 1, clips: 1 },
          [idC]: { name: 'Tab A', sources: 1, clips: 1 },
        })
    })
  })

  test('two fresh tabs opened together after a tab closes: only one is offered its session (ESCSUITE-283)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const context = page.context()

    // Tab A: a real source and a clip, autosaved into A's own slot, then closed.
    await page.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab A')}`)
    await waitForAppReady(page, 'artist')
    const idA = (await tabIdOf(page))!
    await importMediaAndAddToTimeline(page)
    await expect
      .poll(() => slotOf(page, idA), { timeout: 15_000 })
      .toEqual({ name: 'Tab A', sources: 1, clips: 1 })
    await page.close()

    // Two fresh tabs at once. Whichever asks first claims A's offer while its
    // prompt is up; the other finds the offer held and, with no other slot, is
    // offered nothing.
    const [first, second] = await Promise.all([
      (async () => {
        const tab = await context.newPage()
        await tab.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab C')}`)
        await waitForAppReady(tab, 'artist')
        return tab
      })(),
      (async () => {
        const tab = await context.newPage()
        await tab.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab D')}`)
        await waitForAppReady(tab, 'artist')
        return tab
      })(),
    ])
    const promptOf = (tab: Page) => tab.getByRole('dialog', { name: 'Resume Previous Session?' })

    // Give both startup checks well past a lock request and a storage read.
    await expect
      .poll(async () => (await promptOf(first).count()) + (await promptOf(second).count()), { timeout: 15_000 })
      .toBe(1)
    await first.waitForTimeout(1_500)
    const offeredTo = (await promptOf(first).count()) === 1 ? first : second
    const passedOver = offeredTo === first ? second : first
    await expect(promptOf(passedOver)).toHaveCount(0)
    await expect(promptOf(offeredTo).getByText('Tab A', { exact: true })).toBeVisible()

    // Restoring adopts it once: A's row is gone and exactly one tab holds it.
    const idOffered = (await tabIdOf(offeredTo))!
    await offeredTo.getByRole('button', { name: 'Restore Session' }).click()
    await expect
      .poll(() => readSlots(offeredTo), { timeout: 15_000 })
      .toEqual({ [idOffered]: { name: 'Tab A', sources: 1, clips: 1 } })
  })

  test('Start Fresh in another tab leaves a discarded tab\'s session for it to come back to (ESCSUITE-306)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const context = page.context()

    // Tab A: a real source and a clip, autosaved into A's own slot.
    await page.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab A')}`)
    await waitForAppReady(page, 'artist')
    const idA = (await tabIdOf(page))!
    await importMediaAndAddToTimeline(page)
    await expect
      .poll(() => slotOf(page, idA), { timeout: 15_000 })
      .toEqual({ name: 'Tab A', sources: 1, clips: 1 })

    // A discard, simulated: A's page goes (its lock with it) and what survives
    // is its sessionStorage, which the reactivated tab will start with. The
    // real thing, headed Chromium only — not run in CI:
    //   const discards = await context.newPage()
    //   await discards.goto('chrome://discards')
    //   // find tab A's row and click its "Urgent discard" link, then later
    //   // `await page.bringToFront()` to reactivate it
    const survivingSessionStorage = await page.evaluate(() => {
      const items: Record<string, string> = {}
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!
        items[key] = sessionStorage.getItem(key)!
      }
      return items
    })
    expect(survivingSessionStorage['escapeartist-tab-id']).toBe(idA)
    await page.close()

    const tabB = await test.step('(a) a fresh tab is offered the discarded tab\'s session, and Start Fresh keeps it', async () => {
      const tab = await context.newPage()
      await tab.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab B')}`)
      await waitForAppReady(tab, 'artist')
      const prompt = tab.getByRole('dialog', { name: 'Resume Previous Session?' })
      await expect(prompt).toBeVisible({ timeout: 15_000 })
      await expect(prompt.getByText('Tab A', { exact: true })).toBeVisible()
      await tab.getByRole('button', { name: 'Start Fresh' }).click()
      await expect(prompt).toHaveCount(0)
      await tab.waitForTimeout(PAST_THE_DEBOUNCE_MS)
      expect(await slotOf(tab, idA)).toEqual({ name: 'Tab A', sources: 1, clips: 1 })
      return tab
    })

    await test.step('(b) the tab that declined it is not offered it again on a reload', async () => {
      await tabB.reload()
      await waitForAppReady(tabB, 'artist')
      await tabB.waitForTimeout(1_500)
      await expect(tabB.getByRole('dialog', { name: 'Resume Previous Session?' })).toHaveCount(0)
      expect(await slotOf(tabB, idA)).toEqual({ name: 'Tab A', sources: 1, clips: 1 })
    })

    await test.step('(c) the discarded tab comes back to its own session', async () => {
      const tabA = await context.newPage()
      await tabA.addInitScript((items: Record<string, string>) => {
        for (const [key, value] of Object.entries(items)) sessionStorage.setItem(key, value)
      }, survivingSessionStorage)
      await tabA.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab A')}`)
      await waitForAppReady(tabA, 'artist')
      expect(await tabIdOf(tabA)).toBe(idA)

      const prompt = tabA.getByRole('dialog', { name: 'Resume Previous Session?' })
      await expect(prompt).toBeVisible({ timeout: 15_000 })
      await expect(prompt.getByText('Tab A', { exact: true })).toBeVisible()
      await tabA.getByRole('button', { name: 'Restore Session' }).click()
      await expect(prompt).toHaveCount(0)
      await expect(tabA.getByText('Session restored')).toBeVisible()
      await tabA.waitForTimeout(PAST_THE_DEBOUNCE_MS)
      expect(await slotOf(tabA, idA)).toEqual({ name: 'Tab A', sources: 1, clips: 1 })
    })
  })
})
