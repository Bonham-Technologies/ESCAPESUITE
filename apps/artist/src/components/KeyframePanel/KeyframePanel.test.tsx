import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyframePanel } from './KeyframePanel'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, addClip, video } from '../../test/fixtures/projectStore'
import { DEFAULT_KEYFRAME_PANEL_STATE } from '../../store/types'
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
    // The panel persists its layout in localStorage, and resetStoreForTest
    // deliberately leaves the panel's own UI state alone, so both need
    // clearing for each test to start from the documented default geometry.
    localStorage.clear()
    resetStoreForTest()
    useEditorStore.setState({ keyframePanelState: { ...DEFAULT_KEYFRAME_PANEL_STATE } })
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

    await user.click(screen.getByRole('button', { name: '×' }))

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

    it('changes a keyframe value, keeping its easing, when it is dragged vertically', () => {
      render(<KeyframePanel />)
      measureGraph()

      // y = 20 + (1 - value) * 150 → y = 170 is opacity 0.
      fireEvent.mouseDown(graphPoints()[1], { shiftKey: true })
      fireEvent.mouseMove(window, { clientX: 50 + 100, clientY: 170 })
      fireEvent.mouseUp(window)

      expect(keyframesOf('opacity')![1]).toEqual({ time: 1, value: 0, easing: 'linear' })
    })

    it('deletes a keyframe on right-click', () => {
      render(<KeyframePanel />)
      measureGraph()

      fireEvent.contextMenu(graphPoints()[1])

      expect(keyframesOf('opacity')!.map((kf) => kf.time)).toEqual([0])
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
})
