import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { KeyframeGraph } from './KeyframeGraph'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { AnimatableProperty, Clip, ClipAnimation } from '../../store/types'
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
  } = {}
) {
  const clip = currentClip()
  const onKeyframeMoved = vi.fn()
  const onKeyframeValueChanged = vi.fn()
  const onAddKeyframe = vi.fn()
  const onDeleteKeyframe = vi.fn()
  const view = render(
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
    />
  )
  return { ...view, onKeyframeMoved, onKeyframeValueChanged, onAddKeyframe, onDeleteKeyframe }
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

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(window, { key: 'Delete' })

      expect(onDeleteKeyframe).toHaveBeenCalledWith('opacity', 1)
      // The selection is dropped, so a second press does nothing.
      fireEvent.keyDown(window, { key: 'Delete' })
      expect(onDeleteKeyframe).toHaveBeenCalledTimes(1)
    })

    it('deletes the selected keyframe on Backspace', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(window, { key: 'Backspace' })

      expect(onDeleteKeyframe).toHaveBeenCalledWith('opacity', 1)
    })

    it('ignores other keys while a keyframe is selected', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.keyDown(window, { key: 'a' })

      expect(onDeleteKeyframe).not.toHaveBeenCalled()
    })

    it('deselects when the graph background is clicked', () => {
      const { container, onDeleteKeyframe } = renderGraph('opacity')

      fireEvent.click(points(container)[1])
      fireEvent.click(container.querySelector('svg')!)
      fireEvent.keyDown(window, { key: 'Delete' })

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
      fireEvent.keyDown(window, { key: 'Delete' })

      expect(points(container)[0]).not.toHaveClass(styles.selected)
      expect(onDeleteKeyframe).not.toHaveBeenCalled()
    })

    it('survives a right-click when the host offers no delete handler', () => {
      const { container } = renderGraph('opacity', { withDelete: false })

      fireEvent.click(points(container)[1])
      expect(() => fireEvent.contextMenu(points(container)[1])).not.toThrow()
      expect(() => fireEvent.keyDown(window, { key: 'Delete' })).not.toThrow()
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

    async function flushValueCommit() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    it('moves a keyframe in time and value together', async () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: xForTime(3), clientY: yForUnitValue(0.2) })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      expect(onKeyframeMoved.mock.calls[0][0]).toBe('opacity')
      expect(onKeyframeMoved.mock.calls[0][1]).toBeCloseTo(1, 6)
      expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(3, 6)

      // The new value is applied only once the move has landed.
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
      await flushValueCommit()
      expect(onKeyframeValueChanged.mock.calls[0][1]).toBeCloseTo(3, 6)
      expect(onKeyframeValueChanged.mock.calls[0][2]).toBeCloseTo(0.2, 6)
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

    it('clamps a drag that leaves the plot area', () => {
      const { container, onKeyframeMoved, onKeyframeValueChanged } = renderGraph('opacity')
      measureGraph(container)

      fireEvent.mouseDown(points(container)[1])
      fireEvent.mouseMove(window, { clientX: -400, clientY: 900 })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved.mock.calls[0][2]).toBe(0)
      expect(onKeyframeValueChanged).not.toHaveBeenCalled()
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
  })
})
