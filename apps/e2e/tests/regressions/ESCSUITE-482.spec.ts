import { test, expect, type Page } from '@playwright/test'
import { clipsLabelled, openRemoveSilences, openSilenceTake, seekByRuler } from '../../utils/silenceTake'

/**
 * ESCSUITE-482: "Remove silences" and Split gave every piece of a clip the
 * clip's own "Transition Out". A transition plays at a clip's end, and every
 * piece but the last ends where the next one starts, so a take with a wipe
 * played that wipe at every cut. Now only the piece that ends where the clip
 * ended keeps it, and one Ctrl+Z gives the clip back with its transition.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`); its one pause is cut
 * from 2.1 s to 2.9 s. What a piece will play is read from the editor's own
 * store, through the dev server's module of it (the regression suite runs
 * against the dev servers only). Chromium only, as ESCSUITE-403: the take is
 * seeded as Blobs in IndexedDB.
 */

const WIPE = { type: 'wipe-left', duration: 0.5 }
const NONE = { type: 'none', duration: 0.5 }
const SCREEN = /^Talk(?! —)/

interface Piece {
  name: string
  start: number
  end: number
  transition: { type: string; duration: number }
  /** Whether a transition plays just before this piece ends. */
  playsAtEnd: boolean
}

/** The take's screen pieces, left to right, as the store holds them. */
async function screenPieces(page: Page): Promise<Piece[]> {
  return page.evaluate(async () => {
    type StoreClip = { id: string; name: string; trackId: string; timelinePosition: number; duration: number; transition: Piece['transition'] }
    type Timeline = { clips: StoreClip[]; tracks: unknown[] }
    // Held in variables so the bundler of this spec leaves them to the page.
    const storeUrl = '/src/store/projectStore.ts'
    const exportUrl = '/src/core/exportTypes.ts'
    const { useEditorStore } = (await import(/* @vite-ignore */ storeUrl)) as {
      useEditorStore: { getState(): { project: { timeline: Timeline } } }
    }
    const { getActiveTransition } = (await import(/* @vite-ignore */ exportUrl)) as {
      getActiveTransition(clips: StoreClip[], tracks: unknown[], time: number): { outgoingClip: StoreClip } | null
    }
    const { clips, tracks } = useEditorStore.getState().project.timeline
    return clips
      .filter((c) => c.name.startsWith('Talk') && !c.name.includes('microphone'))
      .sort((a, b) => a.timelinePosition - b.timelinePosition)
      .map((c) => {
        const end = c.timelinePosition + c.duration
        return {
          name: c.name,
          start: c.timelinePosition,
          end,
          transition: c.transition,
          playsAtEnd: getActiveTransition(clips, tracks, end - 0.1)?.outgoingClip.id === c.id,
        }
      })
  })
}

/** Give the selected clip a 0.5 s Wipe Left from the inspector's "Transition Out". */
async function giveWipe(page: Page) {
  // Near its left edge: a click on a clip also moves the playhead there, and a
  // playhead at the clip's middle would take the next click on it.
  await clipsLabelled(page, SCREEN).first().click({ position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: /Transition Out/ }).click()
  await page.getByRole('combobox', { name: 'Type' }).selectOption('wipe-left')
}

test.describe('ESCSUITE-482: only the clip\'s real end keeps its transition', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('Remove silences plays no wipe at the cut, and one Ctrl+Z gives it back', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-482-cut')
    await giveWipe(page)
    const [whole] = await screenPieces(page)
    expect(whole.transition).toEqual(WIPE)

    const dialog = await openRemoveSilences(page)
    await dialog.getByRole('button', { name: 'Remove all' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()

    const [before, after] = await screenPieces(page)
    // The piece before the cut ends where the next one starts.
    expect(after.start).toBeCloseTo(before.end, 6)
    expect(before.transition, 'the piece before the cut has no transition').toEqual(NONE)
    expect(before.playsAtEnd, 'no transition plays at the cut').toBe(false)
    expect(after.transition, 'the piece ending where the clip ended keeps the wipe').toEqual(WIPE)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()
    const restored = await screenPieces(page)
    expect(restored).toHaveLength(1)
    expect(restored[0].transition).toEqual(WIPE)
  })

  test('Split leaves the wipe on the second half only', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-482-split')
    await giveWipe(page)
    await seekByRuler(page, 2)
    await page.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()

    const [first, second] = await screenPieces(page)
    expect(second.start).toBeCloseTo(first.end, 6)
    expect(first.transition, 'the first half has no transition').toEqual(NONE)
    expect(first.playsAtEnd, 'no transition plays at the split').toBe(false)
    expect(second.transition, 'the second half keeps the wipe').toEqual(WIPE)
  })
})
