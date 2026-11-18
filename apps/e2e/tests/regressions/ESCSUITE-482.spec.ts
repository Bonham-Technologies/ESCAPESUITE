import { test, expect, type Page } from '@playwright/test'
import { clipSpansOf, clipsLabelled, openRemoveSilences, openSilenceTake, seekByRuler } from '../../utils/silenceTake'

/**
 * ESCSUITE-482: "Remove silences" and Split gave every piece of a clip the
 * clip's own "Transition Out". A transition plays at a clip's end, and every
 * piece but the last ends where the next one starts, so a take with a wipe
 * played that wipe at every cut. Now only the piece that ends where the clip
 * ended keeps it, and one Ctrl+Z gives the clip back with its transition.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`); its one pause is cut
 * from 2.1 s to 2.9 s. Each piece's transition is read where the user reads
 * it, in the inspector's "Transition Out" (what plays at a join is exactly the
 * outgoing piece's transition: `getActiveTransition`, unit-tested in
 * `rippleRanges.test.ts`). Chromium only, as ESCSUITE-403: the take is seeded
 * as Blobs in IndexedDB.
 */

const SCREEN = /^Talk(?! —)/

/** Open the inspector's "Transition Out" if it is closed, and return its Type select. */
async function transitionType(page: Page) {
  const type = page.getByRole('combobox', { name: 'Type' })
  if (!(await type.isVisible())) await page.getByRole('button', { name: /Transition Out/ }).click()
  await expect(type).toBeVisible()
  return type
}

/** Select the take's `index`th screen piece, left to right. */
async function selectPiece(page: Page, index: number) {
  const pieces = clipsLabelled(page, SCREEN)
  const lefts = await pieces.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left))
  const order = lefts.map((left, i) => ({ left, i })).sort((a, b) => a.left - b.left)
  // Near its left edge: a click on a clip also moves the playhead there, and a
  // playhead at the clip's middle would take the next click on it.
  await pieces.nth(order[index].i).click({ position: { x: 8, y: 8 } })
}

/** The "Transition Out" type the inspector shows for each screen piece, left to right. */
async function transitionsShown(page: Page): Promise<string[]> {
  const shown: string[] = []
  const count = await clipsLabelled(page, SCREEN).count()
  for (let i = 0; i < count; i++) {
    await selectPiece(page, i)
    shown.push(await (await transitionType(page)).inputValue())
  }
  return shown
}

/** Give the take's screen part a 0.5 s Wipe Left from the inspector's "Transition Out". */
async function giveWipe(page: Page) {
  await selectPiece(page, 0)
  await (await transitionType(page)).selectOption('wipe-left')
}

test.describe('ESCSUITE-482: only the clip\'s real end keeps its transition', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('Remove silences plays no wipe at the cut, and one Ctrl+Z gives it back', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-482-cut')
    await giveWipe(page)

    const dialog = await openRemoveSilences(page)
    await dialog.getByRole('button', { name: 'Remove all' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()

    // The piece before the cut ends where the next one starts.
    const [before, after] = await clipSpansOf(page, clipsLabelled(page, SCREEN))
    expect(after.start).toBeCloseTo(before.end, 1)
    expect(await transitionsShown(page), 'only the piece ending where the clip ended keeps the wipe').toEqual(['none', 'wipe-left'])

    // The first piece keeps the clip's id, so the clip it gives back stays
    // selected (the playhead now sits where it was clicked, so no new click).
    await selectPiece(page, 0)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()
    await expect(clipsLabelled(page, SCREEN)).toHaveCount(1)
    await expect(await transitionType(page), 'one Ctrl+Z gives the clip back with its wipe').toHaveValue('wipe-left')
  })

  test('Split leaves the wipe on the second half only', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-482-split')
    await giveWipe(page)
    await seekByRuler(page, 2)
    await page.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()

    const [first, second] = await clipSpansOf(page, clipsLabelled(page, SCREEN))
    expect(second.start).toBeCloseTo(first.end, 1)
    expect(await transitionsShown(page), 'the second half keeps the wipe, the first has none').toEqual(['none', 'wipe-left'])
  })
})
