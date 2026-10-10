import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-227: every ESCAPEARTIST tab of one origin shares one autosave slot
 * (`settings` / `current-session` in `video-editor-db`). Before the ticket a
 * second tab was offered the first tab's LIVE work as "Resume Previous
 * Session?", and a third tab found nothing at all once the second had pressed
 * Start Fresh and autosaved its empty project over the slot.
 *
 * Now one tab at a time owns the slot through a Web Lock
 * (`apps/artist/src/app/sessionLock.ts`): a tab that finds another live tab
 * owning it offers nothing, writes nothing and says so once; when the owner
 * closes, the next tab queued becomes the owner and autosaves from its next
 * change. Three tabs in one browser context — one origin, one lock manager.
 */

/** `SESSION_HELD_NOTICE` in `apps/artist/src/app/useSessionRestore.ts`. */
const SESSION_HELD_NOTICE =
  'Another ESCAPEARTIST tab is open. This tab will not offer or save a session until that tab closes.'

/** ESCAPEARTIST's autosave debounce (`AUTO_SAVE_DELAY`) is 2 s; give it room. */
const PAST_THE_DEBOUNCE_MS = 3_000

interface Slot {
  name: string | null
  sources: number
  clips: number
}

/** What the shared session slot holds right now, read through the page. */
function readSlot(page: Page): Promise<Slot | null> {
  return page.evaluate(
    () =>
      new Promise<Slot | null>((resolve) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => resolve(null)
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('settings')) {
            db.close()
            resolve(null)
            return
          }
          const get = db.transaction('settings', 'readonly').objectStore('settings').get('current-session')
          get.onerror = () => {
            db.close()
            resolve(null)
          }
          get.onsuccess = () => {
            const session = get.result as
              | {
                  project?: { name?: string; timeline?: { clips?: unknown[] } }
                  sourceVideos?: unknown[]
                }
              | undefined
            db.close()
            resolve(
              session
                ? {
                    name: session.project?.name ?? null,
                    sources: session.sourceVideos?.length ?? 0,
                    clips: session.project?.timeline?.clips?.length ?? 0,
                  }
                : null
            )
          }
        }
      })
  )
}

/** Open ESCAPEARTIST in a new tab of `page`'s context, named by `?title=`. */
async function openTab(from: Page, title: string): Promise<Page> {
  const tab = await from.context().newPage()
  await tab.goto(`${ARTIST_URL}/?title=${encodeURIComponent(title)}`)
  await waitForAppReady(tab, 'artist')
  return tab
}

test.describe('Two ESCAPEARTIST tabs share one session slot (ESCSUITE-227)', () => {
  test('only the owning tab offers or writes the session', async ({ page }) => {
    test.setTimeout(120_000)

    // Tab A: the owner, with a real source and a clip, autosaved.
    await page.goto(`${ARTIST_URL}/?title=${encodeURIComponent('Tab A')}`)
    await waitForAppReady(page, 'artist')
    const tabA = page
    await importMediaAndAddToTimeline(tabA)
    await expect
      .poll(() => readSlot(tabA), { timeout: 15_000 })
      .toEqual({ name: 'Tab A', sources: 1, clips: 1 })

    const tabB = await test.step('(a) a second tab is not offered the first tab\'s live session', async () => {
      const tab = await openTab(tabA, 'Tab B')
      // The notice is the decision: once it is up, the prompt is not coming.
      await expect(tab.getByText(SESSION_HELD_NOTICE)).toBeVisible()
      await expect(tab.getByRole('dialog', { name: 'Resume Previous Session?' })).toHaveCount(0)
      return tab
    })

    await test.step('(b) a third tab opened later is told the same, and the slot is still A\'s', async () => {
      // Tab B answers nothing and edits nothing; give it well past the debounce.
      await tabB.waitForTimeout(PAST_THE_DEBOUNCE_MS)

      const tabC = await openTab(tabA, 'Tab C')
      await expect(tabC.getByText(SESSION_HELD_NOTICE)).toBeVisible()
      await expect(tabC.getByRole('dialog', { name: 'Resume Previous Session?' })).toHaveCount(0)

      expect(await readSlot(tabC)).toEqual({ name: 'Tab A', sources: 1, clips: 1 })
    })

    await test.step('(c) once the owner closes, the next tab writes the slot from its next change', async () => {
      await tabA.close()

      await seedTextClip(tabB)
      await expect
        .poll(() => readSlot(tabB), { timeout: 15_000 })
        .toEqual({ name: 'Tab B', sources: 0, clips: 1 })
    })
  })
})
