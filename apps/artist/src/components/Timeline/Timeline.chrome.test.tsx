// The timeline's ruler, playhead, markers, in/out region and track headers.
//
// Everything here converts mouse coordinates into times, which jsdom cannot do
// on its own — see src/test/doubles/layout.ts for the boxes these tests hand
// the ruler and the track container. At the default zoom one second is 50px.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Timeline } from './Timeline'
import { resetStoreForTest, store, addClip, video } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'
import { installResizeObserverDouble, type ResizeObserverDouble } from '../../test/doubles/resizeObserver'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import styles from './Timeline.module.css'

const CONTAINER_WIDTH = 1000

interface Rendered {
  root: HTMLElement
  trackContainer: HTMLElement
  ruler: HTMLElement
}

/** Render the timeline and give its scroll panes a real layout box. */
function renderTimeline(props: Parameters<typeof Timeline>[0] = {}): Rendered {
  const { container } = render(<Timeline {...props} />)
  const root = container.firstElementChild as HTMLElement
  const trackContainer = root.querySelector(`.${styles.trackContainer}`) as HTMLElement
  const ruler = root.querySelector(`.${styles.ruler}`) as HTMLElement
  setRect(trackContainer, { left: 0, top: 0, width: CONTAINER_WIDTH, height: 200 })
  setRect(ruler, { left: 0, top: 0, width: CONTAINER_WIDTH, height: 30 })
  return { root, trackContainer, ruler }
}

const playhead = (root: HTMLElement) => root.querySelector('[data-playhead]') as HTMLElement

describe('Timeline ruler and playhead', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 10)
    store().setSelectedClipId(null)
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('seeks to the clicked point on the ruler', () => {
    const { ruler } = renderTimeline()

    fireEvent.click(ruler, { clientX: 250 })

    expect(store().currentTime).toBe(5)
  })

  it('clamps a ruler click past the end of the timeline', () => {
    const { ruler } = renderTimeline()

    fireEvent.click(ruler, { clientX: 900 })

    expect(store().currentTime).toBe(10)
  })

  it('stops playback when the ruler is scrubbed', () => {
    store().setIsPlaying(true)
    const { ruler } = renderTimeline()

    fireEvent.click(ruler, { clientX: 100 })

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(2)
  })

  it('seeks and deselects when empty track space is clicked', () => {
    store().setSelectedClipId('clip1')
    const { trackContainer } = renderTimeline()

    fireEvent.click(trackContainer, { clientX: 300 })

    expect(store().currentTime).toBe(6)
    expect(store().selectedClipId).toBeNull()
  })

  it('keeps the clip selected when the click lands on a clip', () => {
    store().setSelectedClipId('clip1')
    const { root } = renderTimeline()

    fireEvent.click(root.querySelector('[data-clip-id]')!, { clientX: 100 })

    expect(store().selectedClipId).toBe('clip1')
    expect(store().currentTime).toBe(2)
  })

  it('ignores a click that lands on the playhead', () => {
    const { root } = renderTimeline()

    fireEvent.click(playhead(root), { clientX: 300 })

    expect(store().currentTime).toBe(0)
  })

  it('scrubs while the playhead is dragged and stops on release', () => {
    const { root } = renderTimeline()

    fireEvent.mouseDown(playhead(root))
    fireEvent.mouseMove(document, { clientX: 300 })
    expect(store().currentTime).toBe(6)

    fireEvent.mouseMove(document, { clientX: 100 })
    expect(store().currentTime).toBe(2)

    fireEvent.mouseUp(document)
    fireEvent.mouseMove(document, { clientX: 400 })
    expect(store().currentTime).toBe(2)
  })

  it('clamps a playhead drag to the timeline', () => {
    const { root } = renderTimeline()

    fireEvent.mouseDown(playhead(root))
    fireEvent.mouseMove(document, { clientX: -50 })
    expect(store().currentTime).toBe(0)

    fireEvent.mouseMove(document, { clientX: 5000 })
    expect(store().currentTime).toBe(10)
  })
})

describe('Timeline markers', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('flags every marker on the ruler and draws its line over the tracks', () => {
    store().addMarker(3, 'Cut here')
    const { root } = renderTimeline()

    const flag = screen.getByTitle(/^Cut here \(0:03\)/)
    expect(flag).toHaveStyle({ left: '150px' })
    expect(root.querySelectorAll(`.${styles.markerLine}`)).toHaveLength(1)
  })

  it('removes a marker when its flag is double-clicked', async () => {
    const user = userEvent.setup()
    store().addMarker(3, 'Cut here')
    renderTimeline()

    await user.dblClick(screen.getByTitle(/^Cut here/))

    expect(store().markers).toHaveLength(0)
  })
})

describe('Timeline in and out points', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 10)
    store().setSelectedClipId(null)
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('reports the selected region once both points are set', () => {
    store().setInPoint(2)
    store().setOutPoint(6)
    renderTimeline()

    expect(screen.getByText(/Selection: 0:02 - 0:06 \(0:04\)/)).toBeInTheDocument()
  })

  it('drags the in point to a new time', () => {
    store().setInPoint(2)
    renderTimeline()

    fireEvent.mouseDown(screen.getByTitle('In point: 0:02'))
    fireEvent.mouseMove(document, { clientX: 200 })

    expect(store().inPoint).toBe(4)

    fireEvent.mouseUp(document)
    fireEvent.mouseMove(document, { clientX: 350 })
    expect(store().inPoint).toBe(4)
  })

  it('drags the out point to a new time', () => {
    store().setOutPoint(8)
    renderTimeline()

    fireEvent.mouseDown(screen.getByTitle('Out point: 0:08'))
    fireEvent.mouseMove(document, { clientX: 250 })

    expect(store().outPoint).toBe(5)
  })

  it('hands the selected region to the export callback', async () => {
    const user = userEvent.setup()
    const onExportSelection = vi.fn()
    store().setInPoint(1)
    store().setOutPoint(4)
    renderTimeline({ onExportSelection })

    await user.click(screen.getByRole('button', { name: 'Export Selection' }))

    expect(onExportSelection).toHaveBeenCalledWith({ start: 1, end: 4 })
  })

  it('offers no export button without a host callback', () => {
    store().setInPoint(1)
    store().setOutPoint(4)
    renderTimeline()

    expect(screen.queryByRole('button', { name: 'Export Selection' })).not.toBeInTheDocument()
  })
})

describe('Timeline track headers', () => {
  let resizeObserver: ResizeObserverDouble
  let confirmSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    resizeObserver.uninstall()
    confirmSpy.mockRestore()
  })

  const track = () => store().project.timeline.tracks[0]

  it('renames a track from a double-click and Enter', async () => {
    const user = userEvent.setup()
    renderTimeline()

    await user.dblClick(screen.getByText('Track 1'))
    const field = screen.getByRole('textbox')
    await user.clear(field)
    await user.type(field, 'Dialogue{Enter}')

    expect(track().name).toBe('Dialogue')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('commits a rename when the field loses focus', async () => {
    const user = userEvent.setup()
    renderTimeline()

    await user.dblClick(screen.getByText('Track 1'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '  Music  ')
    fireEvent.blur(screen.getByRole('textbox'))

    expect(track().name).toBe('Music')
  })

  it('abandons a rename on Escape', async () => {
    const user = userEvent.setup()
    renderTimeline()

    await user.dblClick(screen.getByText('Track 1'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Nope{Escape}')

    expect(track().name).toBe('Track 1')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('ignores a rename to nothing but blank space', async () => {
    const user = userEvent.setup()
    renderTimeline()

    await user.dblClick(screen.getByText('Track 1'))
    await user.clear(screen.getByRole('textbox'))
    fireEvent.blur(screen.getByRole('textbox'))

    expect(track().name).toBe('Track 1')
  })

  it('changes the track volume', () => {
    renderTimeline()

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0.4' } })

    expect(track().volume).toBeCloseTo(0.4)
    expect(track().lastVolume).toBeCloseTo(0.4)
  })

  it('unmutes a track when its volume is raised', async () => {
    const user = userEvent.setup()
    renderTimeline()
    await user.click(screen.getByTitle('Mute'))

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0.7' } })

    expect(track()).toMatchObject({ muted: false, volume: 0.7 })
  })

  it('leaves a track muted when the volume is dragged to zero', async () => {
    const user = userEvent.setup()
    store().updateTrack(store().project.timeline.tracks[0].id, { volume: 0.6 })
    renderTimeline()
    await user.click(screen.getByTitle('Mute'))

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0' } })

    expect(track()).toMatchObject({ muted: true, volume: 0, lastVolume: 0.6 })
  })

  it('moves a track down and back up the stack', async () => {
    const user = userEvent.setup()
    store().addTrack()
    renderTimeline()

    // sortedTracks puts the highest index first, so the top row is Track 2
    const rows = screen.getAllByTitle('Move track down')
    await user.click(rows[0])
    expect(store().project.timeline.tracks.map((t) => `${t.name}:${t.index}`).sort())
      .toEqual(['Track 1:1', 'Track 2:0'])

    await user.click(screen.getAllByTitle('Move track up')[1])
    expect(store().project.timeline.tracks.map((t) => `${t.name}:${t.index}`).sort())
      .toEqual(['Track 1:0', 'Track 2:1'])
  })

  it('deletes an empty track without asking', async () => {
    const user = userEvent.setup()
    store().addTrack()
    renderTimeline()

    await user.click(screen.getAllByTitle('Delete track')[0])

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(store().project.timeline.tracks).toHaveLength(1)
  })

  it('asks before deleting a track that still holds clips', async () => {
    const user = userEvent.setup()
    store().addTrack()
    addClip('clip1', 0, 2, store().project.timeline.tracks[1].id)
    renderTimeline()

    await user.click(screen.getAllByTitle('Delete track')[0])

    expect(confirmSpy).toHaveBeenCalledWith('Delete track with 1 clip(s)? This cannot be undone.')
    expect(store().project.timeline.tracks).toHaveLength(1)
  })

  it('keeps the track when the delete is declined', async () => {
    confirmSpy.mockReturnValue(false)
    const user = userEvent.setup()
    store().addTrack()
    addClip('clip1', 0, 2, store().project.timeline.tracks[1].id)
    renderTimeline()

    await user.click(screen.getAllByTitle('Delete track')[0])

    expect(store().project.timeline.tracks).toHaveLength(2)
  })
})

describe('Timeline zoom, scrolling and waveforms', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    installCanvasDouble()
  })

  afterEach(() => {
    resizeObserver.uninstall()
    uninstallCanvasDouble()
  })

  it('lays a clip out at 50 pixels a second and doubles that at 200% zoom', () => {
    addClip('clip1', 2, 4)
    const { root } = renderTimeline()

    expect(root.querySelector('[data-clip-id]')).toHaveStyle({ left: '100px', width: '200px' })

    act(() => store().setZoom(2))
    expect(root.querySelector('[data-clip-id]')).toHaveStyle({ left: '200px', width: '400px' })
  })

  it('syncs the ruler and the track headers with the track scroll position', () => {
    addClip('clip1', 0, 10)
    const { root, trackContainer, ruler } = renderTimeline()
    const headers = root.querySelector(`.${styles.trackHeaders}`) as HTMLElement

    trackContainer.scrollLeft = 120
    trackContainer.scrollTop = 40
    fireEvent.scroll(trackContainer)

    expect(ruler.scrollLeft).toBe(120)
    expect(headers.scrollTop).toBe(40)
  })

  it('syncs the track area when the headers are scrolled', () => {
    const { root, trackContainer } = renderTimeline()
    const headers = root.querySelector(`.${styles.trackHeaders}`) as HTMLElement

    headers.scrollTop = 60
    fireEvent.scroll(headers)

    expect(trackContainer.scrollTop).toBe(60)
  })

  it('draws a waveform for a clip whose source has peaks', () => {
    store().addSourceVideo({
      ...video,
      id: 'withAudio',
      hasAudio: true,
      waveformData: [
        { min: -0.5, max: 0.5 },
        { min: -1, max: 1 },
      ],
    })
    store().addClipToTimeline(
      { id: 'clip1', sourceVideoId: 'withAudio', name: 'clip1', startTime: 0, endTime: 4, duration: 4 },
      undefined,
      0
    )
    const { root } = renderTimeline()

    const clip = root.querySelector('[data-clip-id]') as HTMLElement
    expect(clip.querySelector('canvas')).toBeInTheDocument()
  })

  it('renders no waveform for a source without peaks', () => {
    addClip('clip1', 0, 4)
    const { root } = renderTimeline()

    expect(root.querySelector('[data-clip-id] canvas')).toBeNull()
  })

  it('stops rendering clips that fall outside the viewport once the width is known', () => {
    addClip('near', 0, 2)
    addClip('far', 200, 2)
    const { root, trackContainer } = renderTimeline()

    // Before the container reports a width every clip is rendered
    expect(root.querySelectorAll('[data-clip-id]')).toHaveLength(2)

    act(() => resizeObserver.emit(trackContainer, { width: CONTAINER_WIDTH, height: 200 }))

    const rendered = [...root.querySelectorAll('[data-clip-id]')].map((el) =>
      el.getAttribute('data-clip-id')
    )
    expect(rendered).toEqual(['near'])
  })

  it('shows a keyframe diamond for each animated moment on a clip', () => {
    addClip('clip1', 0, 4)
    store().updateClipAnimation('clip1', {
      keyframes: {
        opacity: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 2, value: 1, easing: 'linear' },
        ],
      },
    })
    renderTimeline()

    expect(screen.getByTitle('Keyframe @ 0.00s')).toBeInTheDocument()
    expect(screen.getByTitle('Keyframe @ 2.00s')).toHaveStyle({ left: '100px' })
  })
})
