// What a playback tick costs the clip inspector.
//
// The preview writes `currentTime` to the store roughly every 200 ms while the
// project plays. `ClipEditor` draws the whole right-hand panel — header,
// transform, blend, effects, animation, transition and actions, a few hundred
// elements between them — and the only thing on it the playhead can change is
// whether one button is disabled. A `useEditorStore((s) => s.currentTime)`
// selector in `useClipEditorActions` therefore re-rendered the entire panel
// five times a second, and it did so *before* `ClipEditor`'s `!selectedClip`
// early return, so it cost the same with nothing selected at all. The
// post-round-1 CPU profile ranked `ClipEditor` #10 of the app-code frames a
// playback window executes (23.1 ms, 4.4% —
// docs/performance/2026-09-12-profile.md, "After round 1").
//
// The fix is the `TimelinePlayhead` / `PreviewTimecode` shape rather than
// `Toolbar`'s: the disabled state *is* rendered, so a `getState()` read would
// go stale. `SplitButton` subscribes for itself, to the derived boolean and not
// to the playhead, so the one element that depends on the playhead re-renders
// when the answer changes — twice over a pass across a clip — instead of on
// every tick. `handleSplitAtPlayhead` reads `getState()` because a click is not
// a render.
//
// How the count is taken: the same pass-through `vi.spyOn` shape as
// `App.rerender.test.tsx` and `Toolbar.rerender.test.tsx` — no
// `mockImplementation`, the real components still run, and the spy is installed
// on the module namespace *before* the element is created so the element type
// identity stays stable across renders and every render calls the spy exactly
// once. A React `Profiler` cannot do this job: `onRender` fires per commit for
// a whole subtree, and the point here is one component.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as clipEditorModule from './ClipEditor'
import * as splitButtonModule from './SplitButton'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'

/** A two-second clip at the timeline origin, selected. */
function selectTwoSecondClip() {
  const clip = addClip('clip1', 0, 2)
  store().setSelectedClipId(clip.id)
  return clip
}

/** Mount the real `ClipEditor` through pass-through spies that count renders. */
function renderCountingEditor() {
  const panelRenders = vi.spyOn(clipEditorModule, 'ClipEditor')
  const splitRenders = vi.spyOn(splitButtonModule, 'SplitButton')
  render(<clipEditorModule.ClipEditor />)
  return {
    panelRenders,
    splitRenders,
    mountPanel: panelRenders.mock.calls.length,
    mountSplit: splitRenders.mock.calls.length,
  }
}

/**
 * Ten playback ticks, one `act` each.
 *
 * One `act` per tick and not one around the loop: the preview writes the
 * playhead once per throttle window, and a loop inside a single `act` would
 * batch ten writes into one commit — a selector would then cost 1 render and
 * slip under the ceilings below.
 */
function tick(times: number[]) {
  for (const t of times) {
    act(() => {
      store().setCurrentTime(t)
    })
  }
}

const TICKS_ACROSS_THE_CLIP = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]

describe('a playback tick and the clip inspector', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not re-render the panel while the playhead crosses the selected clip', () => {
    selectTwoSecondClip()
    const { panelRenders, mountPanel } = renderCountingEditor()

    tick(TICKS_ACROSS_THE_CLIP)

    // Measured 2026-09-13: exactly 0. The ceiling matches
    // `App.rerender.test.tsx`'s, so a re-introduced selector (10 renders) fails.
    expect(panelRenders.mock.calls.length - mountPanel).toBeLessThanOrEqual(1)
  })

  it('does not re-render the empty panel either, with nothing selected', () => {
    const { panelRenders, mountPanel } = renderCountingEditor()
    expect(screen.getByText('Select a clip to edit')).toBeInTheDocument()

    tick(TICKS_ACROSS_THE_CLIP)

    // The hook ran above `ClipEditor`'s `!selectedClip` early return, so the
    // empty panel paid the same ten renders. It pays none now.
    expect(panelRenders.mock.calls.length - mountPanel).toBeLessThanOrEqual(1)
  })

  it('re-renders only the split button, and only when its answer changes', () => {
    selectTwoSecondClip()
    const { splitRenders, mountSplit } = renderCountingEditor()

    tick(TICKS_ACROSS_THE_CLIP)

    // Ten ticks, two answers: the playhead starts on the clip's first frame
    // (split disabled), moves into it at 0.2 s (enabled), and leaves it at
    // 2.0 s (disabled again). Measured 2026-09-13: exactly 2. Ceiling at 2x.
    expect(splitRenders.mock.calls.length - mountSplit).toBeLessThanOrEqual(4)
  })

  it('still re-renders the panel when something it reads changes', () => {
    const clip = selectTwoSecondClip()
    const { panelRenders, mountPanel } = renderCountingEditor()

    act(() => {
      store().updateClip(clip.id, { name: 'renamed' })
    })

    expect(panelRenders.mock.calls.length - mountPanel).toBe(1)
  })

  it('splits at the playhead the panel never rendered', async () => {
    const user = userEvent.setup()
    const clip = selectTwoSecondClip()
    const { panelRenders, mountPanel } = renderCountingEditor()

    act(() => {
      store().setCurrentTime(0.75)
    })
    expect(panelRenders.mock.calls.length - mountPanel).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Split' }))

    const halves = store().project.timeline.clips.filter((c) => c.trackId === clip.trackId)
    expect(halves).toHaveLength(2)
    expect(halves.map((c) => c.duration).sort()).toEqual([0.75, 1.25])
  })

  it('disables the split button as the playhead leaves the clip', () => {
    selectTwoSecondClip()
    renderCountingEditor()

    act(() => {
      store().setCurrentTime(0.75)
    })
    expect(screen.getByRole('button', { name: 'Split' })).toBeEnabled()

    act(() => {
      store().setCurrentTime(5)
    })
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
  })
})
