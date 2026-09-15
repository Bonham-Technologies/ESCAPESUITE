// The keyframe graph's keyboard surface.
//
// Separate from KeyframeGraph.test.tsx, which covers the pointer: this file is
// about the <svg> being a real listbox — focusable, named, with named options —
// and about the propagation contract that keeps the graph's own keys away from
// the editor's window-level shortcut cascades (app/useAppKeyboardShortcuts.ts
// and components/Preview/PlaybackControls.tsx both listen on `window`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyframeGraph } from './KeyframeGraph'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { AnimatableProperty, Clip, ClipAnimation } from '../../store/types'
import styles from './KeyframeGraph.module.css'

const CLIP_DURATION = 4.3
// Same geometry as KeyframeGraph.test.tsx: a 500x200 box over a 500x200 viewBox
// makes screen px equal viewBox px, and a 4.3s clip puts one second every 100px.
const xForTime = (t: number) => 50 + 100 * t
const yForUnitValue = (v: number) => 20 + (1 - v) * 150

function measureGraph(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg')!
  const rect = { left: 0, top: 0, width: 500, height: 200 }
  svg.getBoundingClientRect = () =>
    ({ ...rect, right: rect.width, bottom: rect.height, x: 0, y: 0 }) as DOMRect
  return svg
}

function currentClip(): Clip {
  return store().project.timeline.clips[0]
}

function renderGraph(
  property: AnimatableProperty,
  options: {
    playheadTime?: number
    animation?: ClipAnimation | undefined
    withDelete?: boolean
    withEasing?: boolean
  } = {}
) {
  const onKeyframeMoved = vi.fn()
  const onKeyframeValueChanged = vi.fn()
  const onAddKeyframe = vi.fn()
  const onDeleteKeyframe = vi.fn()
  const onKeyframeEasingChanged = vi.fn()
  const element = (clip: Clip) => (
    <KeyframeGraph
      property={property}
      clipDuration={clip.duration}
      animation={'animation' in options ? options.animation : clip.animation}
      transform={clip.transform}
      effects={clip.effects}
      playheadTime={options.playheadTime ?? 0}
      onKeyframeMoved={onKeyframeMoved}
      onKeyframeValueChanged={onKeyframeValueChanged}
      onAddKeyframe={onAddKeyframe}
      onDeleteKeyframe={options.withDelete === false ? undefined : onDeleteKeyframe}
      onKeyframeEasingChanged={options.withEasing === false ? undefined : onKeyframeEasingChanged}
    />
  )
  const view = render(element(currentClip()))
  return {
    ...view,
    /** Re-render against the clip as the store now holds it, the way the panel does. */
    refresh: () => view.rerender(element(currentClip())),
    onKeyframeMoved,
    onKeyframeValueChanged,
    onAddKeyframe,
    onDeleteKeyframe,
    onKeyframeEasingChanged,
  }
}

const points = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGCircleElement>('circle'))

const graphSvg = (container: HTMLElement) => container.querySelector('svg')!

/** An opacity curve with a user keyframe at 1s; the store adds one at 0s. */
function opacityKeyframes() {
  store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
}

/** A one-second fade in (two preset handles) plus the user's own keyframe at 2s. */
const fadeInAndCustom: ClipAnimation = {
  in: { type: 'fade', duration: 1, easing: 'ease-out' },
  out: { type: 'none', duration: 0, easing: 'linear' },
  keyframes: { opacity: [{ time: 2, value: 0.5, easing: 'linear' }] },
}

describe('KeyframeGraph keyboard access', () => {
  // Stands in for the editor's own window-level keydown listeners: anything this
  // spy sees with the graph focused is a key the graph failed to claim.
  let seen: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>

  beforeEach(() => {
    resetStoreForTest()
    addClip('clip1', 0, CLIP_DURATION)
    seen = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', seen)
  })

  afterEach(() => {
    window.removeEventListener('keydown', seen)
  })

  it("does not let Delete reach the editor's global shortcuts", async () => {
    const user = userEvent.setup()
    opacityKeyframes()
    const { container, onDeleteKeyframe } = renderGraph('opacity')

    graphSvg(container).focus()
    fireEvent.click(points(container)[1])
    await user.keyboard('{Delete}')

    expect(onDeleteKeyframe).toHaveBeenCalledWith('opacity', 1)
    // The bug this pins: the editor's cascade also deletes the whole clip.
    expect(seen).not.toHaveBeenCalled()
  })

  it('lets Delete through to the editor when nothing is active', async () => {
    const user = userEvent.setup()
    opacityKeyframes()
    const { container, onDeleteKeyframe } = renderGraph('opacity')

    graphSvg(container).focus()
    await user.keyboard('{Delete}')

    // Deliberate: a focused graph with no active option does not swallow the
    // editor's "delete the selected clip" shortcut.
    expect(onDeleteKeyframe).not.toHaveBeenCalled()
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('lets Delete through when the active keyframe is no longer on the graph', async () => {
    const user = userEvent.setup()
    opacityKeyframes()
    const { container, onDeleteKeyframe, refresh } = renderGraph('opacity')
    const svg = graphSvg(container)
    svg.focus()

    fireEvent.click(points(container)[1])
    expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-1')

    // The keyframe goes away behind the graph's back — an undo, a right-click
    // delete, or the store being edited from anywhere else. The remembered
    // active *time* still points at 1s, but nothing on the graph is rendered
    // active any more, and the two must not disagree.
    store().removeClipKeyframe('clip1', 'opacity', 1)
    refresh()
    expect(svg.getAttribute('aria-activedescendant')).toBeNull()

    await user.keyboard('{Delete}')

    // Nothing to delete and nothing announced as selected, so the key is not
    // the graph's: it falls through to the editor rather than being swallowed
    // into doing nothing at all.
    expect(onDeleteKeyframe).not.toHaveBeenCalled()
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('lets Escape through when the active keyframe is no longer on the graph', async () => {
    const user = userEvent.setup()
    opacityKeyframes()
    const { container, refresh } = renderGraph('opacity')
    const svg = graphSvg(container)
    svg.focus()

    fireEvent.click(points(container)[1])
    store().removeClipKeyframe('clip1', 'opacity', 1)
    refresh()

    await user.keyboard('{Escape}')

    // Same rule as Delete: with no rendered active option there is nothing for
    // Escape to clear, so the editor's own deselect still runs.
    expect(seen.mock.calls.map(([e]) => e.key)).toEqual(['Escape'])
  })

  it('swallows Delete on an active preset rather than deleting the clip', async () => {
    const user = userEvent.setup()
    const { container, onDeleteKeyframe } = renderGraph('opacity', { animation: fadeInAndCustom })
    const svg = graphSvg(container)
    svg.focus()

    fireEvent.keyDown(svg, { key: 'Home' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Delete}')

    // A preset is not deletable, but it *is* the active option and announced as
    // selected — letting Delete fall through from here would delete the whole
    // clip, which is ESCSUITE-49 two keystrokes away.
    expect(onDeleteKeyframe).not.toHaveBeenCalled()
    expect(seen).not.toHaveBeenCalled()
    expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-0')
  })

  it('drops the selection when a preset is clicked after a custom keyframe', async () => {
    const user = userEvent.setup()
    const { container, onDeleteKeyframe } = renderGraph('opacity', { animation: fadeInAndCustom })
    const svg = graphSvg(container)

    // The user's own keyframe at 2s, then one of the fade-in presets.
    fireEvent.click(points(container)[2])
    expect(screen.getByLabelText('Keyframe easing')).toBeInTheDocument()
    fireEvent.click(points(container)[0])

    // A preset is never selectable, so clicking one has to clear the selection
    // the way the arrow keys do — otherwise the keys act on a keyframe that is
    // not the one the graph draws as active.
    expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-0')
    expect(screen.queryByLabelText('Keyframe easing')).not.toBeInTheDocument()

    await user.keyboard('{Delete}')

    expect(onDeleteKeyframe).not.toHaveBeenCalled()
    expect(seen).not.toHaveBeenCalled()
  })

  it('puts the graph in the tab order and names it for the property', async () => {
    const user = userEvent.setup()
    opacityKeyframes()
    const { container } = renderGraph('opacity')

    await user.tab()

    expect(document.activeElement).toBe(graphSvg(container))
    expect(screen.getByRole('listbox', { name: /opacity/i })).toBe(graphSvg(container))
  })

  it('names every keyframe handle with its time, value and easing', () => {
    opacityKeyframes()
    renderGraph('opacity')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    // The store's auto-created start keyframe, then the user's own.
    expect(screen.getByRole('option', { name: /100% at 0\.00 s, Ease Out/ })).toBe(options[0])
    expect(screen.getByRole('option', { name: /50% at 1\.00 s, Linear/ })).toBe(options[1])
  })

  describe('walking the keyframes', () => {
    const activeDescendant = (container: HTMLElement) =>
      graphSvg(container).getAttribute('aria-activedescendant')

    it('moves the active option with the arrow keys, without wrapping', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)

      expect(activeDescendant(container)).toBeNull()

      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      expect(activeDescendant(container)).toBe('kf-opacity-0')
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      expect(activeDescendant(container)).toBe('kf-opacity-1')
      // The last keyframe is the end of the line.
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      expect(activeDescendant(container)).toBe('kf-opacity-1')

      fireEvent.keyDown(svg, { key: 'ArrowLeft' })
      expect(activeDescendant(container)).toBe('kf-opacity-0')
      fireEvent.keyDown(svg, { key: 'ArrowLeft' })
      expect(activeDescendant(container)).toBe('kf-opacity-0')
    })

    it('marks the active option selected for assistive technology', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')

      fireEvent.keyDown(graphSvg(container), { key: 'End' })

      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-selected', 'false')
      expect(options[1]).toHaveAttribute('aria-selected', 'true')
    })

    it('jumps to the last keyframe on End and the first on Home', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'End' })
      expect(activeDescendant(container)).toBe('kf-opacity-1')
      fireEvent.keyDown(svg, { key: 'Home' })
      expect(activeDescendant(container)).toBe('kf-opacity-0')
    })

    it('has nothing to move to on a graph with no keyframes', () => {
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      fireEvent.keyDown(svg, { key: 'End' })

      expect(activeDescendant(container)).toBeNull()
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })

    it('selects a custom keyframe it lands on and drops the selection on a preset', () => {
      // A one-second fade in (two preset keyframes) plus the user's own at 2s.
      const { container } = renderGraph('opacity', { animation: fadeInAndCustom })
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'End' })
      expect(activeDescendant(container)).toBe('kf-opacity-2')
      expect(points(container)[2]).toHaveClass(styles.selected)
      expect(screen.getByLabelText('Keyframe easing')).toBeInTheDocument()

      fireEvent.keyDown(svg, { key: 'Home' })
      expect(activeDescendant(container)).toBe('kf-opacity-0')
      // A preset is visitable but never selectable, so the selection is dropped.
      expect(points(container)[0]).not.toHaveClass(styles.selected)
      expect(points(container)[0]).toHaveClass(styles.active)
      expect(screen.queryByLabelText('Keyframe easing')).toBeNull()
      // Both fade-in handles are presets; the user's own keyframe is not.
      expect(screen.getAllByRole('option', { name: /preset, not editable/ })).toEqual([
        points(container)[0],
        points(container)[1],
      ])
    })

    it('claims ArrowUp, ArrowDown and Enter while it is focused', async () => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container, onAddKeyframe, onKeyframeValueChanged } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()

      // Twice: onto the user's own 0.5 keyframe at 1s rather than the store's
      // auto-created one at 0s, which sits at opacity 1 and so has nowhere to
      // go up — a clamped nudge is a no-op and would not call back at all.
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      await user.keyboard('{ArrowUp}{ArrowDown}{Enter}')

      // All three act on the graph — and none of them reaches the editor's
      // window-level cascades on the way.
      expect(seen).not.toHaveBeenCalled()
      expect(onKeyframeValueChanged).toHaveBeenCalledTimes(2)
      expect(onAddKeyframe).toHaveBeenCalledTimes(1)
    })

    it('clears the selection on Escape', async () => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'End' })
      expect(screen.getByLabelText('Keyframe easing')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(activeDescendant(container)).toBeNull()
      expect(screen.queryByLabelText('Keyframe easing')).toBeNull()
      expect(seen).not.toHaveBeenCalled()
    })

    it('lets Escape through when there is no selection to clear', async () => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      graphSvg(container).focus()

      await user.keyboard('{Escape}')

      expect(seen).toHaveBeenCalledTimes(1)
    })

    it('takes focus when a keyframe is clicked, so click-then-Delete works', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])

      expect(document.activeElement).toBe(graphSvg(container))
      expect(activeDescendant(container)).toBe('kf-opacity-1')
    })

    it('keeps the dragged keyframe active after a drag that changes its time', () => {
      // Three handles: the store's auto-created one at 0s and the user's at 1s and 2s.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.25, easing: 'linear' })
      const { container, onKeyframeMoved, refresh } = renderGraph('opacity')
      const svg = measureGraph(container)

      // Alt-drag moves time only, so nothing else commits.
      fireEvent.mouseDown(points(container)[1], { altKey: true })
      fireEvent.mouseMove(window, { clientX: xForTime(1.5), clientY: yForUnitValue(0.5) })
      fireEvent.mouseUp(window)

      // The host commits the move and the graph re-renders, exactly as KeyframePanel does.
      const newTime = onKeyframeMoved.mock.calls[0][2] as number
      store().moveClipKeyframe('clip1', 'opacity', 1, newTime)
      refresh()

      // The moved keyframe is still the active option — it has not silently
      // become "nothing active" just because its time changed.
      expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-1')
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

      // ...so the next arrow continues from it instead of jumping back to the first.
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-2')
    })

    it('takes focus when a drag starts, and drops the active option on a background click', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')

      fireEvent.mouseDown(points(container)[1])
      expect(document.activeElement).toBe(graphSvg(container))
      expect(activeDescendant(container)).toBe('kf-opacity-1')
      fireEvent.mouseUp(window)

      fireEvent.click(graphSvg(container))
      expect(activeDescendant(container)).toBeNull()
    })
  })

  describe('nudging a keyframe', () => {
    const activeDescendant = (container: HTMLElement) =>
      graphSvg(container).getAttribute('aria-activedescendant')

    /** Focus the graph and make the user's 1s keyframe (index 1) the active option. */
    function selectCustomKeyframe(container: HTMLElement): SVGSVGElement {
      const svg = graphSvg(container)
      svg.focus()
      fireEvent.keyDown(svg, { key: 'End' })
      return svg
    }

    it('nudges the value up and down by a fine step', () => {
      opacityKeyframes()
      const { container, onKeyframeValueChanged } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      fireEvent.keyDown(svg, { key: 'ArrowUp' })
      expect(onKeyframeValueChanged.mock.calls[0][0]).toBe('opacity')
      expect(onKeyframeValueChanged.mock.calls[0][1]).toBe(1)
      expect(onKeyframeValueChanged.mock.calls[0][2]).toBeCloseTo(0.51, 6)

      fireEvent.keyDown(svg, { key: 'ArrowDown' })
      expect(onKeyframeValueChanged.mock.calls[1][2]).toBeCloseTo(0.49, 6)
    })

    it('nudges the value by a coarse step with Shift held', () => {
      opacityKeyframes()
      const { container, onKeyframeValueChanged } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      fireEvent.keyDown(svg, { key: 'ArrowUp', shiftKey: true })
      expect(onKeyframeValueChanged.mock.calls[0][2]).toBeCloseTo(0.6, 6)

      fireEvent.keyDown(svg, { key: 'ArrowDown', shiftKey: true })
      expect(onKeyframeValueChanged.mock.calls[1][2]).toBeCloseTo(0.4, 6)
    })

    it('clamps the nudged value to the property range', () => {
      // Half a fine step inside each end of the range, so an unclamped nudge
      // would overshoot to 1.005 and to -0.005: the clamp is what the call
      // proves, not the fact that a call happened.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.005, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 0, value: 0.995, easing: 'linear' })
      const { container, onKeyframeValueChanged } = renderGraph('opacity')
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'Home' })
      fireEvent.keyDown(svg, { key: 'ArrowUp' })
      // The trailing `false` is the skipHistory flag, always passed: see
      // "passes the keydown's repeat flag through" below.
      expect(onKeyframeValueChanged).toHaveBeenCalledWith('opacity', 0, 1, false)

      fireEvent.keyDown(svg, { key: 'End' })
      fireEvent.keyDown(svg, { key: 'ArrowDown' })
      expect(onKeyframeValueChanged).toHaveBeenLastCalledWith('opacity', 1, 0, false)
    })

    // A held arrow key must be ONE undo step, not one per auto-repeat. The hook
    // does not track the run itself: it hands the keydown's own `repeat` flag
    // to the host as `skipHistory`, so the first press snapshots and every
    // repeat after it edits in place. The flag is passed on every nudge —
    // `false` on a first press rather than omitted — so the callback's arity
    // never depends on how the key was pressed and the host has one signature
    // to implement.
    it('passes the keydown repeat flag through as the value nudge skipHistory', () => {
      opacityKeyframes()
      const { container, onKeyframeValueChanged } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      fireEvent.keyDown(svg, { key: 'ArrowUp' })
      expect(onKeyframeValueChanged).toHaveBeenLastCalledWith(
        'opacity', 1, expect.closeTo(0.51, 6), false
      )

      // The host has committed nothing, so the keyframe is still at 0.5 and the
      // repeat computes the same value — only the flag differs.
      fireEvent.keyDown(svg, { key: 'ArrowUp', repeat: true })
      expect(onKeyframeValueChanged).toHaveBeenLastCalledWith(
        'opacity', 1, expect.closeTo(0.51, 6), true
      )
      expect(onKeyframeValueChanged).toHaveBeenCalledTimes(2)
    })

    it('writes nothing when a value nudge lands on the value the keyframe already has', async () => {
      const user = userEvent.setup()
      // One fine step above the floor of the range.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.01, easing: 'linear' })
      const { container, onKeyframeValueChanged, refresh } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      // One real nudge onto the floor, committed the way KeyframePanel does.
      fireEvent.keyDown(svg, { key: 'ArrowDown' })
      const first = onKeyframeValueChanged.mock.calls[0]
      store().setClipKeyframe('clip1', 'opacity', {
        time: first[1] as number,
        value: first[2] as number,
        easing: 'linear',
      })
      refresh()
      expect(screen.getByRole('status')).toHaveTextContent('Opacity 0% at 1.00 seconds')

      await user.keyboard('{ArrowDown}')

      // The clamp puts the nudge back on the value it started from, and a write
      // that changes nothing is not an edit: no store call, so no undo entry
      // that undoes nothing, and the live region is left exactly as it was.
      expect(onKeyframeValueChanged).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('status')).toHaveTextContent('Opacity 0% at 1.00 seconds')
      // Still swallowed, though — the key is the graph's either way.
      expect(seen).not.toHaveBeenCalled()
    })

    it('swallows the value nudge on a preset without changing anything', async () => {
      const user = userEvent.setup()
      const { container, onKeyframeValueChanged } = renderGraph('opacity', {
        animation: fadeInAndCustom,
      })
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'Home' })
      await user.keyboard('{ArrowUp}')

      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
      expect(seen).not.toHaveBeenCalled()
    })

    it('swallows the value nudge on a graph with no keyframes', async () => {
      const user = userEvent.setup()
      const { container, onKeyframeValueChanged } = renderGraph('opacity')
      graphSvg(container).focus()

      await user.keyboard('{ArrowUp}{ArrowDown}')

      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
      expect(seen).not.toHaveBeenCalled()
    })

    it('nudges the time with Alt, fine and coarse', () => {
      opacityKeyframes()
      const { container, onKeyframeMoved, refresh } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      /** One nudge, committed by the host and re-rendered the way KeyframePanel does. */
      const nudge = (init: { key: string; shiftKey?: boolean }): number => {
        fireEvent.keyDown(svg, { ...init, altKey: true })
        const call = onKeyframeMoved.mock.calls[onKeyframeMoved.mock.calls.length - 1]
        expect(call[0]).toBe('opacity')
        store().moveClipKeyframe('clip1', 'opacity', call[1] as number, call[2] as number)
        refresh()
        return call[2] as number
      }

      expect(nudge({ key: 'ArrowRight' })).toBeCloseTo(1.01, 6)
      expect(nudge({ key: 'ArrowLeft' })).toBeCloseTo(1, 6)
      expect(nudge({ key: 'ArrowRight', shiftKey: true })).toBeCloseTo(1.1, 6)
      expect(nudge({ key: 'ArrowLeft', shiftKey: true })).toBeCloseTo(1, 6)
      expect(onKeyframeMoved).toHaveBeenCalledTimes(4)
    })

    // The time nudge's half of the held-key contract; see the value nudge's.
    it('passes the keydown repeat flag through as the time nudge skipHistory', () => {
      opacityKeyframes()
      const { container, onKeyframeMoved, refresh } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      fireEvent.keyDown(svg, { key: 'ArrowRight', altKey: true })
      expect(onKeyframeMoved).toHaveBeenLastCalledWith(
        'opacity', 1, expect.closeTo(1.01, 6), false
      )

      // Unlike the value nudge this one has to be committed between presses:
      // the nudge moves the selection to the new time, and a selection with no
      // keyframe under it would make the repeat a no-op.
      const newTime = onKeyframeMoved.mock.calls[0][2] as number
      store().moveClipKeyframe('clip1', 'opacity', 1, newTime)
      refresh()

      fireEvent.keyDown(svg, { key: 'ArrowRight', altKey: true, repeat: true })
      expect(onKeyframeMoved).toHaveBeenLastCalledWith(
        'opacity', expect.closeTo(1.01, 6), expect.closeTo(1.02, 6), true
      )
      expect(onKeyframeMoved).toHaveBeenCalledTimes(2)
    })

    it('clamps the nudged time to the clip', () => {
      // Half a fine step inside each end of the clip, so an unclamped nudge
      // would overshoot to -0.005s and past the clip's last frame.
      store().setClipKeyframe('clip1', 'opacity', { time: CLIP_DURATION - 0.005, value: 0.5, easing: 'linear' })
      // The store auto-creates its own keyframe at 0s; move it half a step in
      // so the low clamp has something to clamp and nothing to collide with.
      store().moveClipKeyframe('clip1', 'opacity', 0, 0.005)
      const { container, onKeyframeMoved } = renderGraph('opacity')
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'Home' })
      fireEvent.keyDown(svg, { key: 'ArrowLeft', altKey: true })
      expect(onKeyframeMoved).toHaveBeenCalledWith('opacity', 0.005, 0, false)

      fireEvent.keyDown(svg, { key: 'End' })
      fireEvent.keyDown(svg, { key: 'ArrowRight', altKey: true })
      expect(onKeyframeMoved).toHaveBeenLastCalledWith('opacity', CLIP_DURATION - 0.005, CLIP_DURATION, false)
    })

    it('writes nothing when a time nudge lands on the time the keyframe already has', async () => {
      const user = userEvent.setup()
      // The user's keyframe is already on the clip's last frame.
      store().setClipKeyframe('clip1', 'opacity', { time: CLIP_DURATION, value: 0.5, easing: 'linear' })
      const { container, onKeyframeMoved } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      // A value nudge first, purely to put something in the live region that
      // the refused time nudge then has to leave alone.
      fireEvent.keyDown(svg, { key: 'ArrowDown' })
      expect(screen.getByRole('status')).toHaveTextContent('Opacity 49% at 4.30 seconds')

      await user.keyboard('{Alt>}{ArrowRight}{/Alt}')

      // Clamped back onto its own time: no move, no undo entry, and nothing
      // said — this is not the occupancy refusal, which does announce.
      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('Opacity 49% at 4.30 seconds')
      // The window sees only the Alt press, which the graph has no claim on.
      expect(seen.mock.calls.map(([e]) => e.key)).toEqual(['Alt'])
    })

    it('refuses a time nudge that would land on another keyframe', async () => {
      const user = userEvent.setup()
      // 1s and 1.01s are exactly one fine nudge apart, and moveClipKeyframe
      // drops whatever already sits within 0.001s of the target.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 1.01, value: 0.25, easing: 'linear' })
      const { container, onKeyframeMoved } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      expect(activeDescendant(container)).toBe('kf-opacity-1')

      await user.keyboard('{Alt>}{ArrowRight}{/Alt}')

      // Refused, not merged — and still not a key the editor gets to see. The
      // window sees the Alt press itself, which the graph has no claim on, and
      // nothing else.
      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(seen.mock.calls.map(([e]) => e.key)).toEqual(['Alt'])
      expect(activeDescendant(container)).toBe('kf-opacity-1')
      // A refusal that says nothing is indistinguishable from a dead key, so
      // the live region has to explain it.
      expect(screen.getByRole('status')).toHaveTextContent(
        'Opacity keyframe not moved: another keyframe is at 1.01 seconds'
      )
    })

    it('swallows a time nudge with no keyframe selected', async () => {
      const user = userEvent.setup()
      const { container, onKeyframeMoved } = renderGraph('opacity', { animation: fadeInAndCustom })
      const svg = graphSvg(container)
      svg.focus()

      // A preset is active, so there is nothing the nudge may move.
      fireEvent.keyDown(svg, { key: 'Home' })
      await user.keyboard('{Alt>}{ArrowRight}{/Alt}')

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(seen.mock.calls.map(([e]) => e.key)).toEqual(['Alt'])
    })

    it('follows the nudged keyframe when the move re-sorts the array', () => {
      // Three handles: the store's own at 0s, then 1s and 1.05s. A coarse
      // nudge is 0.1s, so the 1.05s one jumps clean over its neighbour — the
      // case the whole "track the active option by time, not by index" design
      // exists for, and the only one where the index actually changes.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 1.05, value: 0.25, easing: 'ease-in' })
      const { container, onKeyframeMoved, refresh } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'End' })
      expect(activeDescendant(container)).toBe('kf-opacity-2')

      fireEvent.keyDown(svg, { key: 'ArrowLeft', altKey: true, shiftKey: true })
      const call = onKeyframeMoved.mock.calls[0]
      expect(call[1]).toBeCloseTo(1.05, 6)
      expect(call[2]).toBeCloseTo(0.95, 6)
      store().moveClipKeyframe('clip1', 'opacity', call[1] as number, call[2] as number)
      refresh()

      // It is index 1 now, between 0s and 1s — and it is still the same
      // keyframe, which its own easing is the proof of: the 1s keyframe it
      // passed is 'linear'.
      expect(activeDescendant(container)).toBe('kf-opacity-1')
      expect(screen.getByLabelText('Keyframe easing')).toHaveValue('ease-in')
    })

    it('keeps the nudged keyframe selected once the host commits the move', () => {
      opacityKeyframes()
      const { container, onKeyframeMoved, refresh } = renderGraph('opacity')
      const svg = selectCustomKeyframe(container)

      fireEvent.keyDown(svg, { key: 'ArrowRight', altKey: true })

      const newTime = onKeyframeMoved.mock.calls[0][2] as number
      store().moveClipKeyframe('clip1', 'opacity', 1, newTime)
      refresh()

      expect(activeDescendant(container)).toBe('kf-opacity-1')
      // Still the same keyframe: its easing is the one it was created with, so
      // the selection did not silently move to a different handle.
      expect(screen.getByLabelText('Keyframe easing')).toHaveValue('linear')
    })
  })

  describe('adding a keyframe at the playhead', () => {
    it('adds at the value the curve has there', () => {
      // 0.5 at 1s and 0.1 at 3s, both linear, so the curve reads 0.3 at 2s.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 3, value: 0.1, easing: 'linear' })
      const { container, onAddKeyframe, refresh } = renderGraph('opacity', { playheadTime: 2 })
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'Enter' })

      expect(onAddKeyframe.mock.calls[0][0]).toBe('opacity')
      expect(onAddKeyframe.mock.calls[0][1]).toBe(2)
      expect(onAddKeyframe.mock.calls[0][2]).toBeCloseTo(0.3, 6)

      // Once the host commits it, the new keyframe is the active option.
      store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.3, easing: 'ease-in-out' })
      refresh()
      expect(graphSvg(container).getAttribute('aria-activedescendant')).toBe('kf-opacity-2')
      expect(screen.getByLabelText('Keyframe easing')).toBeInTheDocument()
    })

    it('interpolates at the clamped time rather than at the playhead', () => {
      // A clip trimmed shorter than its keyframes: 0.5 at 1s and 0 at 6s on a
      // 4.3s clip, with the playhead past the end. The keyframe is placed at
      // the clip's last frame, so it has to take the value the curve holds
      // *there* — 0.17 — and not the 0 the curve holds at the playhead, which
      // would visibly move the curve the moment it lands.
      const trimmed: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          opacity: [
            { time: 1, value: 0.5, easing: 'linear' },
            { time: 6, value: 0, easing: 'linear' },
          ],
        },
      }
      const { container, onAddKeyframe } = renderGraph('opacity', {
        animation: trimmed,
        playheadTime: 6,
      })
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'Enter' })

      expect(onAddKeyframe.mock.calls[0][1]).toBe(CLIP_DURATION)
      expect(onAddKeyframe.mock.calls[0][2]).toBeCloseTo(0.17, 6)
    })

    it('adds at the property default on a graph with no keyframes', () => {
      const { container, onAddKeyframe } = renderGraph('opacity', { playheadTime: 2 })
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'Enter' })

      expect(onAddKeyframe).toHaveBeenCalledWith('opacity', 2, 1)
    })
  })

  // The contract the whole design rests on, stated once as a table rather than
  // left implicit in the behaviour tests above. React attaches its listener at
  // the root container, below `window`, so a stopPropagation() in the graph's
  // onKeyDown stops the native event before either of the editor's window-level
  // cascades (app/useAppKeyboardShortcuts.ts, Preview/PlaybackControls.tsx) can
  // see it. `seen` is those cascades' stand-in.
  describe('the propagation contract', () => {
    /** Claimed the moment the graph has focus, whatever is or is not active. */
    const ALWAYS_OWNED = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter']

    /** Claimed only when there is an active option for them to act on. */
    const OWNED_WHEN_ACTIVE = ['Delete', 'Backspace', 'Escape']

    /**
     * Keys the graph must never claim, each with the `key` the editor's window
     * listeners switch on: the shortcut sheet ('?'), the tools ('k', 's', 'v')
     * and play/pause (Space) all have to keep working from inside the graph,
     * and Tab has to keep leaving it.
     */
    const NOT_OWNED: [name: string, keystroke: string, key: string][] = [
      ['Tab', '{Tab}', 'Tab'],
      ['?', '?', '?'],
      ['k', 'k', 'k'],
      ['s', 's', 's'],
      ['v', 'v', 'v'],
      ['Space', ' ', ' '],
    ]

    const keysSeen = () => seen.mock.calls.map(([e]) => e.key)

    it.each(ALWAYS_OWNED)('swallows %s while the graph is focused', async (key) => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      graphSvg(container).focus()

      await user.keyboard(`{${key}}`)

      expect(keysSeen()).toEqual([])
    })

    it.each(OWNED_WHEN_ACTIVE)('swallows %s while a custom keyframe is active', async (key) => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()

      // The user's own keyframe at 1s — editable, so these keys also act.
      fireEvent.keyDown(svg, { key: 'End' })
      await user.keyboard(`{${key}}`)

      expect(keysSeen()).toEqual([])
    })

    it.each(OWNED_WHEN_ACTIVE)('swallows %s while a preset keyframe is active', async (key) => {
      const user = userEvent.setup()
      const { container } = renderGraph('opacity', { animation: fadeInAndCustom })
      const svg = graphSvg(container)
      svg.focus()

      // A preset is announced as the selected option but is not editable, so
      // these keys are claimed and then do nothing — falling through from here
      // would delete the whole clip (ESCSUITE-49).
      fireEvent.keyDown(svg, { key: 'Home' })
      await user.keyboard(`{${key}}`)

      expect(keysSeen()).toEqual([])
    })

    it.each(OWNED_WHEN_ACTIVE)('lets %s reach the editor when nothing is active', async (key) => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      graphSvg(container).focus()

      await user.keyboard(`{${key}}`)

      // Deliberate (plan ruling 4): with no active option the graph has nothing
      // to act on, so the editor's own deselect/delete cascade still runs.
      expect(keysSeen()).toEqual([key])
    })

    it.each(NOT_OWNED)('lets %s through to the editor', async (_name, keystroke, key) => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()
      // Something is active, so even the conditional claims are in force —
      // these keys are still none of the graph's business.
      fireEvent.keyDown(svg, { key: 'End' })

      await user.keyboard(keystroke)

      // Positively: the window really did see this key. An assertion that the
      // spy stayed empty would pass just as well if the keystroke never fired.
      expect(keysSeen()).toContain(key)
    })
  })

  describe('the live region', () => {
    it('is empty on mount and announces the nudged value', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)

      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('')
      expect(status).toHaveAttribute('aria-live', 'polite')

      // Navigation alone says nothing: aria-activedescendant already moved, and
      // announcing here would double up.
      fireEvent.keyDown(svg, { key: 'End' })
      expect(status).toHaveTextContent('')

      fireEvent.keyDown(svg, { key: 'ArrowDown' })
      expect(status).toHaveTextContent('Opacity 49% at 1.00 seconds')
    })

    it('announces a deletion', async () => {
      const user = userEvent.setup()
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)
      svg.focus()

      fireEvent.keyDown(svg, { key: 'End' })
      await user.keyboard('{Delete}')

      expect(screen.getByRole('status')).toHaveTextContent(
        'Opacity keyframe at 1.00 seconds deleted'
      )
    })

    it('announces the time a keyframe was nudged to', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'End' })
      fireEvent.keyDown(svg, { key: 'ArrowRight', altKey: true, shiftKey: true })

      expect(screen.getByRole('status')).toHaveTextContent('Opacity 50% at 1.10 seconds')
    })

    it('announces the keyframe added at the playhead', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity', { playheadTime: 2 })
      const svg = graphSvg(container)

      fireEvent.keyDown(svg, { key: 'Enter' })

      expect(screen.getByRole('status')).toHaveTextContent('Opacity 50% at 2.00 seconds')
    })

    it('says an identical message differently the second time', () => {
      // The region is aria-atomic, and an assistive technology does not
      // re-read an atomic region whose text did not change: two identical
      // edits in a row would be announced once. A zero-width space on
      // alternate announcements makes the string differ without changing a
      // character of what is read out.
      opacityKeyframes()
      const { container } = renderGraph('opacity', { playheadTime: 2 })
      const svg = graphSvg(container)
      const status = screen.getByRole('status')
      const spoken = (text: string) => text.replace(/\u200B/g, '')

      fireEvent.keyDown(svg, { key: 'Enter' })
      const first = status.textContent
      fireEvent.keyDown(svg, { key: 'Enter' })
      const second = status.textContent

      expect(first).not.toBe(second)
      expect(spoken(first!)).toBe('Opacity 50% at 2.00 seconds')
      expect(spoken(second!)).toBe('Opacity 50% at 2.00 seconds')
    })
  })
})
