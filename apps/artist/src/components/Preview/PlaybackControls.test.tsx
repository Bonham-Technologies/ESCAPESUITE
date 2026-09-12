// The transport buttons and their keyboard shortcuts.
//
// PlaybackControls owns no canvas: it reads the store for the timeline's
// duration and the playhead, and writes back through the same actions the
// keyboard shortcuts use. Nothing here renders the preview.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlaybackControls } from './PlaybackControls'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

beforeEach(() => {
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

  it('stops playback when the playhead is stepped', () => {
    withClip()
    store().setIsPlaying(true)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().isPlaying).toBe(false)
  })

  it('stops playback when the playhead jumps to either end', () => {
    withClip()
    store().setIsPlaying(true)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Go to end (End)'))
    expect(store().isPlaying).toBe(false)

    store().setIsPlaying(true)
    fireEvent.click(screen.getByTitle('Go to start (Home)'))
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
