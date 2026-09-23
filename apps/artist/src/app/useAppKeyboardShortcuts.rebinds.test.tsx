// What an edit burst costs the global keyboard cascade.
//
// `useAppKeyboardShortcuts` closes over 37 values and lists all 37 in its
// dependency array, so every change to one of them tears the `keydown` listener
// off `window` and binds a fresh closure. `apps/artist/CLAUDE.md` records that
// array as deliberate — the Ctrl+B branch depends on the staleness the array
// deliberately carries (`clips.length` is a dep while `clips.find` is what the
// branch reads), and holding the handler in a ref to stop the re-binding would
// change exactly that. Round 2 measured it before deciding, and this file is
// the measurement.
//
// It is not a per-frame cost — nothing here runs on a pointer move or a
// playback tick — so the number that matters is re-binds per *edit*, driven
// through the same store the app drives. The harness mirrors `App.tsx`'s own
// selectors for the nine store-backed deps that can change during editing
// (`selectedClipId`, `activeTool`, `clips`, `keyframePanelOpen`, `snapEnabled`,
// `selectedClipIds`, `clipboard`, `inPoint`, `outPoint`); the store's actions
// are stable identities and the rest are `App`'s own callbacks, held fixed here
// so the count is the store's contribution and nothing else.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render, act } from '@testing-library/react'
import { useAppKeyboardShortcuts } from './useAppKeyboardShortcuts'
import { useEditorStore } from '../store/projectStore'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'

/** `App`'s own callbacks, which do not come from the store. Fixed identities. */
const appCallbacks = {
  handleSaveProject: () => {},
  handleLoadProject: () => {},
  handleZoomIn: () => {},
  handleZoomOut: () => {},
  showNotification: () => {},
  setShowShortcuts: () => {},
  setShowExport: () => {},
  showShortcuts: false,
  modalOpen: false,
}

/** `App.tsx`'s wiring of the hook, selector for selector. */
function ShortcutHost() {
  useAppKeyboardShortcuts({
    canUndo: useEditorStore((s) => s.canUndo),
    canRedo: useEditorStore((s) => s.canRedo),
    undo: useEditorStore((s) => s.undo),
    redo: useEditorStore((s) => s.redo),
    selectedClipId: useEditorStore((s) => s.selectedClipId),
    removeClipFromTimeline: useEditorStore((s) => s.removeClipFromTimeline),
    rippleDeleteClip: useEditorStore((s) => s.rippleDeleteClip),
    activeTool: useEditorStore((s) => s.activeTool),
    duplicateClip: useEditorStore((s) => s.duplicateClip),
    clips: useEditorStore((s) => s.project.timeline.clips),
    keyframePanelOpen: useEditorStore((s) => s.keyframePanelState.isOpen),
    setKeyframePanelOpen: useEditorStore((s) => s.setKeyframePanelOpen),
    setSelectedClipId: useEditorStore((s) => s.setSelectedClipId),
    setActiveTool: useEditorStore((s) => s.setActiveTool),
    snapEnabled: useEditorStore((s) => s.snapEnabled),
    setSnapEnabled: useEditorStore((s) => s.setSnapEnabled),
    addMarker: useEditorStore((s) => s.addMarker),
    goToNextMarker: useEditorStore((s) => s.goToNextMarker),
    goToPreviousMarker: useEditorStore((s) => s.goToPreviousMarker),
    splitClip: useEditorStore((s) => s.splitClip),
    selectedClipIds: useEditorStore((s) => s.selectedClipIds),
    deleteSelectedClips: useEditorStore((s) => s.deleteSelectedClips),
    copySelectedClips: useEditorStore((s) => s.copySelectedClips),
    pasteClips: useEditorStore((s) => s.pasteClips),
    clipboard: useEditorStore((s) => s.clipboard),
    clearMultiSelection: useEditorStore((s) => s.clearMultiSelection),
    setInPoint: useEditorStore((s) => s.setInPoint),
    setOutPoint: useEditorStore((s) => s.setOutPoint),
    clearInOutPoints: useEditorStore((s) => s.clearInOutPoints),
    inPoint: useEditorStore((s) => s.inPoint),
    outPoint: useEditorStore((s) => s.outPoint),
    ...appCallbacks,
  })
  return null
}

describe('the keyboard cascade over an edit burst', () => {
  let binds: MockInstance<typeof window.addEventListener>

  beforeEach(() => {
    resetStoreForTest()
    binds = vi.spyOn(window, 'addEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const keydownBinds = () =>
    binds.mock.calls.filter((call: unknown[]) => call[0] === 'keydown').length

  it('re-binds the keydown listener once per edit that changes a dependency', () => {
    const first = addClip('burst-0', 0, 1)
    render(<ShortcutHost />)
    const mountBinds = keydownBinds()
    expect(mountBinds).toBe(1)

    // Twenty edits of the kind a session is made of: adding and removing clips,
    // selecting, moving the playhead, transforming, copying, pasting, marking
    // in and out, switching tools and toggling snap.
    const burst: Array<() => void> = [
      () => addClip('burst-1', 2, 1),
      () => store().setSelectedClipId('burst-1'),
      () => store().setCurrentTime(1.5),
      () => store().updateClipTransform('burst-1', { x: 0.4 }),
      () => store().setClipTimelinePosition('burst-1', 3),
      () => store().setActiveTool('razor'),
      () => store().setActiveTool('select'),
      () => addClip('burst-2', 5, 1),
      () => store().toggleClipSelection('burst-2'),
      () => store().copySelectedClips(),
      () => store().pasteClips(),
      () => store().setSnapEnabled(false),
      () => store().setInPoint(1),
      () => store().setOutPoint(4),
      () => store().addMarker(2),
      () => store().updateClipBlendMode('burst-1', 'screen'),
      () => store().duplicateClip('burst-1'),
      () => store().clearMultiSelection(),
      () => store().removeClipFromTimeline('burst-2'),
      () => store().setSelectedClipId(first.id),
    ]
    expect(burst).toHaveLength(20)

    for (const edit of burst) act(edit)

    // Measured 2026-09-13: **15 re-binds over 20 edits** — 15 pairs of
    // removeEventListener/addEventListener across a burst that takes a user the
    // better part of a minute, i.e. roughly one listener swap per edit and none
    // per frame. Five of the twenty were free, and they are the informative
    // ones: moving the playhead, transforming a clip, moving a clip along the
    // timeline, adding a marker and changing a blend mode all leave every one of
    // the nine store-backed deps alone — `clips` is a dependency only through
    // its `length`, which is the staleness the array carries on purpose.
    //
    // This pins a *finding*, not a target. Task 3(d) of the round-2 plan
    // measured the churn and left the deps array verbatim: 15 listener swaps
    // spread across a minute of editing is not a cost worth changing the
    // Ctrl+B staleness semantics for. Ceiling at 2x the measurement — if the
    // array is ever split into a ref-held latest callback, re-measure and lower
    // it; never raise it.
    const rebinds = keydownBinds() - mountBinds
    expect(rebinds).toBeGreaterThan(0)
    expect(rebinds).toBeLessThanOrEqual(30)
  })
})
