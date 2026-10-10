import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyframePanel } from './KeyframePanel'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, addClip, video } from '../../test/fixtures/projectStore'
import type { Clip } from '../../store/types'
import panelStyles from './KeyframePanel.module.css'
import trackStyles from './KeyframeTrack.module.css'
import graphStyles from './KeyframeGraph.module.css'

const CLIP_DURATION = 4.3

function openPanelWithClip(): Clip {
  const clip = addClip('clip1', 0, CLIP_DURATION)
  store().setSelectedClipId('clip1')
  store().setKeyframePanelOpen(true)
  return clip
}

/** The row for one animatable property; its label is a direct child. */
const trackFor = (label: string) =>
  screen.getAllByText(label).find((el) => el.className === trackStyles.label)!.parentElement!

function measureTrackArea(label: string, left = 100, width = 430): HTMLElement {
  const area = trackFor(label).querySelector<HTMLElement>(`.${trackStyles.trackArea}`)!
  area.getBoundingClientRect = () =>
    ({ left, top: 0, width, height: 20, right: left + width, bottom: 20, x: left, y: 0 }) as DOMRect
  return area
}

function measureGraph(): SVGSVGElement {
  const svg = document.body.querySelector<SVGSVGElement>(`.${graphStyles.graph}`)!
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 500, height: 200, right: 500, bottom: 200, x: 0, y: 0 }) as DOMRect
  return svg
}

const graphPoints = () =>
  Array.from(document.body.querySelectorAll<SVGCircleElement>(`.${graphStyles.keyframePoint}`))

const keyframesOf = (property: string) =>
  store().project.timeline.clips[0].animation?.keyframes[
    property as keyof NonNullable<Clip['animation']>['keyframes']
  ]

describe('KeyframePanel', () => {
  beforeEach(() => {
    // The panel also persists its layout in localStorage, which the store
    // reset knows nothing about.
    localStorage.clear()
    resetStoreForTest()
  })

  it('renders nothing while the panel is closed', () => {
    openPanelWithClip()
    store().setKeyframePanelOpen(false)

    render(<KeyframePanel />)

    expect(screen.queryByText('Keyframe Editor')).not.toBeInTheDocument()
  })

  it('renders into the document body rather than its own container', () => {
    openPanelWithClip()

    const { container } = render(<KeyframePanel />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.getByText('Keyframe Editor')).toBeInTheDocument()
  })

  it('asks for a clip when nothing is selected', () => {
    store().setKeyframePanelOpen(true)

    render(<KeyframePanel />)

    expect(screen.getByText('Select a clip to edit keyframes')).toBeInTheDocument()
    expect(screen.queryByText('Opacity')).not.toBeInTheDocument()
  })

  it('names the selected clip and lists every visual property', () => {
    openPanelWithClip()

    render(<KeyframePanel />)

    expect(
      document.body.querySelector(`.${panelStyles.clipName}`)
    ).toHaveTextContent('clip1')
    for (const label of ['Position X', 'Position Y', 'Scale X', 'Scale Y', 'Rotation', 'Opacity', 'Blur']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByText('Volume')).not.toBeInTheDocument()
  })

  it('adds the audio section for a source that carries audio', () => {
    store().addSourceVideo({ ...video, id: 'withAudio', name: 'talk.mp4', hasAudio: true })
    const clip = addClip('clip1', 0, CLIP_DURATION)
    useEditorStore.setState({
      project: {
        ...store().project,
        timeline: {
          ...store().project.timeline,
          clips: [{ ...clip, sourceVideoId: 'withAudio' }],
        },
      },
    })
    store().setSelectedClipId('clip1')
    store().setKeyframePanelOpen(true)

    render(<KeyframePanel />)

    expect(screen.getByText('Audio')).toBeInTheDocument()
    expect(screen.getByText('Volume')).toBeInTheDocument()
  })

  it('adds the audio section for an audio-only source', () => {
    store().addSourceVideo({ ...video, id: 'music', name: 'bed.mp3', mediaType: 'audio' })
    const clip = addClip('clip1', 0, CLIP_DURATION)
    useEditorStore.setState({
      project: {
        ...store().project,
        timeline: {
          ...store().project.timeline,
          clips: [{ ...clip, sourceVideoId: 'music' }],
        },
      },
    })
    store().setSelectedClipId('clip1')
    store().setKeyframePanelOpen(true)

    render(<KeyframePanel />)

    expect(screen.getByText('Volume')).toBeInTheDocument()
  })

  it('leaves the audio section out when the clip has no source media', () => {
    const clip = addClip('clip1', 0, CLIP_DURATION)
    useEditorStore.setState({
      project: {
        ...store().project,
        timeline: {
          ...store().project.timeline,
          clips: [{ ...clip, sourceVideoId: 'missing' }],
        },
      },
    })
    store().setSelectedClipId('clip1')
    store().setKeyframePanelOpen(true)

    render(<KeyframePanel />)

    expect(screen.queryByText('Volume')).not.toBeInTheDocument()
  })

  it('closes the panel from the title bar button', async () => {
    const user = userEvent.setup()
    openPanelWithClip()
    render(<KeyframePanel />)

    await user.click(screen.getByRole('button', { name: 'Close keyframe panel' }))

    expect(store().keyframePanelState.isOpen).toBe(false)
    expect(screen.queryByText('Keyframe Editor')).not.toBeInTheDocument()
  })

  describe('choosing a property', () => {
    it('opens the graph for the property whose track is clicked', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      await user.click(trackFor('Rotation'))

      expect(store().keyframePanelState.selectedProperty).toBe('rotation')
      expect(document.body.querySelector(`.${graphStyles.graph}`)).not.toBeNull()
      expect(screen.getAllByText('Rotation')).toHaveLength(2) // graph header + track label
    })

    it('closes the graph when the same track is clicked again', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      await user.click(trackFor('Opacity'))
      await user.click(trackFor('Opacity'))

      expect(store().keyframePanelState.selectedProperty).toBeNull()
      expect(document.body.querySelector(`.${graphStyles.graph}`)).toBeNull()
    })

    it('closes the graph from its own close button', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      await user.click(trackFor('Opacity'))
      const header = document.body.querySelector<HTMLElement>(`.${panelStyles.graphHeader}`)!
      await user.click(within(header).getByRole('button'))

      expect(store().keyframePanelState.selectedProperty).toBeNull()
    })

    it('starts the graph fresh when another clip is selected', () => {
      openPanelWithClip()
      addClip('clip2', 10, CLIP_DURATION)
      // Again a keyframe at the same time on both, so an active option carried
      // over from the first clip would land on the second clip's keyframe.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip2', 'opacity', { time: 1, value: 0.25, easing: 'linear' })
      store().setKeyframePanelSelectedProperty('opacity')
      render(<KeyframePanel />)

      const svg = measureGraph()
      svg.focus()
      fireEvent.keyDown(svg, { key: 'End' })
      expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-1')

      store().setSelectedClipId('clip2')

      expect(measureGraph().getAttribute('aria-activedescendant')).toBeNull()
      expect(screen.queryByLabelText('Keyframe easing')).not.toBeInTheDocument()
    })

    it('starts the graph fresh when another property is chosen', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      // A keyframe at the same time on both properties: an active time carried
      // over from the opacity graph would land on the rotation keyframe and
      // select a keyframe the user never touched.
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip1', 'rotation', { time: 1, value: 45, easing: 'linear' })
      store().setKeyframePanelSelectedProperty('opacity')
      render(<KeyframePanel />)

      const svg = measureGraph()
      svg.focus()
      fireEvent.keyDown(svg, { key: 'End' })
      expect(svg.getAttribute('aria-activedescendant')).toBe('kf-opacity-1')
      expect(screen.getByLabelText('Keyframe easing')).toBeInTheDocument()

      await user.click(trackFor('Rotation'))

      expect(measureGraph().getAttribute('aria-activedescendant')).toBeNull()
      expect(screen.queryByLabelText('Keyframe easing')).not.toBeInTheDocument()
    })
  })

  describe('adding keyframes from a track', () => {
    it('takes the starting value from the clip transform', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      // 200px into a 430px track over a 4.3s clip = 2s.
      fireEvent.doubleClick(measureTrackArea('Position X'), { clientX: 300 })

      expect(keyframesOf('x')).toEqual([
        { time: 0, value: 0.5, easing: 'ease-out' },
        { time: 2, value: 0.5, easing: 'ease-in-out' },
      ])
    })

    it('takes the starting value from the clip blur effect', () => {
      openPanelWithClip()
      store().updateClipEffects('clip1', { blur: 8 })
      render(<KeyframePanel />)

      fireEvent.doubleClick(measureTrackArea('Blur'), { clientX: 100 })

      expect(keyframesOf('blur')).toEqual([{ time: 0, value: 8, easing: 'ease-in-out' }])
    })

    it('starts a volume keyframe at full volume', () => {
      store().addSourceVideo({ ...video, id: 'music', name: 'bed.mp3', mediaType: 'audio' })
      const clip = addClip('clip1', 0, CLIP_DURATION)
      useEditorStore.setState({
        project: {
          ...store().project,
          timeline: {
            ...store().project.timeline,
            clips: [{ ...clip, sourceVideoId: 'music' }],
          },
        },
      })
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
      render(<KeyframePanel />)

      fireEvent.doubleClick(measureTrackArea('Volume'), { clientX: 100 })

      expect(keyframesOf('volume')).toEqual([{ time: 0, value: 1, easing: 'ease-in-out' }])
    })
  })

  // Review round 1, MAJOR 1 + MINOR 6 gave every property row's diamond drag
  // ONE shared live region, owned by the panel — originally exercised here by
  // dragging a diamond onto a neighbour twice, to prove a second identical
  // refusal re-reads audibly (the alternating zero-width mark). ESCSUITE-183's
  // clamp means a mouse drag can no longer reach that refusal at all (the
  // point stops at the neighbour's epsilon window instead of landing on it
  // and bouncing back), so these two cases now prove the opposite: the clamp
  // lands the drop, through the same shared region, with nothing to announce.
  describe('a diamond row drag clamps away from an occupied neighbour (ESCSUITE-167/179, superseded by 183)', () => {
    const diamondsIn = (label: string) =>
      Array.from(trackFor(label).querySelectorAll<HTMLElement>(`.${trackStyles.diamond}`))

    beforeEach(() => {
      openPanelWithClip()
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.75, easing: 'linear' })
    })

    it('lands a drop aimed exactly at a neighbour, through the shared live region, with nothing to announce', () => {
      render(<KeyframePanel />)
      measureTrackArea('Opacity')
      // Keyframes sit at 0, 1 and 2 seconds; drag the one at 1s onto the one
      // at 2s (200px and 300px into a 430px/4.3s track, left offset 100).
      const custom = diamondsIn('Opacity')[1]

      fireEvent.mouseDown(custom, { clientX: 200 })
      fireEvent.mouseMove(window, { clientX: 300 })
      fireEvent.mouseUp(window)

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      // All three keyframes survive — the dragged one stops just SHORT of 2s,
      // the side it approached from, rather than destroying the neighbour
      // sitting there or being thrown past it (review of ESCSUITE-183,
      // finding 2).
      const times = keyframesOf('opacity')!.map((kf) => kf.time)
      expect(times).toHaveLength(3)
      expect(times.some((t) => t < 2 && t > 1.99)).toBe(true)
    })

    it('lands a drop aimed at the same neighbour from the other side too, never announcing a refusal', () => {
      // A fourth keyframe above the neighbour, so this case can approach it
      // from above rather than reusing the first case's own moved point —
      // the diamonds re-sort by time after a landed drag, so a DOM reference
      // captured before one no longer names the same keyframe after it.
      store().setClipKeyframe('clip1', 'opacity', { time: 3, value: 0.4, easing: 'linear' })
      render(<KeyframePanel />)
      measureTrackArea('Opacity')
      // Keyframes sit at 0, 1, 2 and 3 seconds; drag the one at 3s down past
      // the one at 2s and fractionally into its window (299.95px is 1.9995s).
      // The pointer came from above, so the point stops at the window's upper
      // edge rather than carrying on through to the other side.
      const custom = diamondsIn('Opacity')[3]

      fireEvent.mouseDown(custom, { clientX: 400 })
      fireEvent.mouseMove(window, { clientX: 299.95 })
      fireEvent.mouseUp(window)

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      const times = keyframesOf('opacity')!.map((kf) => kf.time)
      expect(times).toHaveLength(4)
      expect(times.some((t) => t > 2 && t < 2.01)).toBe(true)
    })
  })

  describe('editing keyframes in the graph', () => {
    beforeEach(() => {
      openPanelWithClip()
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setKeyframePanelSelectedProperty('opacity')
    })

    it('moves a keyframe in time when it is dragged sideways', () => {
      render(<KeyframePanel />)
      measureGraph()

      fireEvent.mouseDown(graphPoints()[1], { altKey: true })
      fireEvent.mouseMove(window, { clientX: 50 + 100 * 3, clientY: 95 })
      fireEvent.mouseUp(window)

      expect(keyframesOf('opacity')!.map((kf) => kf.time)).toEqual([0, 3])
    })

    // ESCSUITE-163 / M1: a diagonal drag used to commit the move synchronously
    // and the value in a setTimeout(…, 0) — two writes, two undo entries, so
    // one Ctrl+Z put the value back but left the keyframe at its new time
    // (exactly the ESCSUITE-79 shape the clip drag was fixed for).
    it('moves a keyframe in time and value together as a single undo entry', () => {
      render(<KeyframePanel />)
      measureGraph()
      const historyBefore = store().history.past.length

      // t=3 (x = 50 + 100*3), value=0.2 (y = 20 + (1-0.2)*150).
      fireEvent.mouseDown(graphPoints()[1])
      fireEvent.mouseMove(window, { clientX: 50 + 100 * 3, clientY: 20 + (1 - 0.2) * 150 })
      fireEvent.mouseUp(window)

      const moved = keyframesOf('opacity')![1]
      expect(moved.time).toBe(3)
      expect(moved.value).toBeCloseTo(0.2, 6)
      expect(moved.easing).toBe('linear')
      expect(store().history.past).toHaveLength(historyBefore + 1)

      // One undo restores BOTH halves of the drag, not just the value.
      store().undo()
      expect(keyframesOf('opacity')![1]).toEqual({ time: 1, value: 0.5, easing: 'linear' })
    })

    // ESCSUITE-183, review finding 9: the combination the clamp newly makes
    // reachable — a time the clamp decided AND a value, in one gesture — had no
    // store-level pin. Before the clamp this drop was refused outright on
    // release, so neither half was written at all; now both land, and they must
    // land as ONE undo entry (ESCSUITE-163 / M1's rule, which the refusal used
    // to keep this case out of).
    it('makes a CLAMPED diagonal drag a single undo entry too, restoring both halves', () => {
      // A neighbour at 3s for the drag to be clamped by.
      store().setClipKeyframe('clip1', 'opacity', { time: 3, value: 0.8, easing: 'linear' })
      render(<KeyframePanel />)
      measureGraph()
      const historyBefore = store().history.past.length

      // Aimed exactly at the 3s neighbour, from the left, with the value
      // changing too: the time clamps to the window's near edge, the value
      // lands where the pointer put it.
      fireEvent.mouseDown(graphPoints()[1])
      fireEvent.mouseMove(window, { clientX: 50 + 100 * 3, clientY: 20 + (1 - 0.2) * 150 })
      fireEvent.mouseUp(window)

      const moved = keyframesOf('opacity')![1]
      expect(moved.time).toBeLessThan(3)
      expect(moved.time).toBeCloseTo(3, 2)
      expect(moved.value).toBeCloseTo(0.2, 6)
      expect(store().history.past).toHaveLength(historyBefore + 1)
      // All three keyframes are still there — the neighbour was not destroyed.
      expect(keyframesOf('opacity')).toHaveLength(3)

      // One undo puts back the time AND the value, not just one of them.
      store().undo()
      expect(keyframesOf('opacity')![1]).toEqual({ time: 1, value: 0.5, easing: 'linear' })
    })

    it('changes a keyframe value, keeping its easing, when it is dragged vertically', () => {
      render(<KeyframePanel />)
      measureGraph()

      // y = 20 + (1 - value) * 150 → y = 170 is opacity 0.
      fireEvent.mouseDown(graphPoints()[1], { shiftKey: true })
      fireEvent.mouseMove(window, { clientX: 50 + 100, clientY: 170 })
      fireEvent.mouseUp(window)

      expect(keyframesOf('opacity')![1]).toEqual({ time: 1, value: 0, easing: 'linear' })
    })

    it('changes a keyframe value, keeping its easing, when it is nudged from the keyboard', () => {
      render(<KeyframePanel />)
      const svg = measureGraph()
      svg.focus()

      // Two keyframes: the store's own at 0s, then the user's at 1s.
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      fireEvent.keyDown(svg, { key: 'ArrowUp' })

      const nudged = keyframesOf('opacity')![1]
      expect(nudged.time).toBe(1)
      expect(nudged.value).toBeCloseTo(0.51, 6)
      expect(nudged.easing).toBe('linear')
    })

    // Auto-repeat, end to end: the keydown's `repeat` flag reaches the store as
    // `skipHistory`, so one held key spends one undo slot instead of one per
    // repeat (MAX_HISTORY_SIZE is 50, which a held key would empty in about a
    // second). `userEvent.keyboard` never sets `repeat`, so the repeats have to
    // be fireEvent.
    it('makes a held arrow key a single undo step', () => {
      render(<KeyframePanel />)
      const svg = measureGraph()
      svg.focus()
      const historyBefore = store().history.past.length

      // Two keyframes: the store's own at 0s, then the user's at 1s.
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      fireEvent.keyDown(svg, { key: 'ArrowRight' })

      // One press and three auto-repeats — what the browser sends for one held
      // key: four fine steps of the value, one entry on the undo stack.
      fireEvent.keyDown(svg, { key: 'ArrowUp' })
      fireEvent.keyDown(svg, { key: 'ArrowUp', repeat: true })
      fireEvent.keyDown(svg, { key: 'ArrowUp', repeat: true })
      fireEvent.keyDown(svg, { key: 'ArrowUp', repeat: true })

      expect(keyframesOf('opacity')![1].value).toBeCloseTo(0.54, 6)
      expect(store().history.past).toHaveLength(historyBefore + 1)

      // Releasing and pressing again starts a new step.
      fireEvent.keyDown(svg, { key: 'ArrowUp' })
      expect(keyframesOf('opacity')![1].value).toBeCloseTo(0.55, 6)
      expect(store().history.past).toHaveLength(historyBefore + 2)

      // And the two steps undo to the two boundaries, not to the individual
      // repeats in between.
      store().undo()
      expect(keyframesOf('opacity')![1].value).toBeCloseTo(0.54, 6)
      store().undo()
      expect(keyframesOf('opacity')![1].value).toBeCloseTo(0.5, 6)
    })

    it('deletes a keyframe on right-click', () => {
      render(<KeyframePanel />)
      measureGraph()

      fireEvent.contextMenu(graphPoints()[1])

      expect(keyframesOf('opacity')!.map((kf) => kf.time)).toEqual([0])
    })

    it('changes the easing of the keyframe selected in the graph', async () => {
      const user = userEvent.setup()
      render(<KeyframePanel />)
      measureGraph()

      fireEvent.click(graphPoints()[1])
      await user.selectOptions(screen.getByLabelText('Keyframe easing'), 'ease-in-cubic')

      // Same keyframe, same time and value — only the curve moved.
      expect(keyframesOf('opacity')).toEqual([
        { time: 0, value: 1, easing: 'ease-out' },
        { time: 1, value: 0.5, easing: 'ease-in-cubic' },
      ])
    })

    it('makes the easing change a single undo step', async () => {
      const user = userEvent.setup()
      render(<KeyframePanel />)
      measureGraph()
      const historyBefore = store().history.past.length

      fireEvent.click(graphPoints()[1])
      await user.selectOptions(screen.getByLabelText('Keyframe easing'), 'ease-in-cubic')

      expect(store().history.past).toHaveLength(historyBefore + 1)
      store().undo()
      expect(keyframesOf('opacity')![1]).toEqual({ time: 1, value: 0.5, easing: 'linear' })
    })

    // The select renders from the panel's memoized clip, and the handler reads the
    // store fresh — so a keyframe deleted between the render and the change event is
    // still on screen when the change arrives. Both happen in one `act()` here, which
    // is what keeps the stale select mounted long enough to fire. The handler's
    // `if (!existingKf) return` is what stops that writing a keyframe back.
    it('ignores an easing change for a keyframe that has just been deleted', () => {
      render(<KeyframePanel />)
      measureGraph()
      fireEvent.click(graphPoints()[1])
      const select = screen.getByLabelText('Keyframe easing')
      const historyBefore = store().history.past.length

      act(() => {
        useEditorStore.getState().removeClipKeyframe('clip1', 'opacity', 1)
        fireEvent.change(select, { target: { value: 'ease-in-cubic' } })
      })

      // Only the deletion reached the store: the keyframe is gone, not re-created,
      // and the change added no second history entry.
      expect(keyframesOf('opacity')!.map((kf) => kf.time)).toEqual([0])
      expect(store().history.past).toHaveLength(historyBefore + 1)
    })

    it('adds a keyframe where the graph is double-clicked', () => {
      render(<KeyframePanel />)
      const svg = measureGraph()

      fireEvent.doubleClick(svg, { clientX: 50 + 100 * 3, clientY: 170 })

      const added = keyframesOf('opacity')!.find((kf) => Math.abs(kf.time - 3) < 0.001)
      expect(added).toEqual({ time: 3, value: 0, easing: 'ease-in-out' })
    })
  })

  describe('the playhead', () => {
    it('follows the main timeline, relative to the clip start', () => {
      addClip('clip1', 2, CLIP_DURATION)
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
      store().setCurrentTime(3.5)

      render(<KeyframePanel />)

      expect(screen.getByText(`1.50s / ${CLIP_DURATION.toFixed(2)}s`)).toBeInTheDocument()
    })

    it('sits at the clip start when the timeline playhead is outside the clip', () => {
      addClip('clip1', 2, CLIP_DURATION)
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
      store().setCurrentTime(20)

      render(<KeyframePanel />)

      expect(screen.getByText(`0.00s / ${CLIP_DURATION.toFixed(2)}s`)).toBeInTheDocument()
    })

    it('moves the main timeline when the clip preview is scrubbed', () => {
      addClip('clip1', 2, CLIP_DURATION)
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
      render(<KeyframePanel />)

      const scrubber = document.body.querySelector<HTMLElement>('[class*="scrubber"]')!
      scrubber.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 430, height: 10, right: 430, bottom: 10, x: 0, y: 0 }) as DOMRect
      fireEvent.mouseDown(scrubber, { clientX: 100 })

      const expected = (100 / 430) * CLIP_DURATION
      expect(store().currentTime).toBeCloseTo(2 + expected, 6)
      expect(screen.getByText(`${expected.toFixed(2)}s / ${CLIP_DURATION.toFixed(2)}s`)).toBeInTheDocument()
    })

    // ESCSUITE-126: `previewTime` was the only thing `playheadTime` read once a
    // scrub had set it, and nothing ever reset it back to `null` — so the panel
    // latched at the last scrubbed offset and stopped following the timeline,
    // even though the timeline kept moving underneath it (playback, a seek from
    // the main player, undo/redo).
    it('follows the timeline again after a scrub, instead of latching', () => {
      addClip('clip1', 2, CLIP_DURATION)
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
      render(<KeyframePanel />)

      const scrubber = document.body.querySelector<HTMLElement>('[class*="scrubber"]')!
      scrubber.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 430, height: 10, right: 430, bottom: 10, x: 0, y: 0 }) as DOMRect
      fireEvent.mouseDown(scrubber, { clientX: 100 }) // previews 1.00s

      // The timeline moves on its own after the scrub — a seek, playback, undo.
      act(() => store().setCurrentTime(2.5))

      expect(screen.getByText(`0.50s / ${CLIP_DURATION.toFixed(2)}s`)).toBeInTheDocument()
    })

    it('adds a keyframe at the timeline\'s offset, not the stale scrub, once the timeline has moved', () => {
      addClip('clip1', 2, CLIP_DURATION)
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
      store().setKeyframePanelSelectedProperty('opacity')
      render(<KeyframePanel />)
      const svg = measureGraph()

      const scrubber = document.body.querySelector<HTMLElement>('[class*="scrubber"]')!
      scrubber.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 430, height: 10, right: 430, bottom: 10, x: 0, y: 0 }) as DOMRect
      fireEvent.mouseDown(scrubber, { clientX: 100 }) // previews 1.00s

      act(() => store().setCurrentTime(4)) // timeline moves to clip-relative 2.00s

      svg.focus()
      fireEvent.keyDown(svg, { key: 'Enter' })

      const added = keyframesOf('opacity')!.find((kf) => Math.abs(kf.time - 2) < 0.001)
      expect(added).toBeDefined()
    })
  })

  // ESCSUITE-88. The store has always refused an edit to a clip on a locked
  // track; the panel used to let the user try and say nothing at all.
  describe('a locked track (ESCSUITE-88)', () => {
    const NOTICE = 'Track locked — unlock it in the timeline to edit keyframes'

    const lockTrack = () => {
      store().updateTrack(store().project.timeline.clips[0].trackId, { locked: true })
    }

    it('says the track is locked, and says nothing while it is not', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()

      lockTrack()

      expect(screen.getByText(NOTICE)).toBeInTheDocument()
    })

    it('disables the easing select on the selected keyframe', () => {
      openPanelWithClip()
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      store().setKeyframePanelSelectedProperty('opacity')
      lockTrack()
      render(<KeyframePanel />)
      measureGraph()

      fireEvent.click(graphPoints()[1])

      expect(screen.getByLabelText('Keyframe easing')).toBeDisabled()
    })

    it('adds no keyframe when a property track is double-clicked', () => {
      openPanelWithClip()
      lockTrack()
      render(<KeyframePanel />)

      fireEvent.doubleClick(measureTrackArea('Position X'), { clientX: 300 })

      expect(keyframesOf('x')).toBeUndefined()
    })
  })

  describe('panel layout', () => {
    it('remembers a new position after the title bar is dragged', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      const titleBar = screen.getByText('Keyframe Editor').parentElement!
      fireEvent.mouseDown(titleBar, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(window, { clientX: 40, clientY: 30 })
      fireEvent.mouseUp(window)

      expect(store().keyframePanelState.position).toEqual({ x: 140, y: 130 })
      const panel = document.body.querySelector<HTMLElement>(`.${panelStyles.panel}`)!
      expect(panel.style.left).toBe('140px')
      expect(panel.style.top).toBe('130px')
    })

    it('remembers a new size after a corner is dragged', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      const handle = document.body.querySelector<HTMLElement>(`.${panelStyles.resizeSE}`)!
      fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(window, { clientX: 100, clientY: 100 })
      fireEvent.mouseUp(window)

      expect(store().keyframePanelState.size).toEqual({ width: 800, height: 620 })
    })

    // The panel starts 700x520 and will not shrink below 500x500, so a
    // 60px drag away from the origin grows an east/south edge by 60 and is
    // clipped at the minimum on a west/north one.
    it.each([
      ['resizeN', 700, 500],
      ['resizeS', 700, 580],
      ['resizeE', 760, 520],
      ['resizeW', 640, 520],
      ['resizeNE', 760, 500],
      ['resizeNW', 640, 500],
      ['resizeSE', 760, 580],
      ['resizeSW', 640, 580],
    ] as const)('resizes to %s from the %s handle', (handleClass, width, height) => {
      openPanelWithClip()
      render(<KeyframePanel />)

      const handle = document.body.querySelector<HTMLElement>(`.${panelStyles[handleClass]}`)!
      fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(window, { clientX: 60, clientY: 60 })
      fireEvent.mouseUp(window)

      expect(store().keyframePanelState.size).toEqual({ width, height })
    })
  })
  // ESCSUITE-243: the rows were `<div onClick>`, so the graph's whole keyboard
  // model was reachable only by a mouse.
  describe('keyboard access (ESCSUITE-243)', () => {
    const ROWS = ['Position X', 'Position Y', 'Scale X', 'Scale Y', 'Rotation', 'Opacity', 'Blur']
    const row = (name: string) => screen.getByRole('button', { name })
    const withAudioClip = () => {
      store().addSourceVideo({ ...video, id: 'withAudio', name: 'talk.mp4', hasAudio: true })
      const clip = addClip('clip1', 0, CLIP_DURATION)
      useEditorStore.setState({
        project: {
          ...store().project,
          timeline: { ...store().project.timeline, clips: [{ ...clip, sourceVideoId: 'withAudio' }] },
        },
      })
      store().setSelectedClipId('clip1')
      store().setKeyframePanelOpen(true)
    }

    it('draws every property as a named button inside one labelled group', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      const group = screen.getByRole('group', { name: 'Animated properties' })
      const names = within(group).getAllByRole('button').map((b) => b.textContent)
      expect(names).toEqual(ROWS)
      for (const b of within(group).getAllByRole('button')) expect(b).toHaveAttribute('type', 'button')
    })

    it('puts the audio row in the same group and the same tab order', () => {
      withAudioClip()
      render(<KeyframePanel />)

      const group = screen.getByRole('group', { name: 'Animated properties' })
      expect(within(group).getByRole('button', { name: 'Volume' })).toBeInTheDocument()
    })

    it('marks only the open row as pressed', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      expect(row('Opacity')).toHaveAttribute('aria-pressed', 'false')
      await user.click(row('Opacity'))

      expect(row('Opacity')).toHaveAttribute('aria-pressed', 'true')
      expect(row('Blur')).toHaveAttribute('aria-pressed', 'false')
    })

    it('makes the first row the single tab stop while no row is open', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      expect(ROWS.map((r) => row(r).tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1])
    })

    it('moves the tab stop to the open row', () => {
      openPanelWithClip()
      store().setKeyframePanelSelectedProperty('opacity')
      render(<KeyframePanel />)

      expect(ROWS.map((r) => row(r).tabIndex)).toEqual([-1, -1, -1, -1, -1, 0, -1])
    })

    it('falls back to the first row when the open property has no row', () => {
      openPanelWithClip()
      store().setKeyframePanelSelectedProperty('volume')
      render(<KeyframePanel />)

      expect(ROWS.map((r) => row(r).tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1])
    })

    it('lets Tab reach the rows exactly once', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      screen.getByRole('button', { name: 'Play clip preview' }).focus()
      await user.tab()
      expect(document.activeElement).toBe(row('Position X'))

      await user.tab()
      expect(ROWS.map((r) => row(r))).not.toContain(document.activeElement)
    })

    it('moves between rows with ArrowDown and ArrowUp, wrapping at both ends', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      row('Position X').focus()
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(row('Position Y'))

      await user.keyboard('{ArrowUp}{ArrowUp}')
      expect(document.activeElement).toBe(row('Blur'))

      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(row('Position X'))
    })

    it('walks into the audio row and back', async () => {
      const user = userEvent.setup()
      withAudioClip()
      render(<KeyframePanel />)

      row('Blur').focus()
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(row('Volume'))
    })

    it('jumps to the first and last row with Home and End', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      row('Scale X').focus()
      await user.keyboard('{End}')
      expect(document.activeElement).toBe(row('Blur'))
      await user.keyboard('{Home}')
      expect(document.activeElement).toBe(row('Position X'))
    })

    it('leaves a key the rows do not use, and a browser chord, alone', () => {
      openPanelWithClip()
      render(<KeyframePanel />)
      const windowKeys = vi.fn()
      window.addEventListener('keydown', windowKeys)

      row('Scale X').focus()
      fireEvent.keyDown(row('Scale X'), { key: 'a' })
      fireEvent.keyDown(row('Scale X'), { key: 'ArrowDown', ctrlKey: true })
      fireEvent.keyDown(row('Scale X'), { key: 'ArrowDown', metaKey: true })
      fireEvent.keyDown(row('Scale X'), { key: 'ArrowDown', altKey: true })

      window.removeEventListener('keydown', windowKeys)
      expect(document.activeElement).toBe(row('Scale X'))
      expect(windowKeys).toHaveBeenCalledTimes(4)
    })

    it('keeps the arrows away from the editor shortcuts', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)
      const windowKeys = vi.fn()
      window.addEventListener('keydown', windowKeys)

      row('Position X').focus()
      await user.keyboard('{ArrowDown}')

      window.removeEventListener('keydown', windowKeys)
      expect(windowKeys).not.toHaveBeenCalled()
    })

    it('opens the graph on Enter and puts focus on it', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      row('Opacity').focus()
      await user.keyboard('{Enter}')

      expect(store().keyframePanelState.selectedProperty).toBe('opacity')
      expect(document.activeElement).toBe(
        screen.getByRole('listbox', { name: 'Keyframes for Opacity' })
      )
    })

    it('opens the graph on Space the same way', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      row('Rotation').focus()
      await user.keyboard(' ')

      expect(document.activeElement).toBe(
        screen.getByRole('listbox', { name: 'Keyframes for Rotation' })
      )
    })

    it('does not move focus into a graph that was already open when the panel mounted', () => {
      openPanelWithClip()
      store().setKeyframePanelSelectedProperty('opacity')
      render(<KeyframePanel />)

      expect(screen.getByRole('listbox', { name: 'Keyframes for Opacity' })).toBeInTheDocument()
      expect(document.activeElement).toBe(document.body)
    })

    it('focuses the graph only when a keyboard activation opened it, not when one closed it', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      row('Opacity').focus()
      await user.keyboard('{Enter}')
      expect(document.activeElement).toBe(screen.getByRole('listbox'))

      row('Opacity').focus()
      await user.keyboard('{Enter}')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(row('Opacity'))
    })

    it('opens the graph on a mouse click without moving focus into it', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)

      await user.click(row('Opacity'))

      expect(store().keyframePanelState.selectedProperty).toBe('opacity')
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(document.activeElement).not.toBe(screen.getByRole('listbox'))
      expect(document.activeElement).toBe(row('Opacity'))
    })

    it('does not move focus for a click anywhere else in the row either', () => {
      openPanelWithClip()
      render(<KeyframePanel />)

      fireEvent.click(measureTrackArea('Opacity'), { detail: 1 })

      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(document.activeElement).toBe(document.body)
    })

    it('does not pull focus into the graph when it is opened some other way later', () => {
      openPanelWithClip()
      render(<KeyframePanel />)
      screen.getByRole('button', { name: 'Play clip preview' }).focus()

      act(() => store().setKeyframePanelSelectedProperty('blur'))

      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(document.activeElement).not.toBe(screen.getByRole('listbox'))
    })

    it('Escape in the graph returns focus to the row that opened it, and stops there', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      render(<KeyframePanel />)
      row('Opacity').focus()
      await user.keyboard('{Enter}')
      const windowKeys = vi.fn()
      window.addEventListener('keydown', windowKeys)

      await user.keyboard('{Escape}')

      window.removeEventListener('keydown', windowKeys)
      expect(document.activeElement).toBe(row('Opacity'))
      // The graph stays open, and the editor's own Escape (deselect the clip)
      // never saw the key.
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(windowKeys).not.toHaveBeenCalled()
    })

    it('spends the first Escape on the graph\'s active keyframe, the second on the focus return', async () => {
      const user = userEvent.setup()
      openPanelWithClip()
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      render(<KeyframePanel />)
      row('Opacity').focus()
      await user.keyboard('{Enter}')
      const svg = screen.getByRole('listbox')
      await user.keyboard('{End}')
      expect(svg.getAttribute('aria-activedescendant')).not.toBeNull()

      await user.keyboard('{Escape}')
      expect(svg.getAttribute('aria-activedescendant')).toBeNull()
      expect(document.activeElement).toBe(svg)

      await user.keyboard('{Escape}')
      expect(document.activeElement).toBe(row('Opacity'))
    })

    it('Escape in a graph whose property has no row returns focus to the rows\' tab stop', () => {
      openPanelWithClip()
      store().setKeyframePanelSelectedProperty('volume')
      render(<KeyframePanel />)
      const windowKeys = vi.fn()
      window.addEventListener('keydown', windowKeys)

      screen.getByRole('listbox').focus()
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

      window.removeEventListener('keydown', windowKeys)
      expect(document.activeElement).toBe(row('Position X'))
      expect(windowKeys).not.toHaveBeenCalled()
    })

    it('names the panel\'s close buttons', () => {
      openPanelWithClip()
      store().setKeyframePanelSelectedProperty('opacity')
      render(<KeyframePanel />)

      expect(screen.getByRole('button', { name: 'Close keyframe panel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close keyframe graph' })).toBeInTheDocument()
    })
  })
})
