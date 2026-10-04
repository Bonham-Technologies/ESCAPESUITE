import { test, expect } from '@playwright/test'
import {
  seedTextClip,
  openExportDialog,
  openExportAdvancedOptions,
  importMediaAndAddToTimeline,
  makeToneWav,
  keyframePanel,
  inspector,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    // "Export video" is disabled while the timeline is empty, so the dialog
    // cannot be reached without a clip on it.
    await seedTextClip(page)
  })

  test('export dialog opens', async ({ page }) => {
    await openExportDialog(page)

    await expect(page.getByRole('button', { name: 'Download WebM' }).first()).toBeVisible()
  })

  test('export format selection works', async ({ page }) => {
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    await expect(page.getByRole('radio', { name: /WebM/ })).toBeChecked()

    const mp4 = page.getByRole('radio', { name: /MP4/ })
    await mp4.check()
    await expect(mp4).toBeChecked()

    // Choosing a format retargets the download button
    await expect(page.getByRole('button', { name: 'Download MP4' }).first()).toBeVisible()
  })

  test('export quality selection available', async ({ page }) => {
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    const quality = page.locator('select').filter({ has: page.locator('option[value="high"]') })
    await expect(quality).toHaveCount(1)

    await quality.selectOption('high')
    await expect(quality).toHaveValue('high')
  })

  test('export resolution selection available', async ({ page }) => {
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    // 480p is offered only by the export dialog's resolution picker, not by the
    // media library's project-resolution one.
    const resolution = page.locator('select').filter({ has: page.locator('option[value="480p"]') })
    await expect(resolution).toHaveCount(1)

    await resolution.selectOption('720p')
    await expect(resolution).toHaveValue('720p')
  })

  test('export progress display exists', async ({ page }) => {
    await openExportDialog(page)

    await page.getByRole('button', { name: 'Download WebM' }).first().click()

    // Encoding reports which frame it is on, so the user can tell it is moving
    await expect(page.getByText(/Encoding frame \d+\/\d+/)).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()
  })

  test('the editor behind it takes no keys', async ({ page }) => {
    // Positive control first, so the negative half below cannot pass simply
    // because the app had not reacted yet: with nothing in front, Space really
    // does drive the transport. `body.press` also parks focus off the "Add
    // Text" button the seed left it on — Space there would be a click.
    await page.locator('body').press('Space')
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()
    await page.locator('body').press('Space')
    await expect(page.getByTitle('Play (Space)')).toBeVisible()

    await openExportDialog(page)
    // Focus lands on the dialog's first button when it opens, and Space on a
    // focused button is a click. Move it to the dialog container (tabindex=-1)
    // so Space is nothing but a global shortcut — which is what this asserts
    // the editor no longer answers.
    await page.getByRole('heading', { name: 'Export Video' }).click()

    await page.keyboard.press('Space')

    // Give the app its chance to be wrong before asserting it is not. A
    // `toBeVisible` that already holds resolves on the first poll, so without
    // this the assertion could go green on a slow commit rather than on the
    // gate; two frames is more than the synchronous store write and React
    // commit the control above needed.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )

    // The transport is still paused: the play button has not become a pause
    // button behind the dialog.
    await expect(page.getByTitle('Pause (Space)')).toHaveCount(0)
    await expect(page.getByTitle('Play (Space)')).toBeVisible()
  })
})

test.describe('Keyframe Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    // The keyframe editor button lives in the clip inspector's Animation
    // section, which only renders for a selected clip.
    await seedTextClip(page)
  })

  test('keyframe panel opens', async ({ page }) => {
    const keyframeButton = page.getByRole('button', { name: 'Open Keyframe Editor' })
    await expect(keyframeButton).toBeVisible()
    await keyframeButton.click()

    const panel = keyframePanel(page)
    await expect(panel).toBeVisible()

    // ...and the button now reads "Close" and closes it.
    await expect(page.getByRole('button', { name: 'Close Keyframe Editor' })).toBeVisible()
    await page.getByRole('button', { name: 'Close Keyframe Editor' }).click()
    await expect(panel).toBeHidden()
  })

  test('keyframe creation button exists', async ({ page }) => {
    // There is no separate "add keyframe" button — a keyframe is created by
    // double-clicking a property's row in the graph the Open Keyframe Editor
    // button reveals.
    await page.getByRole('button', { name: 'Open Keyframe Editor' }).click()
    const panel = keyframePanel(page)
    await panel.getByText('Opacity', { exact: true }).click()

    const graph = page.getByRole('listbox', { name: 'Keyframes for Opacity' })
    await expect(graph).toBeVisible()
    // A text clip has no opacity keyframes yet.
    await expect(graph.getByRole('option')).toHaveCount(0)

    // Double-clicking adds one at the pointer, and the store seeds its own
    // at 0s on a property's first keyframe (ESCSUITE-166), so the listbox
    // ends up holding two real options — the same shape
    // `accessibility/core.spec.ts`'s "keyframe graph passes axe-core audit"
    // test pins.
    await graph.dblclick()
    await expect(graph.getByRole('option')).toHaveCount(2)
  })

  test('animation preset selection available', async ({ page }) => {
    // "Animate In" / "Animate Out" are the real preset selects, in the
    // Animation section the keyframe button also lives in. Scoped to the
    // "Animate In" group's own combobox: once a preset is chosen the group
    // also grows a duration slider and an easing select, both labelled
    // "Animate In <something>" via `aria-labelledby`, which would otherwise
    // make the locator ambiguous.
    const animateIn = page
      .locator('[class*="animationGroup"]')
      .filter({ hasText: 'Animate In' })
      .getByRole('combobox')
      .first()
    await expect(animateIn).toBeVisible()
    await expect(animateIn.locator('option', { hasText: 'Fade' })).toHaveCount(1)

    await animateIn.selectOption('fade')
    await expect(animateIn).toHaveValue('fade')
  })
})

test.describe('Overlay Tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    // The overlay-creating buttons live in the inspector's empty state —
    // visible only while no clip is selected.
    await expect(page.getByText('Select a clip to edit')).toBeVisible()
  })

  test('shape tools available', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Rectangle' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ellipse' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Arrow' })).toBeVisible()
  })

  test('text overlay tool works', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Text' }).click()

    // A real clip landed on the timeline, selected, with the text inspector
    // section open in front of it.
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Text Content', exact: true })).toBeVisible()
  })

  test('blur overlay tool exists', async ({ page }) => {
    await page.getByRole('button', { name: 'Blur' }).click()

    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
    // A blur is a shape overlay under the hood — ClipEditorHeader names it by
    // the clip's own name, which `addShapeOverlayClip` sets to "Blur".
    await expect(page.getByRole('heading', { name: 'Blur' })).toBeVisible()
  })

  test("the inspector's Transform section opens for a selected overlay", async ({ page }) => {
    // The selection's transform handles are drawn directly on the preview
    // canvas (`drawSelectionHandles`, `components/Preview/selectionOverlay.ts`),
    // not as DOM elements a locator can see — there is nothing under
    // `[class*="handle"]` for any clip, selected or not. What a locator *can*
    // see, and what this test is actually named for, is the inspector's own
    // Transform section, which opens for exactly the same reason: a clip is
    // selected.
    await page.getByRole('button', { name: 'Rectangle' }).click()
    await expect(page.getByRole('button', { name: 'Transform', exact: true })).toBeVisible()
  })
})

test.describe('Timeline Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  // ESCSUITE-198/201 K-8: this used to be `test.skip` under a stale "skipped
  // in CI due to rendering timing issues" comment — ESCSUITE-177's
  // `waitForAppReady` (React's first commit, not `networkidle`) already
  // fixed the timing hazard the comment blamed. Unskipped, and the real
  // consequence asserted: zoom changing the readout, both directions, not
  // just "one of the two buttons is on screen". The weaker
  // `timeline-editing.spec.ts` sibling this supersedes ("has zoom
  // controls", a bare `count >= 0`) is deleted.
  test('zoom controls work', async ({ page }) => {
    const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' })
    const zoomOut = page.getByRole('button', { name: 'Zoom out timeline' })
    await expect(zoomIn).toBeVisible()
    await expect(zoomOut).toBeVisible()

    const zoomLabel = page.locator('[aria-label^="Zoom level"]')
    await expect(zoomLabel).toHaveAttribute('aria-label', 'Zoom level 100%')

    await zoomIn.click()
    const afterIn = await zoomLabel.getAttribute('aria-label')
    expect(afterIn).not.toBe('Zoom level 100%')

    // Zoom out twice: once to undo the zoom-in above, once more to actually
    // prove the button decreases the level rather than merely "does something".
    await zoomOut.click()
    await zoomOut.click()
    const afterOut = await zoomLabel.getAttribute('aria-label')
    expect(afterOut).not.toBe('Zoom level 100%')
    expect(afterOut).not.toBe(afterIn)
  })

  test('playhead is visible', async ({ page }) => {
    // `data-playhead` is the real attribute `TimelinePlayhead.tsx` renders —
    // the timeline always has a playhead, empty project or not.
    await expect(page.locator('[data-playhead]')).toBeVisible()
  })

  test('time display updates', async ({ page }) => {
    // The preview's own timecode readout (`PreviewTimecode.tsx`), real content
    // and a real consequence of stepping the playhead with the transport.
    const timecode = page.locator('[class*="timecode"]').first()
    await expect(timecode).toHaveText('00:00.000')

    await seedTextClip(page)
    await page.getByTitle('Play (Space)').click()
    await expect(timecode).not.toHaveText('00:00.000', { timeout: 5_000 })
  })
})

test.describe('Waveform Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // A real, decodable audio file — `extractWaveformData` decodes the
    // blob's bytes itself (`app/takeImport.ts`), so seeding a fake/empty
    // blob directly into storage would never produce peaks. A tiny
    // synthesised WAV tone is the cheapest real audio there is.
    await importMediaAndAddToTimeline(page, {
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: makeToneWav(1),
    })
  })

  test('waveform canvas exists', async ({ page }) => {
    await expect(page.locator('canvas[class*="waveform"]')).toBeVisible()
  })

  test('waveform color indicates selection', async ({ page }) => {
    const waveformCanvas = page.locator('canvas[class*="waveform"]')
    await expect(waveformCanvas).toBeVisible()

    // The first non-transparent pixel this canvas drew, sampled from the
    // page: `AudioWaveform.tsx` strokes an unselected clip's peaks in one
    // colour and a selected one's in another (`defaultColor` /
    // `selectedColor`), so a real selection has to change what is on screen.
    const samplePixel = () =>
      page.evaluate(() => {
        const el = document.querySelector('canvas[class*="waveform"]') as HTMLCanvasElement
        const ctx = el.getContext('2d')!
        const { width, height } = el
        const { data } = ctx.getImageData(0, Math.floor(height / 2), width, 1)
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) return [data[i], data[i + 1], data[i + 2], data[i + 3]]
        }
        return null
      })

    const beforeSelection = await samplePixel()
    expect(beforeSelection).not.toBeNull()

    await page.locator('[data-clip-id]').first().click()
    // Polled rather than a fixed sleep: the redraw is synchronous with the
    // store write that flips `isSelected`, but still needs a paint, and a
    // poll only waits as long as that actually takes.
    await expect.poll(samplePixel).not.toEqual(beforeSelection)
    // The poll above is satisfied by `null` too (it is simply "not equal" to
    // the real array `beforeSelection`) — confirm the settled pixel is a
    // real sample, not a transiently empty canvas read.
    expect(await samplePixel()).not.toBeNull()
  })
})

test.describe('Project Session', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('session restore prompt appears when applicable', async ({ page }) => {
    // ESCSUITE-177 review "Races" 3: a one-shot `isVisible()` right after
    // navigation was always racy, and with `waitForAppReady` now resolving
    // at React's first commit instead of `networkidle`, it would reliably
    // observe `false` and the test would pass vacuously no matter what the
    // app does. Made deterministic the way
    // `accessibility/core.spec.ts`'s "session restore prompt passes
    // axe-core audit" does: the prompt is only offered for a session that
    // holds at least one source video (`app/useSessionRestore.ts`), and it
    // is read on mount, so write one straight into the `settings` store the
    // app keeps it in and reload.
    await page.evaluate(async () => {
      const session = {
        project: {
          id: 'seeded',
          name: 'Seeded Session',
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 0,
          created: 0,
          modified: 0,
          timeline: { clips: [], tracks: [], duration: 0 },
        },
        sourceVideos: [
          {
            id: 'video1',
            name: 'video1.mp4',
            duration: 10,
            width: 1280,
            height: 720,
            frameRate: 30,
            mimeType: 'video/mp4',
            size: 1000,
          },
        ],
        currentTime: 0,
        selectedClipId: null,
        zoom: 1,
        timestamp: Date.now(),
      }
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('Failed to open database'))
        request.onsuccess = () => {
          const tx = request.result.transaction('settings', 'readwrite')
          tx.objectStore('settings').put(session, 'current-session')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error('Failed to seed session'))
        }
      })
    })
    await page.reload()
    await waitForAppReady(page, 'artist')

    const restorePrompt = page.getByRole('dialog', { name: 'Resume Previous Session?' })
    await expect(restorePrompt).toBeVisible()
  })

  test('new project can be started', async ({ page }) => {
    await seedTextClip(page)
    await expect(page.getByText(/^1 clip/).first()).toBeVisible()

    // `handleNewProject` only confirms when the timeline holds a clip —
    // which it does here, so accept the native confirm rather than letting
    // Playwright's default auto-dismiss refuse it.
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'File menu' }).click()
    await page.getByText('New Project').click()

    await expect(page.getByText('Select a clip to edit')).toBeVisible()
    await expect(page.getByText(/^0 clips/)).toBeVisible()
  })
})

test.describe('Inspector Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('inspector panel exists', async ({ page }) => {
    await expect(inspector(page)).toBeVisible()
    await expect(page.getByText('Inspector')).toBeVisible()
  })

  test('property controls appear for selected clip', async ({ page }) => {
    // The empty state has no `<input>` at all — five plain buttons.
    await expect(inspector(page).locator('input')).toHaveCount(0)

    await seedTextClip(page)
    // A selected text clip's open inspector carries real inputs (its name,
    // the Transform section's position/scale fields once opened — Text
    // Content's own text field is visible by default).
    await expect(inspector(page).locator('input')).not.toHaveCount(0)
  })
})

test.describe('Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('undo button exists', async ({ page }) => {
    const undoButton = page.getByRole('button', { name: 'Undo (Ctrl+Z)' })
    await expect(undoButton).toBeVisible()
    // Nothing to undo yet.
    await expect(undoButton).toBeDisabled()

    await seedTextClip(page)
    await expect(undoButton).toBeEnabled()
  })

  test('redo button exists', async ({ page }) => {
    const redoButton = page.getByRole('button', { name: 'Redo (Ctrl+Y)' })
    await expect(redoButton).toBeVisible()
    await expect(redoButton).toBeDisabled()

    await seedTextClip(page)
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(page.getByText(/^0 clips/)).toBeVisible()
    await expect(redoButton).toBeEnabled()

    await redoButton.click()
    await expect(page.getByText(/^1 clip/).first()).toBeVisible()
  })

  test('split clip tool exists', async ({ page }) => {
    // The Razor tool is ARTIST's split control — its title names what it
    // does, and selecting it is a real, observable state change: the active
    // tool flips from Selection to Razor (`Toolbar.tsx`'s `styles.active`).
    const razor = page.getByRole('button', { name: /Razor Tool.*split/ })
    const selection = page.getByRole('button', { name: 'Selection Tool (V)' })
    await expect(razor).toBeVisible()
    await expect(selection).toHaveClass(/active/)

    await razor.click()
    await expect(razor).toHaveClass(/active/)
    await expect(selection).not.toHaveClass(/active/)
  })

  test('delete tool exists', async ({ page }) => {
    // Delete only appears once more than one clip is multi-selected
    // (`Toolbar.tsx`), which needs two clips: seed one, deselect, seed a
    // second (a new, empty track — `findEmptyTrack` skips the occupied
    // one), then Ctrl+click both to build the multi-selection.
    await seedTextClip(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Add Text' }).click()
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()

    const clips = page.locator('[data-clip-id]')
    await clips.nth(0).click({ modifiers: ['Control'] })
    await clips.nth(1).click({ modifiers: ['Control'] })

    const deleteButton = page.getByRole('button', { name: 'Delete selected clips (Delete)' })
    await expect(deleteButton).toBeVisible()

    await deleteButton.click()
    await expect(page.getByText(/^0 clips/)).toBeVisible()
  })
})
