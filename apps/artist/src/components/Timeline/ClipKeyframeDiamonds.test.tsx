import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ClipKeyframeDiamonds } from './ClipKeyframeDiamonds'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { Clip } from '../../store/types'
import styles from './ClipKeyframeDiamonds.module.css'

function clipWithKeyframes(): Clip {
  const clip = addClip('clip1', 0, 4)
  // Two properties sharing a time, so the de-duplication is exercised.
  store().setClipKeyframe(clip.id, 'opacity', { time: 1, value: 0.5, easing: 'linear' })
  store().setClipKeyframe(clip.id, 'scaleX', { time: 1, value: 2, easing: 'linear' })
  store().setClipKeyframe(clip.id, 'rotation', { time: 3, value: 90, easing: 'linear' })
  return store().project.timeline.clips.find((c) => c.id === clip.id)!
}

function diamonds(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`.${styles.diamond}`))
}

describe('ClipKeyframeDiamonds', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('renders nothing for a clip with no animation at all', () => {
    const clip = addClip('clip1', 0, 4)

    const { container } = render(<ClipKeyframeDiamonds clip={clip} pixelsPerSecond={50} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the animation holds no keyframes', () => {
    const clip = addClip('clip1', 0, 4)
    store().setClipKeyframe(clip.id, 'opacity', { time: 1, value: 0.5, easing: 'linear' })
    store().removeClipKeyframe(clip.id, 'opacity', 1)
    store().removeClipKeyframe(clip.id, 'opacity', 0)
    const emptied = store().project.timeline.clips[0]

    const { container } = render(<ClipKeyframeDiamonds clip={emptied} pixelsPerSecond={50} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('places one diamond per distinct keyframe time, in ascending order', () => {
    const clip = clipWithKeyframes()

    const { container } = render(<ClipKeyframeDiamonds clip={clip} pixelsPerSecond={50} />)

    // 0 (auto-created start keyframes), 1 (shared by opacity + scaleX) and 3.
    const rendered = diamonds(container)
    expect(rendered.map((d) => d.style.left)).toEqual(['0px', '50px', '150px'])
  })

  it('scales the diamond positions with the timeline zoom', () => {
    const clip = clipWithKeyframes()

    const { container } = render(<ClipKeyframeDiamonds clip={clip} pixelsPerSecond={200} />)

    expect(diamonds(container).map((d) => d.style.left)).toEqual(['0px', '200px', '600px'])
  })

  it('labels each diamond with its time', () => {
    const clip = clipWithKeyframes()

    const { container } = render(<ClipKeyframeDiamonds clip={clip} pixelsPerSecond={50} />)

    expect(diamonds(container).map((d) => d.title)).toEqual([
      'Keyframe @ 0.00s',
      'Keyframe @ 1.00s',
      'Keyframe @ 3.00s',
    ])
  })
})
