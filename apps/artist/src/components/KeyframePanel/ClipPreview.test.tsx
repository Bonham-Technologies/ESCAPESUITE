import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ClipPreview } from './ClipPreview'
import { resetStoreForTest, addClip } from '../../test/fixtures/projectStore'
import type { Clip } from '../../store/types'
import styles from './ClipPreview.module.css'

/** Give the scrubber a real box: jsdom reports every rect as zero-sized. */
function measureScrubber(container: HTMLElement, left = 200, width = 400): HTMLElement {
  const scrubber = container.querySelector<HTMLElement>(`.${styles.scrubber}`)!
  scrubber.getBoundingClientRect = () =>
    ({ left, top: 0, width, height: 10, right: left + width, bottom: 10, x: left, y: 0 }) as DOMRect
  return scrubber
}

function renderPreview(clip: Clip, playheadTime = 0) {
  const onTimeChange = vi.fn()
  const view = render(
    <ClipPreview clip={clip} playheadTime={playheadTime} onTimeChange={onTimeChange} />
  )
  return { ...view, onTimeChange }
}

describe('ClipPreview', () => {
  let clip: Clip

  beforeEach(() => {
    resetStoreForTest()
    clip = { ...addClip('clip1', 0, 4), name: 'intro.mp4' }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names the clip and reports the playhead against the clip duration', () => {
    renderPreview(clip, 1.5)

    expect(screen.getByText('intro.mp4')).toBeInTheDocument()
    expect(screen.getByText('1.50s / 4.00s')).toBeInTheDocument()
  })

  it('fills the scrubber in proportion to the playhead', () => {
    const { container } = renderPreview(clip, 1)

    expect(container.querySelector<HTMLElement>(`.${styles.scrubberFill}`)!.style.width).toBe('25%')
    expect(container.querySelector<HTMLElement>(`.${styles.scrubberHandle}`)!.style.left).toBe('25%')
  })

  describe('playback', () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'],
      })
    })

    it('does not advance the time while paused', () => {
      const { onTimeChange } = renderPreview(clip, 0)

      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(onTimeChange).not.toHaveBeenCalled()
    })

    it('advances the time in real time once playing', () => {
      const { onTimeChange } = renderPreview(clip, 0)

      fireEvent.click(screen.getByRole('button'))
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(onTimeChange).toHaveBeenCalled()
      const calls = onTimeChange.mock.calls
      const reached = calls[calls.length - 1][0] as number
      expect(reached).toBeGreaterThan(0.4)
      expect(reached).toBeLessThanOrEqual(0.5)
    })

    it('loops back to the clip start when playback runs past the end', () => {
      const { onTimeChange } = renderPreview(clip, 3.9)

      fireEvent.click(screen.getByRole('button'))
      act(() => {
        vi.advanceTimersByTime(200)
      })

      const times = onTimeChange.mock.calls.map((c) => c[0] as number)
      expect(Math.max(...times)).toBeLessThanOrEqual(4)
      expect(times.some((t) => t < 0.2)).toBe(true)
    })

    it('stops advancing when playback is paused again', () => {
      const { container, onTimeChange } = renderPreview(clip, 0)
      const playButton = screen.getByRole('button')

      fireEvent.click(playButton)
      act(() => {
        vi.advanceTimersByTime(100)
      })
      // While playing the button shows the two pause bars.
      expect(container.querySelectorAll('rect')).toHaveLength(2)

      fireEvent.click(playButton)
      onTimeChange.mockClear()
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(onTimeChange).not.toHaveBeenCalled()
      expect(container.querySelectorAll('polygon')).toHaveLength(1)
    })
  })

  describe('scrubbing', () => {
    it('seeks to the point that was pressed', () => {
      const { container, onTimeChange } = renderPreview(clip, 0)
      const scrubber = measureScrubber(container)

      fireEvent.mouseDown(scrubber, { clientX: 300 })

      // 100px into a 400px scrubber over a 4s clip.
      expect(onTimeChange).toHaveBeenLastCalledWith(1)
    })

    it('follows the pointer while the button is held', () => {
      const { container, onTimeChange } = renderPreview(clip, 0)
      const scrubber = measureScrubber(container)

      fireEvent.mouseDown(scrubber, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 400 })

      expect(onTimeChange).toHaveBeenLastCalledWith(2)
    })

    it('clamps a drag that leaves either end of the scrubber', () => {
      const { container, onTimeChange } = renderPreview(clip, 0)
      const scrubber = measureScrubber(container)

      fireEvent.mouseDown(scrubber, { clientX: 300 })
      fireEvent.mouseMove(window, { clientX: -50 })
      expect(onTimeChange).toHaveBeenLastCalledWith(0)

      fireEvent.mouseMove(window, { clientX: 5000 })
      expect(onTimeChange).toHaveBeenLastCalledWith(4)
    })

    it('ignores pointer movement once the button is released', () => {
      const { container, onTimeChange } = renderPreview(clip, 0)
      const scrubber = measureScrubber(container)

      fireEvent.mouseDown(scrubber, { clientX: 300 })
      fireEvent.mouseUp(window)
      onTimeChange.mockClear()

      fireEvent.mouseMove(window, { clientX: 400 })

      expect(onTimeChange).not.toHaveBeenCalled()
    })

    it('marks the scrubber as dragging only while the button is held', () => {
      const { container } = renderPreview(clip, 0)
      const scrubber = measureScrubber(container)

      expect(scrubber).not.toHaveClass(styles.scrubberDragging)
      fireEvent.mouseDown(scrubber, { clientX: 300 })
      expect(scrubber).toHaveClass(styles.scrubberDragging)
      fireEvent.mouseUp(window)
      expect(scrubber).not.toHaveClass(styles.scrubberDragging)
    })
  })
})
