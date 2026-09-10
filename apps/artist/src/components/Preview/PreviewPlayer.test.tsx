// The preview's empty states and its transport buttons.
//
// The drawing, selection, transform and playback behaviour each have a file of
// their own; this one covers what the component shows when there is nothing to
// draw, and PlaybackControls, which owns no canvas at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlaybackControls, PreviewPlayer } from './PreviewPlayer'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { installPreviewDoubles, renderPreview, settle, type PreviewDoubles } from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('PreviewPlayer empty state', () => {
  it('shows the placeholder when there are no clips', async () => {
    render(<PreviewPlayer />)
    await settle(60)

    expect(screen.getByText('Add clips to the timeline to preview')).toBeInTheDocument()
    expect(document.querySelector('canvas')).toBeNull()
  })

  it('shows a zero timecode and no clip info', async () => {
    render(<PreviewPlayer />)
    await settle(60)

    expect(screen.getByText('00:00.000')).toBeInTheDocument()
  })

  it('shows the canvas once there is a clip to draw', async () => {
    addClip('clip1', 0, 10)
    store().setCurrentTime(5)

    const preview = await renderPreview()

    expect(screen.queryByText('Add clips to the timeline to preview')).not.toBeInTheDocument()
    expect(preview.canvas).toBeInTheDocument()
    expect(preview.view.getByText('1 clip • clip1')).toBeInTheDocument()
  })
})

describe('PlaybackControls', () => {
  const withClip = () => addClip('clip1', 0, 10)

  it('renders all control buttons', () => {
    render(<PlaybackControls />)

    expect(screen.getByTitle('Go to start (Home)')).toBeInTheDocument()
    expect(screen.getByTitle('Step backward (←)')).toBeInTheDocument()
    expect(screen.getByTitle('Play (Space)')).toBeInTheDocument()
    expect(screen.getByTitle('Step forward (→)')).toBeInTheDocument()
    expect(screen.getByTitle('Go to end (End)')).toBeInTheDocument()
  })

  it('disables play when there is nothing to play', () => {
    render(<PlaybackControls />)

    expect(screen.getByTitle('Play (Space)')).toBeDisabled()
  })

  it('disables play once the playhead is at the end of the timeline', () => {
    withClip()
    store().setCurrentTime(10)

    render(<PlaybackControls />)

    expect(screen.getByTitle('Play (Space)')).toBeDisabled()
  })

  it('enables play when clips exist', () => {
    withClip()

    render(<PlaybackControls />)

    expect(screen.getByTitle('Play (Space)')).not.toBeDisabled()
  })

  it('goes to start when the button is clicked', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Go to start (Home)'))

    expect(store().currentTime).toBe(0)
  })

  it('steps backward when the button is clicked', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().currentTime).toBe(4)
  })

  it('steps forward when the button is clicked', () => {
    withClip()
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step forward (→)'))

    expect(store().currentTime).toBe(6)
  })

  it('goes to end when the button is clicked', () => {
    withClip()
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Go to end (End)'))

    expect(store().currentTime).toBe(10)
  })

  it('toggles play state when the play button is clicked', () => {
    withClip()
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Play (Space)'))

    expect(store().isPlaying).toBe(true)
  })

  it('shows the pause button while playing', () => {
    withClip()
    store().setIsPlaying(true)

    render(<PlaybackControls />)

    expect(screen.getByTitle('Pause (Space)')).toBeInTheDocument()
  })

  it('pauses from the pause button even at the end of the timeline', () => {
    withClip()
    store().setCurrentTime(10)
    store().setIsPlaying(true)

    render(<PlaybackControls />)
    fireEvent.click(screen.getByTitle('Pause (Space)'))

    expect(store().isPlaying).toBe(false)
  })

  it('clamps step backward to 0', () => {
    store().setCurrentTime(0.5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().currentTime).toBe(0)
  })

  it('clamps step forward to the timeline duration', () => {
    withClip()
    store().setCurrentTime(9.5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step forward (→)'))

    expect(store().currentTime).toBe(10)
  })

  it('stops playback when the playhead is stepped or jumped', () => {
    withClip()
    store().setIsPlaying(true)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().isPlaying).toBe(false)
  })
})

describe('PlaybackControls keyboard shortcuts', () => {
  beforeEach(() => {
    addClip('clip1', 0, 10)
  })

  it('handles Space for play/pause', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'Space' })

    expect(store().isPlaying).toBe(true)
  })

  it('handles ArrowLeft for step backward', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'ArrowLeft' })

    expect(store().currentTime).toBe(4)
  })

  it('handles ArrowRight for step forward', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'ArrowRight' })

    expect(store().currentTime).toBe(6)
  })

  it('handles Home for go to start', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'Home' })

    expect(store().currentTime).toBe(0)
  })

  it('handles End for go to end', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'End' })

    expect(store().currentTime).toBe(10)
  })

  it('ignores every other key', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'KeyK' })

    expect(store().currentTime).toBe(0)
    expect(store().isPlaying).toBe(false)
  })

  it('leaves the transport alone while a text field has focus', () => {
    const input = document.createElement('input')
    document.body.append(input)
    render(<PlaybackControls />)

    fireEvent.keyDown(input, { code: 'Space' })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    fireEvent.keyDown(textarea, { code: 'ArrowRight' })

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(0)
    input.remove()
    textarea.remove()
  })

  it('stops listening once it is unmounted', () => {
    const { unmount } = render(<PlaybackControls />)
    unmount()

    fireEvent.keyDown(window, { code: 'Space' })

    expect(store().isPlaying).toBe(false)
  })
})
