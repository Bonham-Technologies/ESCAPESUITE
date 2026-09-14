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

const CLIP_DURATION = 4.3

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
  const clip = currentClip()
  const onKeyframeMoved = vi.fn()
  const onKeyframeValueChanged = vi.fn()
  const onAddKeyframe = vi.fn()
  const onDeleteKeyframe = vi.fn()
  const onKeyframeEasingChanged = vi.fn()
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

const graphSvg = (container: HTMLElement) => container.querySelector('svg')!

/** An opacity curve with a user keyframe at 1s; the store adds one at 0s. */
function opacityKeyframes() {
  store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
}

describe('KeyframeGraph keyboard access', () => {
  // Stands in for the editor's own window-level keydown listeners: anything this
  // spy sees with the graph focused is a key the graph failed to claim.
  let seen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetStoreForTest()
    addClip('clip1', 0, CLIP_DURATION)
    seen = vi.fn()
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

  it('lets Delete through to the editor when no keyframe is selected', async () => {
    const user = userEvent.setup()
    opacityKeyframes()
    const { container, onDeleteKeyframe } = renderGraph('opacity')

    graphSvg(container).focus()
    await user.keyboard('{Delete}')

    // Deliberate: a focused graph with nothing selected does not swallow the
    // editor's "delete the selected clip" shortcut.
    expect(onDeleteKeyframe).not.toHaveBeenCalled()
    expect(seen).toHaveBeenCalledTimes(1)
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
})
