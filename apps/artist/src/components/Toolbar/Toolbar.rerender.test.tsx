// What a playback tick costs the toolbar.
//
// The preview writes `currentTime` to the store roughly every 200 ms while the
// project plays. `Toolbar` renders ~30 buttons and their inline SVGs and shows
// the playhead nowhere — it only *reads* the playhead inside three handlers
// (add marker, set in point, set out point). A `useEditorStore((s) => s.currentTime)`
// selector here therefore re-rendered the whole toolbar five times a second for a
// value no element on screen depends on; the post-round-1 CPU profile ranked
// `Toolbar` #6 of the app-code frames a playback window executes (76.8 ms,
// 14.8% — docs/performance/2026-09-12-profile.md, "After round 1"). The three
// handlers read `useEditorStore.getState().currentTime` instead, which is the
// contract `apps/artist/CLAUDE.md` already records for `App.tsx`.
//
// How the count is taken: the same pass-through `vi.spyOn` shape as
// `App.rerender.test.tsx` — no `mockImplementation`, the real component still
// runs — installed on the module namespace *before* the element is created, so
// the element type identity stays stable across renders and every render calls
// the spy exactly once. A React `Profiler` cannot do this job: `onRender` fires
// per commit for a whole subtree, and the point here is one component.
//
// The other half of the contract is that the handlers must still see the LIVE
// playhead. A `getState()` read that went stale would pass a render counter and
// drop markers at the wrong time, so the seek-then-click cases below are part of
// the same test file on purpose.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as toolbarModule from './Toolbar'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'

describe('a playback tick and the toolbar', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Mount the real `Toolbar` through a pass-through spy that counts its renders. */
  function renderCountingToolbar() {
    const renders = vi.spyOn(toolbarModule, 'Toolbar')
    render(<toolbarModule.Toolbar onShowShortcuts={vi.fn()} />)
    return { renders, mountRenders: renders.mock.calls.length }
  }

  it('does not re-render while the playhead moves', () => {
    const { renders, mountRenders } = renderCountingToolbar()

    // One `act` per tick, not one around the loop: the preview writes the
    // playhead once per throttle window, and a loop inside a single `act` would
    // batch ten writes into one commit — a selector would then cost 1 render and
    // slip under the ceiling below.
    for (let i = 1; i <= 10; i++) {
      act(() => {
        store().setCurrentTime(i * 0.2)
      })
    }

    // Measured 2026-09-13: exactly 0. The ceiling matches
    // `App.rerender.test.tsx`'s, so a re-introduced selector (10 renders) fails.
    expect(renders.mock.calls.length - mountRenders).toBeLessThanOrEqual(1)
  })

  it('still re-renders when something it reads changes', () => {
    const { renders, mountRenders } = renderCountingToolbar()

    act(() => {
      store().setActiveTool('razor')
    })

    expect(renders.mock.calls.length - mountRenders).toBe(1)
  })

  it('adds the marker at the playhead it never rendered', async () => {
    const user = userEvent.setup()
    const { renders, mountRenders } = renderCountingToolbar()

    act(() => {
      store().setCurrentTime(7.25)
    })
    expect(renders.mock.calls.length - mountRenders).toBe(0)

    await user.click(screen.getByTitle(/Add Marker at Playhead/))

    expect(store().markers.map((m) => m.time)).toEqual([7.25])
  })

  it('sets the in and out points at the playhead it never rendered', async () => {
    const user = userEvent.setup()
    renderCountingToolbar()

    act(() => {
      store().setCurrentTime(3)
    })
    await user.click(screen.getByTitle(/Set in point/))

    act(() => {
      store().setCurrentTime(9)
    })
    await user.click(screen.getByTitle(/Set out point/))

    expect(store().inPoint).toBe(3)
    expect(store().outPoint).toBe(9)
  })

  it('clears the points when a handler is clicked again at the same unrendered playhead', async () => {
    const user = userEvent.setup()
    renderCountingToolbar()

    act(() => {
      store().setCurrentTime(4.5)
    })
    await user.click(screen.getByTitle(/Set in point/))
    await user.click(screen.getByTitle(/Set in point/))

    expect(store().inPoint).toBeNull()
    expect(store().outPoint).toBeNull()
  })
})
