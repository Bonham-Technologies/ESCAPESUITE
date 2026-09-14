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

      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      await user.keyboard('{ArrowUp}{ArrowDown}{Enter}')

      // The value nudge and the add land in the next commit; the keys are the
      // graph's from here on either way, so they never reach the editor.
      expect(seen).not.toHaveBeenCalled()
      expect(onAddKeyframe).not.toHaveBeenCalled()
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
      expect(activeDescendant(container)).toBe('kf-opacity-0')
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
})
