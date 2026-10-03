import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyframeGraph } from './KeyframeGraph'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { AnimatableProperty, Clip, ClipAnimation } from '../../store/types'
import { EASING_TYPES } from '../../utils/easingOptions'
import styles from './KeyframeGraph.module.css'

// The graph draws into a 500x200 viewBox with 50px of padding on the left, 20
// on the right, 20 on top and 30 at the bottom — so the plot area is 430x150.
// Giving the <svg> exactly that box makes screen coordinates equal viewBox
// coordinates, and a 4.3s clip puts one second every 100px:
//   x = 50 + 100 * t      y = 20 + (1 - value) * 150   (for a 0..1 property)
const CLIP_DURATION = 4.3
const xForTime = (t: number) => 50 + 100 * t
const yForUnitValue = (v: number) => 20 + (1 - v) * 150

function measureGraph(container: HTMLElement, box: Partial<DOMRect> = {}): SVGSVGElement {
  const svg = container.querySelector('svg')!
  const rect = { left: 0, top: 0, width: 500, height: 200, ...box }
  svg.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
    }) as DOMRect
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
    locked?: boolean
  } = {}
) {
  const clip = currentClip()
  // `true` is the ordinary answer (ESCSUITE-87/163): an unlocked track, and a
  // move that found a keyframe to move. `handleMouseUp`'s gesture history
  // reads this to decide whether a diagonal drag's value half should commit —
  // a test that wants the refusal says so with `mockReturnValue(false)`.
  const onKeyframeMoved = vi.fn(
    (_property: AnimatableProperty, _originalTime: number, _newTime: number, _skipHistory?: boolean) => true
  )
  const onKeyframeValueChanged = vi.fn(
    (_property: AnimatableProperty, _time: number, _newValue: number, _skipHistory?: boolean) => true
  )
  const onAddKeyframe = vi.fn()
  // Since ESCSUITE-88 the delete handler reports whether the store removed the
  // keyframe, and the graph only clears its selection when it did.
  const onDeleteKeyframe = vi.fn((_property: AnimatableProperty, _time: number) => true)
  const onKeyframeEasingChanged = vi.fn()
  const view = render(
    <KeyframeGraph
      property={property}
      clipDuration={clip.duration}
      animation={'animation' in options ? options.animation : clip.animation}
      transform={clip.transform}
      effects={clip.effects}
      playheadTime={options.playheadTime ?? 0}
      locked={options.locked ?? false}
      onKeyframeMoved={onKeyframeMoved}
      onKeyframeValueChanged={onKeyframeValueChanged}
      onAddKeyframe={onAddKeyframe}
      onDeleteKeyframe={options.withDelete === false ? undefined : onDeleteKeyframe}
      onKeyframeEasingChanged={options.withEasing === false ? undefined : onKeyframeEasingChanged}
    />
  )
  return {
    ...view,
    onKeyframeMoved,
    onKeyframeValueChanged,
    onAddKeyframe,
    onDeleteKeyframe,
    onKeyframeEasingChanged,
  }
}

const points = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGCircleElement>('circle'))

/** An opacity curve with a user keyframe at 1s; the store adds one at 0s. */
function opacityKeyframes() {
  store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
}

describe('KeyframeGraph', () => {
  beforeEach(() => {
    resetStoreForTest()
    addClip('clip1', 0, CLIP_DURATION)
  })

  describe('drawing', () => {
    it('draws a flat line at the clip value when nothing is keyframed', () => {
      const { container } = renderGraph('opacity')

      const curve = container.querySelector(`.${styles.curve}`)!
      // opacity 1 sits at the top of the plot area.
      expect(curve.getAttribute('d')).toBe('M 50 20 L 480 20')
      expect(points(container)).toHaveLength(0)
    })

    it('samples the interpolated curve once keyframes exist', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')

      const d = container.querySelector(`.${styles.curve}`)!.getAttribute('d')!
      expect(d.startsWith('M 50.0 20.0')).toBe(true)
      expect(d.endsWith('L 480.0 95.0')).toBe(true)
      // The curve is sampled every 4px across the 430px plot area.
      expect(d.split('L')).toHaveLength(108)
    })

    it('plots each keyframe at its time and value', () => {
      opacityKeyframes()
      const { container } = renderGraph('opacity')

      expect(points(container).map((c) => [c.getAttribute('cx'), c.getAttribute('cy')])).toEqual([
        [String(xForTime(0)), String(yForUnitValue(1))],
        [String(xForTime(1)), String(yForUnitValue(0.5))],
      ])
    })

    it('skips keyframes whose value is not a finite number', () => {
      const { container } = renderGraph('opacity', {
        animation: {
          in: { type: 'none', duration: 0, easing: 'linear' },
          out: { type: 'none', duration: 0, easing: 'linear' },
          keyframes: {
            opacity: [
              { time: 0, value: 1, easing: 'linear' },
              { time: 1, value: NaN, easing: 'linear' },
              { time: 2, value: 0.5, easing: 'linear' },
            ],
          },
        },
      })

      expect(points(container)).toHaveLength(2)
    })

    it('labels the value axis and the time axis', () => {
      const { container } = renderGraph('opacity')

      const labels = Array.from(container.querySelectorAll(`.${styles.label}`)).map(
        (t) => t.textContent
      )
      expect(labels).toEqual(['0%', '25%', '50%', '75%', '100%', '0s', '1s', '2s', '3s', '4s'])
    })

    it.each([
      ['rotation', 45, '45° @ 1.00s'],
      ['blur', 12.6, '13px @ 1.00s'],
      ['volume', 0.25, '25% @ 1.00s'],
      ['x', 0.4, '40% @ 1.00s'],
      ['scaleX', 1.5, '1.50 @ 1.00s'],
    ] as const)('describes a %s keyframe as %s', (property, value, label) => {
      store().setClipKeyframe('clip1', property, { time: 1, value, easing: 'linear' })
      const { container } = renderGraph(property)

      const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
      expect(titles[1]).toContain(label)
      expect(titles[1]).toContain('Drag to move')
    })

    it('marks preset keyframes as unmodifiable', () => {
      store().updateClipAnimation('clip1', { in: { type: 'fade', duration: 1, easing: 'ease-out' } })
      const { container } = renderGraph('opacity')

      const point = points(container)[0]
      expect(point).toHaveClass(styles.preset)
      expect(point.querySelector('title')!.textContent).toContain('Preset - cannot modify')
    })

    it('draws the playhead at the current time', () => {
      const { container } = renderGraph('opacity', { playheadTime: 2 })

      const playhead = container.querySelector(`.${styles.playhead}`)!
      expect(playhead.getAttribute('x1')).toBe(String(xForTime(2)))
      expect(playhead.getAttribute('y1')).toBe('20')
      expect(playhead.getAttribute('y2')).toBe('170')
    })

    it('hides the playhead when it sits outside the clip', () => {
      const { container } = renderGraph('opacity', { playheadTime: CLIP_DURATION + 1 })

      expect(container.querySelector(`.${styles.playhead}`)).toBeNull()
    })

    it('starts the blur curve from the clip blur amount', () => {
      store().updateClipEffects('clip1', { blur: 25 })
      const { container } = renderGraph('blur')

      // blur range is 0..50, so 25 lands halfway up the plot area.
      expect(container.querySelector(`.${styles.curve}`)!.getAttribute('d')).toBe('M 50 95 L 480 95')
    })

    it('starts the volume curve at full volume', () => {
      const { container } = renderGraph('volume')

      expect(container.querySelector(`.${styles.curve}`)!.getAttribute('d')).toBe('M 50 20 L 480 20')
    })
  })

  describe('selecting and deleting', () => {
    beforeEach(() => {
      opacityKeyframes()
    })

    it('selects a keyframe when it is clicked', () => {
      const { container } = renderGraph('opacity')
      const point = points(container)[1]

      fireEvent.click(point)

      expect(points(container)[1]).toHaveClass(styles.selected)
      expect(points(container)[1].getAttribute('r')).toBe('7')
    })

    it('deletes the selected keyframe on Delete', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')
      const svg = container.querySelector('svg')!

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(svg, { key: 'Delete' })

      expect(onDeleteKeyframe).toHaveBeenCalledWith('opacity', 1)
      // The selection is dropped, so a second press does nothing.
      fireEvent.keyDown(svg, { key: 'Delete' })
      expect(onDeleteKeyframe).toHaveBeenCalledTimes(1)
    })

    it('deletes the selected keyframe on Backspace', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(container.querySelector('svg')!, { key: 'Backspace' })

      expect(onDeleteKeyframe).toHaveBeenCalledWith('opacity', 1)
    })

    it('ignores other keys while a keyframe is selected', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(container.querySelector('svg')!, { key: 'a' })

      expect(onDeleteKeyframe).not.toHaveBeenCalled()
    })

    it('deselects when the graph background is clicked', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.click(container.querySelector('svg')!)
      fireEvent.keyDown(container.querySelector('svg')!, { key: 'Delete' })

      expect(points(container)[1]).not.toHaveClass(styles.selected)
      expect(onDeleteKeyframe).not.toHaveBeenCalled()
    })

    it('deletes a keyframe on right-click', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.contextMenu(points(container)[1])

      expect(onDeleteKeyframe).toHaveBeenCalledWith('opacity', 1)
    })

    it('will not select or delete a preset keyframe', () => {
      resetStoreForTest()
      addClip('clip1', 0, CLIP_DURATION)
      store().updateClipAnimation('clip1', { in: { type: 'fade', duration: 1, easing: 'ease-out' } })
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[0])
      fireEvent.contextMenu(points(container)[0])
      fireEvent.keyDown(container.querySelector('svg')!, { key: 'Delete' })

      expect(points(container)[0]).not.toHaveClass(styles.selected)
      expect(onDeleteKeyframe).not.toHaveBeenCalled()
    })

    // ESCSUITE-88: the store would refuse the removal, so the right-click does
    // not ask for it. preventDefault still runs, so no browser menu appears.
    it('will not delete a keyframe on right-click while the track is locked', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity', { locked: true })

      fireEvent.contextMenu(points(container)[1])

      expect(onDeleteKeyframe).not.toHaveBeenCalled()
    })

    it('survives a right-click when the host offers no delete handler', () => {
      const { container } = renderGraph('opacity', { withDelete: false })

      fireEvent.click(points(container)[1])
      expect(() => fireEvent.contextMenu(points(container)[1])).not.toThrow()
      expect(() =>
        fireEvent.keyDown(container.querySelector('svg')!, { key: 'Delete' })
      ).not.toThrow()
    })
  })

  describe('choosing a keyframe easing', () => {
    const easingSelect = () => screen.queryByLabelText<HTMLSelectElement>('Keyframe easing')

    beforeEach(() => {
      opacityKeyframes()
    })

    it('offers no easing control until a keyframe is selected', () => {
      renderGraph('opacity')

      expect(easingSelect()).toBeNull()
    })

    it('shows the selected keyframe easing, with every curve in the shared order', () => {
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])

      const select = easingSelect()!
      expect(select.value).toBe('linear')
      expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual(
        EASING_TYPES.map((o) => [o.value, o.label])
      )
    })

    it('shows a stored easing the menu does not offer instead of a blank select', () => {
      // 'ease-in-out-quad' is a real EasingType (an exact alias of 'ease-in-out') that a
      // loaded project or host integration can carry even though EASING_TYPES omits it.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'ease-in-out-quad' })
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])

      const select = easingSelect()!
      expect(select.value).toBe('ease-in-out-quad')
      expect(select.options).toHaveLength(EASING_TYPES.length + 1)
    })

    it('does not add an extra option when the stored easing is already offered', () => {
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])

      expect(easingSelect()!.options).toHaveLength(EASING_TYPES.length)
    })

    it('reports the chosen easing for the selected keyframe', async () => {
      const user = userEvent.setup()
      // The keyframe starts on a different curve, so picking Linear is a change.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'ease-in-out' })
      const { container, onKeyframeEasingChanged } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      await user.selectOptions(easingSelect()!, 'linear')

      expect(onKeyframeEasingChanged).toHaveBeenCalledWith('opacity', 1, 'linear')
    })

    it('is reachable from the keyboard and commits without a pointer', async () => {
      const user = userEvent.setup()
      const { container, onKeyframeEasingChanged } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      await user.tab()

      expect(easingSelect()).toHaveFocus()
      // selectOptions drives the select by value, the way a keyboard does.
      await user.selectOptions(easingSelect()!, 'ease-out-cubic')
      expect(onKeyframeEasingChanged).toHaveBeenCalledWith('opacity', 1, 'ease-out-cubic')
    })

    it('goes away when the graph background is clicked', () => {
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.click(container.querySelector('svg')!)

      expect(easingSelect()).toBeNull()
    })

    it('goes away when the selected keyframe is deleted', () => {
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(container.querySelector('svg')!, { key: 'Delete' })

      expect(easingSelect()).toBeNull()
    })

    it('never appears for a preset keyframe', () => {
      resetStoreForTest()
      addClip('clip1', 0, CLIP_DURATION)
      store().updateClipAnimation('clip1', { in: { type: 'fade', duration: 1, easing: 'ease-out' } })
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[0])

      expect(easingSelect()).toBeNull()
    })

    it('renders nothing when the host offers no easing handler', () => {
      const { container } = renderGraph('opacity', { withEasing: false })

      fireEvent.click(points(container)[1])

      expect(easingSelect()).toBeNull()
      expect(points(container)[1]).toHaveClass(styles.selected)
    })

    it('leaves the graph itself addressable as the svg', () => {
      const { container } = renderGraph('opacity')

      fireEvent.click(points(container)[1])

      const graph = container.querySelector(`.${styles.graph}`)!
      expect(graph.tagName).toBe('svg')
      expect(measureGraph(container)).toBe(graph)
    })
  })

  describe('adding keyframes', () => {
    it('adds a keyframe at the double-clicked time and value', () => {
      const { container, onAddKeyframe } = renderGraph('opacity')
      const svg = measureGraph(container)

      fireEvent.doubleClick(svg, { clientX: xForTime(2), clientY: yForUnitValue(0.25) })

      const [property, time, value] = onAddKeyframe.mock.calls[0]
      expect(property).toBe('opacity')
      expect(time).toBeCloseTo(2, 6)
      expect(value).toBeCloseTo(0.25, 6)
    })

    // ESCSUITE-88: the store would refuse the keyframe, so the graph does not ask
    // for it. Same point as the unlocked case above, which is the control.
    it('adds nothing on a double-click while the track is locked', () => {
      const { container, onAddKeyframe } = renderGraph('opacity', { locked: true })
      const svg = measureGraph(container)

      fireEvent.doubleClick(svg, { clientX: xForTime(2), clientY: yForUnitValue(0.25) })

      expect(onAddKeyframe).not.toHaveBeenCalled()
    })

    it('accounts for the letterboxing when the svg box is a different shape', () => {
      const { container, onAddKeyframe } = renderGraph('opacity')
      // 1000x200 box: the 500x200 viewBox is drawn at scale 1, centred, so
      // everything is shifted 250px to the right.
      const svg = measureGraph(container, { width: 1000 })

      fireEvent.doubleClick(svg, { clientX: 250 + xForTime(2), clientY: yForUnitValue(0.25) })

      expect(onAddKeyframe.mock.calls[0][1]).toBeCloseTo(2, 6)
    })

    it.each([
      ['left of', 10, 100],
      ['right of', 490, 100],
      ['above', 200, 5],
      ['below', 200, 190],
    ] as const)('ignores a double-click %s the plot area', (_where, clientX, clientY) => {
      const { container, onAddKeyframe } = renderGraph('opacity')
      const svg = measureGraph(container)

      fireEvent.doubleClick(svg, { clientX, clientY })

      expect(onAddKeyframe).not.toHaveBeenCalled()
    })
  })

  describe('dragging keyframes', () => {
    beforeEach(() => {
      opacityKeyframes()
    })

    // Kept past the fix (it is the sentinel for ESCSUITE-163 / M1's old shape:
    // a diagonal drag used to commit its value in a `setTimeout(…, 0)`, which is
    // what made it a second, separate undo entry). Awaiting it now is a no-op —
    // both writes land synchronously — so it stays only in the one test below
    // that specifically needs to look past where that deferral used to be.
    async function flushValueCommit() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    it('moves a keyframe in time and value together, synchronously, as one gesture', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
      fireEvent.mouseUp(window)

      // Both writes land before mouseUp returns (ESCSUITE-163 / M1) — no
      // setTimeout, so no race with whatever the gesture does next.
      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      expect(onKeyframeMoved.mock.calls[0][0]).toBe('opacity')
      expect(onKeyframeMoved.mock.calls[0][1]).toBeCloseTo(1, 6)
      expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(3, 6)
      // The move is the gesture's first write: it is not told to skip history.
      expect(onKeyframeMoved.mock.calls[0][3]).toBe(false)

      expect(onKeyframeValueChanged).toHaveBeenCalledTimes(1)
      expect(onKeyframeValueChanged.mock.calls[0][1]).toBeCloseTo(3, 6)
      expect(onKeyframeValueChanged.mock.calls[0][2]).toBeCloseTo(0.2, 6)
      // The value write joins the move's undo entry instead of pushing its own.
      expect(onKeyframeValueChanged.mock.calls[0][3]).toBe(true)
    })

    it('leaves the value alone when the move is refused', async () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)
      onKeyframeMoved.mockReturnValue(false)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
      fireEvent.mouseUp(window)
      // Past where the old setTimeout(…, 0) would have fired, so this fails on
      // the un-fixed code even though the fixed code needs no wait at all.
      await flushValueCommit()

      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
    })

    it('moves a keyframe in time only while Alt is held', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1], { altKey: true })
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(3, 6)
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
    })

    it('changes the value in place while Shift is held', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1], { shiftKey: true })
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(onKeyframeValueChanged.mock.calls[0][1]).toBeCloseTo(1, 6)
      expect(onKeyframeValueChanged.mock.calls[0][2]).toBeCloseTo(0.2, 6)
    })

    it('commits nothing when the keyframe is released where it started', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(1), clientY: yForUnitValue(0.5) })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
    })

    it('shows the keyframe following the pointer during the drag', () => {
      const { container } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })

      const dragged = points(container)[1]
      expect(dragged).toHaveClass(styles.dragging)
      expect(dragged.getAttribute('r')).toBe('8')
      expect(Number(dragged.getAttribute('cx'))).toBeCloseTo(xForTime(3), 6)
      expect(Number(dragged.getAttribute('cy'))).toBeCloseTo(yForUnitValue(0.2), 6)
    })

    // ESCSUITE-88: refused at the press, so there is no drag state to draw and
    // nothing to commit on release. A click still selects (see above).
    it('starts no drag on a keyframe whose track is locked', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } =
        renderGraph('opacity', { locked: true })
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })

      expect(points(container)[1]).not.toHaveClass(styles.dragging)

      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
    })

    it('clamps a drag that leaves the plot area, committing both halves', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      // Clamped to the clip's END rather than its start (ESCSUITE-179): a
      // drag that overshoots to the left clamps to time 0, which is exactly
      // where opacityKeyframes()'s auto-created start keyframe already sits,
      // and a clamp that landed there would now be refused as a drop onto a
      // neighbour rather than exercising the clamp this test is about.
      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: 99999, clientY: 900 })
      fireEvent.mouseUp(window)

      // Neither the move nor the value lands anywhere near the t=0/t=1
      // keyframes opacityKeyframes() leaves behind, so ESCSUITE-179's
      // occupancy refusal never engages here — this landing clamps time AND
      // value away from where the keyframe started (1s/0.5 to the clip's end
      // at floor value), and both halves of the diagonal-drag gesture commit
      // synchronously (ESCSUITE-163 / M1).
      expect(onKeyframeMoved.mock.calls[0][2]).toBe(CLIP_DURATION)
      expect(onKeyframeValueChanged.mock.calls[0][1]).toBe(CLIP_DURATION)
      expect(onKeyframeValueChanged.mock.calls[0][2]).toBe(0)
    })

    it('leaves the keyframe selected where the drag ended', () => {
      const { container } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(1), clientY: yForUnitValue(0.5) })
      fireEvent.mouseUp(window)

      expect(points(container)[1]).toHaveClass(styles.selected)
    })

    it('does not start a drag from a preset keyframe', () => {
      resetStoreForTest()
      addClip('clip1', 0, CLIP_DURATION)
      store().updateClipAnimation('clip1', { in: { type: 'fade', duration: 1, easing: 'ease-out' } })
      const { container, onKeyframeMoved } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[0])
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(points(container)[0]).not.toHaveClass(styles.dragging)
    })

    // ESCSUITE-179: moveClipKeyframe deletes whatever already sits within
    // KEYFRAME_TIME_EPSILON of the drop. The graph's own point drag used to
    // let the point follow the pointer there and refuse the drop on release
    // — the shape ESCSUITE-88 ruled against for a locked track's own drag —
    // and now clamps `currentTime` away from the window on every move
    // instead (ESCSUITE-183), so these cases land (slightly off the
    // neighbour) rather than refuse.
    describe('clamping a drop away from another keyframe (ESCSUITE-183, supersedes 179\'s refuse-and-snap-back)', () => {
      beforeEach(() => {
        // A third keyframe at t=3, beyond the two opacityKeyframes() already
        // set at t=0 and t=1, so a drag of the t=1 point has somewhere to
        // collide that is neither its own start nor end.
        store().setClipKeyframe('clip1', 'opacity', { time: 3, value: 0.8, easing: 'linear' })
      })

      it('clamps the drop to just past the neighbour, keeping all three keyframes', () => {
        const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
        measureGraph(container)

        // Alt-drag: time only, so the clamp is isolated from any value write.
        fireEvent.mouseDown(points(container)[1], { altKey: true })
        fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.5) })
        fireEvent.mouseUp(window)

        expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeGreaterThan(3)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(3, 2)
        expect(onKeyframeValueChanged).not.toHaveBeenCalled()
        // `onKeyframeMoved` is a mock here and never actually writes to the
        // store, so the rendered points still reflect the real, unmoved
        // keyframe once the drag state clears on release.
        expect(points(container)).toHaveLength(3)
        expect(Number(points(container)[1].getAttribute('cx'))).toBeCloseTo(xForTime(1), 6)
      })

      it('commits the value alongside the clamped time, since the move now lands', async () => {
        const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
        measureGraph(container)

        // No modifier: both time and value change together.
        fireEvent.mouseDown(points(container)[1])
        fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
        fireEvent.mouseUp(window)

        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0))
        })

        expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeGreaterThan(3)
        expect(onKeyframeValueChanged).toHaveBeenCalledTimes(1)
        expect(onKeyframeValueChanged.mock.calls[0][2]).toBeCloseTo(0.2, 6)
      })

      it('announces nothing — the live region stays clear once the clamped drop lands', () => {
        const { container } = renderGraph('opacity')
        measureGraph(container)

        fireEvent.mouseDown(points(container)[1], { altKey: true })
        fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.5) })
        fireEvent.mouseUp(window)

        expect(screen.getByRole('status')).toBeEmptyDOMElement()
      })

      it('lands normally just outside the epsilon window', () => {
        const { container, onKeyframeMoved } = renderGraph('opacity')
        measureGraph(container)

        // 0.002s away from the t=3 keyframe — outside KEYFRAME_TIME_EPSILON
        // (0.001s) — so this is an ordinary, uncontested move, unaffected by
        // the clamp.
        fireEvent.mouseDown(points(container)[1], { altKey: true })
        fireEvent.mouseMove(window, { clientX: xForTime(2.998), clientY: yForUnitValue(0.5) })
        fireEvent.mouseUp(window)

        expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(2.998, 6)
      })

      it('clamps a drop approaching a neighbour from the right, landing just past it', () => {
        const { container, onKeyframeMoved } = renderGraph('opacity')
        measureGraph(container)

        // Drag the t=3 point down toward the t=1 neighbour, from above it.
        fireEvent.mouseDown(points(container)[2], { altKey: true })
        fireEvent.mouseMove(window, { clientX: xForTime(1.0005), clientY: yForUnitValue(0.5) })
        fireEvent.mouseUp(window)

        expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeGreaterThan(1)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(1, 2)
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
      })

      // Review round 1, MINOR 2: a left overshoot clamps to time 0 (the same
      // clamp 'clamps a drag that leaves the plot area' pins at the clip's
      // END, now that the start is occupied) — which used to land inside the
      // t=0 keyframe's own epsilon window and be refused the same way a
      // pixel-exact collision would be. `handleMouseMove`'s own clamp now
      // catches this case before release ever sees it: the overshoot stops
      // just past the start keyframe instead, same as any other neighbour.
      it('clamps a left overshoot to just past the start keyframe, instead of refusing', () => {
        const { container, onKeyframeMoved } = renderGraph('opacity')
        measureGraph(container)

        fireEvent.mouseDown(points(container)[2], { altKey: true }) // the t=3 keyframe
        fireEvent.mouseMove(window, { clientX: -400, clientY: yForUnitValue(0.5) })
        fireEvent.mouseUp(window)

        expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeGreaterThan(0)
        expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(0, 2)
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
      })

      // The release-time refusal above `handleMouseUp` still carries is kept
      // as a backstop (the same rule the keyboard's `nudgeTime` enforces for
      // its own entry point) but should now be unreachable by a mouse drag,
      // since the clamp runs on every move first.
      it('never announces the occupied-neighbour refusal from a mouse drag', () => {
        const { container } = renderGraph('opacity')
        measureGraph(container)

        fireEvent.mouseDown(points(container)[1], { altKey: true })
        fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.5) }) // exactly on the t=3 neighbour
        fireEvent.mouseUp(window)

        expect(screen.getByRole('status')).not.toHaveTextContent(/another keyframe is at/)
      })
    })
  })
})
