import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyframeTrack } from './KeyframeTrack'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { AnimatableProperty, Clip } from '../../store/types'
import styles from './KeyframeTrack.module.css'

const CLIP_DURATION = 4

function currentClip(): Clip {
  return store().project.timeline.clips[0]
}

function renderTrack(
  property: AnimatableProperty,
  overrides: {
    currentTime?: number
    playheadTime?: number
    isSelected?: boolean
    locked?: boolean
  } = {}
) {
  const clip = currentClip()
  const onSelect = vi.fn()
  const onKeyframeMoved = vi.fn()
  const onAddKeyframe = vi.fn()
  const onAnnounce = vi.fn()
  const view = render(
    <KeyframeTrack
      property={property}
      label={property}
      clipId={clip.id}
      clipDuration={clip.duration}
      animation={clip.animation}
      transform={clip.transform}
      effects={clip.effects}
      currentTime={overrides.currentTime ?? 0}
      playheadTime={overrides.playheadTime ?? 0}
      isSelected={overrides.isSelected ?? false}
      locked={overrides.locked ?? false}
      onSelect={onSelect}
      onKeyframeMoved={onKeyframeMoved}
      onAddKeyframe={onAddKeyframe}
      onAnnounce={onAnnounce}
    />
  )
  return { ...view, onSelect, onKeyframeMoved, onAddKeyframe, onAnnounce }
}

/** jsdom measures nothing, so the track needs a box for time↔pixel maths. */
function measureTrack(container: HTMLElement, left = 100, width = 400): HTMLElement {
  const area = container.querySelector<HTMLElement>(`.${styles.trackArea}`)!
  area.getBoundingClientRect = () =>
    ({ left, top: 0, width, height: 20, right: left + width, bottom: 20, x: left, y: 0 }) as DOMRect
  return area
}

const diamonds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(`.${styles.diamond}`))

describe('KeyframeTrack', () => {
  beforeEach(() => {
    resetStoreForTest()
    addClip('clip1', 0, CLIP_DURATION)
  })

  it('names the property it edits', () => {
    renderTrack('scaleX')

    expect(screen.getByText('Scale X')).toBeInTheDocument()
  })

  it('shows no diamonds for a clip with no animation', () => {
    const { container } = renderTrack('opacity')

    expect(diamonds(container)).toHaveLength(0)
  })

  it('marks user keyframes as custom and preset-generated ones as preset', () => {
    store().updateClipAnimation('clip1', { in: { type: 'fade', duration: 1, easing: 'ease-out' } })
    store().setClipKeyframe('clip1', 'opacity', { time: 3, value: 0.25, easing: 'linear' })

    const { container } = renderTrack('opacity')

    // preset at 0 and 1, custom at 3 (the auto-created keyframe at 0 merges
    // into the preset's).
    const rendered = diamonds(container)
    expect(rendered.map((d) => d.style.left)).toEqual(['0%', '25%', '75%'])
    expect(rendered[2]).toHaveClass(styles.custom)
    expect(rendered[1]).toHaveClass(styles.preset)
    expect(rendered[2].title).toBe('25% @ 3.00s')
    expect(rendered[1].title).toBe('100% @ 1.00s (preset)')
  })

  it('positions the playhead along the track', () => {
    const { container } = renderTrack('opacity', { playheadTime: 1 })

    expect(container.querySelector<HTMLElement>(`.${styles.playhead}`)!.style.left).toBe('25%')
  })

  it.each([
    ['rotation', 45, '45°'],
    ['blur', 12.34, '12.3px'],
    ['opacity', 0.5, '50%'],
    ['volume', 0.25, '25%'],
    ['x', 0.256, '25.6%'],
    ['scaleX', 1.5, '1.50'],
  ] as const)('formats the %s value as %s', (property, value, formatted) => {
    store().setClipKeyframe('clip1', property, { time: 2, value, easing: 'linear' })

    renderTrack(property, { currentTime: 2 })

    expect(screen.getByText(formatted)).toBeInTheDocument()
  })

  it('falls back to the clip value when the property has no keyframes', () => {
    renderTrack('opacity', { currentTime: 1 })

    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('reports a click on the track as a request to select the property', async () => {
    const user = userEvent.setup()
    const { container, onSelect } = renderTrack('opacity')

    await user.click(container.querySelector<HTMLElement>(`.${styles.track}`)!)

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('marks itself selected when the panel says so', () => {
    const { container } = renderTrack('opacity', { isSelected: true })

    expect(container.querySelector(`.${styles.track}`)).toHaveClass(styles.selected)
  })

  it('adds no keyframe on a double-click while the track is locked', () => {
    const { container, onAddKeyframe } = renderTrack('opacity', { locked: true })
    const area = measureTrack(container)

    fireEvent.doubleClick(area, { clientX: 200 })

    expect(onAddKeyframe).not.toHaveBeenCalled()
  })

  it('adds a keyframe at the double-clicked time, at the curve value there', () => {
    const { container, onAddKeyframe } = renderTrack('opacity')
    const area = measureTrack(container)

    fireEvent.doubleClick(area, { clientX: 200 })

    // 100px into a 400px track over a 4s clip; no keyframes yet, so the curve
    // sits at the clip's own default opacity (1).
    expect(onAddKeyframe).toHaveBeenCalledWith('opacity', 1, 1)
  })

  it('clamps a double-click past the end of the track to the clip duration', () => {
    const { container, onAddKeyframe } = renderTrack('opacity')
    const area = measureTrack(container)

    fireEvent.doubleClick(area, { clientX: 900 })

    expect(onAddKeyframe).toHaveBeenCalledWith('opacity', CLIP_DURATION, 1)
  })

  // ESCSUITE-167 / m3: a double-click used to add at the clip's static default
  // rather than the curve's own value there, jumping the shape visibly.
  it('adds a keyframe at the value the curve already holds, not the clip default', () => {
    store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.2, easing: 'linear' })
    const { container, onAddKeyframe } = renderTrack('opacity')
    const area = measureTrack(container)

    // 200px into a 400px track over a 4s clip = 2s, after the last keyframe —
    // the curve holds 0.2 there, not the clip's default opacity of 1.
    fireEvent.doubleClick(area, { clientX: 300 })

    expect(onAddKeyframe.mock.calls[0][0]).toBe('opacity')
    expect(onAddKeyframe.mock.calls[0][1]).toBe(2)
    expect(onAddKeyframe.mock.calls[0][2]).toBeCloseTo(0.2, 6)
  })

  describe('dragging keyframes', () => {
    beforeEach(() => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
    })

    it('moves a custom keyframe to where the pointer is released', () => {
      const { container, onKeyframeMoved } = renderTrack('opacity')
      measureTrack(container)
      const custom = diamonds(container)[1]

      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 300 })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).toHaveBeenCalledWith('opacity', 1, 2)
    })

    it('shows the keyframe at the dragged position before the drag ends', () => {
      const { container } = renderTrack('opacity')
      measureTrack(container)
      const custom = diamonds(container)[1]

      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 300 })

      const dragged = diamonds(container)[1]
      expect(dragged).toHaveClass(styles.dragging)
      expect(dragged.style.left).toBe('50%')
    })

    it('snaps a drag that lands near the playhead onto it', () => {
      const { container, onKeyframeMoved } = renderTrack('opacity', { playheadTime: 3 })
      measureTrack(container)
      const custom = diamonds(container)[1]

      // 3s sits at 300px + 100px offset = clientX 400; land 2px short of it.
      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 398 })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).toHaveBeenCalledWith('opacity', 1, 3)
    })

    // ESCSUITE-167 / M6: landing near a neighbour no longer snaps onto it —
    // that used to let moveClipKeyframe silently delete the neighbour.
    it('does not snap a drag near another keyframe onto it', () => {
      store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.75, easing: 'linear' })
      const { container, onKeyframeMoved } = renderTrack('opacity', { playheadTime: 0 })
      measureTrack(container)
      // keyframes now sit at 0, 1 and 2 seconds; drag the one at 1s.
      const custom = diamonds(container)[1]

      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 302 })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      expect(onKeyframeMoved.mock.calls[0][0]).toBe('opacity')
      expect(onKeyframeMoved.mock.calls[0][1]).toBe(1)
      expect(onKeyframeMoved.mock.calls[0][2]).toBeCloseTo(2.02, 6)
    })

    // Review round 1, MINOR 6: the row no longer renders its own live region
    // — `KeyframePanel` owns the one shared region every row's drag reports
    // into (KeyframePanel.test.tsx pins the shared alternation) — so this
    // checks the raw text the row hands up through `onAnnounce` instead of
    // querying a `role="status"` here.
    it('refuses a drop that lands exactly on another keyframe, and says why', () => {
      store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.75, easing: 'linear' })
      const { container, onKeyframeMoved, onAnnounce } = renderTrack('opacity', { playheadTime: 0 })
      measureTrack(container)
      // keyframes now sit at 0, 1 and 2 seconds; drag the one at 1s exactly
      // onto the one at 2s.
      const custom = diamonds(container)[1]

      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 300 }) // exactly 2s
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(onAnnounce).toHaveBeenCalledExactlyOnceWith(
        'Opacity keyframe not moved: another keyframe is at 2.00 seconds'
      )
    })

    it('reports nothing when the keyframe is released where it started', () => {
      const { container, onKeyframeMoved } = renderTrack('opacity')
      measureTrack(container)

      fireEvent.mouseDown(diamonds(container)[1], { clientX: 200 })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
    })

    // ESCSUITE-88: the store would refuse the move, so the drag never starts —
    // no drag state, no visual move, nothing reported to the panel.
    it('will not drag a custom keyframe on a locked track', () => {
      const { container, onKeyframeMoved } = renderTrack('opacity', { locked: true })
      measureTrack(container)
      const custom = diamonds(container)[1]
      expect(custom).toHaveClass(styles.custom)

      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 300 })

      expect(diamonds(container)[1]).not.toHaveClass(styles.dragging)

      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
    })

    it('will not drag a preset keyframe', () => {
      store().updateClipAnimation('clip1', {
        in: { type: 'fade', duration: 1, easing: 'ease-out' },
        keyframes: {},
      })
      const { container, onKeyframeMoved } = renderTrack('opacity')
      measureTrack(container)
      const preset = diamonds(container)[1]
      expect(preset).toHaveClass(styles.preset)

      fireEvent.mouseDown(preset, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 300 })
      fireEvent.mouseUp(window)

      expect(onKeyframeMoved).not.toHaveBeenCalled()
    })
  })
})
