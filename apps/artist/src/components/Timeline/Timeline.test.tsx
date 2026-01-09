import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Timeline } from './Timeline'
import { useEditorStore } from '../../store/projectStore'
import type { SourceVideo } from '../../store/types'

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).ResizeObserver = ResizeObserverMock

// Mock window.confirm
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).confirm = vi.fn(() => true)

describe('Timeline', () => {
  beforeEach(() => {
    // Reset store to initial state
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    cleanup()
  })

  afterEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  describe('rendering', () => {
    it('renders timeline container', () => {
      render(<Timeline />)

      // Should render timeline info - use getAllByText as multiple elements may match
      expect(screen.getAllByText(/clip/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/track/i).length).toBeGreaterThan(0)
    })

    it('renders default track', () => {
      render(<Timeline />)

      expect(screen.getByText('Track 1')).toBeInTheDocument()
    })

    it('does not render add track button (moved to App)', () => {
      render(<Timeline />)

      // Add Track button was moved to App.tsx timeline controls
      expect(screen.queryByText('+ Add Track')).not.toBeInTheDocument()
    })

    it('displays correct clip count', () => {
      render(<Timeline />)

      expect(screen.getByText(/0 clips/i)).toBeInTheDocument()
    })

    it('displays correct track count', () => {
      render(<Timeline />)

      expect(screen.getByText(/1 track/i)).toBeInTheDocument()
    })
  })

  describe('track management', () => {
    it('displays new tracks when added via store', () => {
      // Add track via store (button is now in App.tsx)
      useEditorStore.getState().addTrack()

      render(<Timeline />)

      expect(screen.getByText('Track 2')).toBeInTheDocument()
      expect(screen.getByText(/2 tracks/i)).toBeInTheDocument()
    })

    it('toggles track mute state', () => {
      render(<Timeline />)

      const muteButton = screen.getByTitle('Mute')
      fireEvent.click(muteButton)

      const track = useEditorStore.getState().project.timeline.tracks[0]
      expect(track.muted).toBe(true)
    })

    it('toggles track visibility', () => {
      render(<Timeline />)

      const visibilityButton = screen.getByTitle('Hide track')
      fireEvent.click(visibilityButton)

      const track = useEditorStore.getState().project.timeline.tracks[0]
      expect(track.visible).toBe(false)
    })

    it('toggles track lock state', () => {
      render(<Timeline />)

      const lockButton = screen.getByTitle('Lock track')
      fireEvent.click(lockButton)

      const track = useEditorStore.getState().project.timeline.tracks[0]
      expect(track.locked).toBe(true)
    })

    it('disables delete button when only one track exists', () => {
      render(<Timeline />)

      const deleteButton = screen.getByTitle('Delete track')
      expect(deleteButton).toBeDisabled()
    })

    it('enables delete button when multiple tracks exist', () => {
      useEditorStore.getState().addTrack()

      render(<Timeline />)

      const deleteButtons = screen.getAllByTitle('Delete track')
      expect(deleteButtons[0]).not.toBeDisabled()
    })
  })

  describe('clips', () => {
    const mockVideo: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    beforeEach(() => {
      useEditorStore.getState().addSourceVideo(mockVideo)
    })

    it('renders clips on timeline', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      render(<Timeline />)

      expect(screen.getByText('Test Clip')).toBeInTheDocument()
      expect(screen.getByText(/1 clip/i)).toBeInTheDocument()
    })

    it('selects clip on click', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      render(<Timeline />)

      const clipElement = screen.getByText('Test Clip').closest('[data-clip-id]')
      expect(clipElement).toBeInTheDocument()

      fireEvent.mouseDown(clipElement!)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      expect(useEditorStore.getState().selectedClipId).toBe(clipId)
    })

    it('displays clip duration', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      render(<Timeline />)

      // Duration should be displayed (0:05 format) - may appear multiple times (timeline info + clip)
      expect(screen.getAllByText('0:05').length).toBeGreaterThan(0)
    })
  })

  describe('overlay clips', () => {
    it('renders text overlay clips with icon', () => {
      useEditorStore.getState().addTextOverlayClip({
        text: 'Hello World',
      })

      render(<Timeline />)

      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })

    it('renders shape overlay clips with icon', () => {
      useEditorStore.getState().addShapeOverlayClip({
        type: 'rectangle',
      })

      render(<Timeline />)

      // Auto-track creation names the track "Rectangle" and clip is also labeled "Rectangle"
      // so we expect at least one instance
      expect(screen.getAllByText('Rectangle').length).toBeGreaterThan(0)
    })
  })

  describe('time display', () => {
    it('displays current time and duration', () => {
      render(<Timeline />)

      // Should show 0:00 / 0:00 initially
      expect(screen.getByText(/0:00 \/ 0:00/)).toBeInTheDocument()
    })

    it('updates time display when currentTime changes', () => {
      const mockVideo: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }
      useEditorStore.getState().addSourceVideo(mockVideo)

      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 10,
        duration: 10,
        animation: undefined,
      }, trackId, 0)

      useEditorStore.getState().setCurrentTime(5)

      render(<Timeline />)

      expect(screen.getByText(/0:05 \/ 0:10/)).toBeInTheDocument()
    })
  })

  describe('track reordering', () => {
    it('disables move up for first track', () => {
      useEditorStore.getState().addTrack()

      render(<Timeline />)

      const moveUpButtons = screen.getAllByTitle('Move track up')
      // First track's up button should be disabled
      expect(moveUpButtons[0]).toBeDisabled()
    })

    it('disables move down for last track', () => {
      useEditorStore.getState().addTrack()

      render(<Timeline />)

      const moveDownButtons = screen.getAllByTitle('Move track down')
      // Last track's down button should be disabled
      expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled()
    })
  })

  describe('ruler', () => {
    it('renders ruler ticks', () => {
      render(<Timeline />)

      // Ruler should have time labels
      expect(screen.getByText('0:00')).toBeInTheDocument()
    })
  })
})

describe('Timeline - track controls', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
  })

  it('shows correct mute button state', () => {
    render(<Timeline />)

    const muteButton = screen.getByTitle('Mute')
    // Button uses SVG icon, check it exists
    expect(muteButton.querySelector('svg')).toBeInTheDocument()

    fireEvent.click(muteButton)

    // Button should now show 'Unmute' title
    expect(screen.getByTitle('Unmute')).toBeInTheDocument()
  })

  it('shows correct visibility button state', () => {
    render(<Timeline />)

    const visButton = screen.getByTitle('Hide track')
    fireEvent.click(visButton)

    expect(screen.getByTitle('Show track')).toBeInTheDocument()
  })

  it('shows correct lock button state', () => {
    render(<Timeline />)

    const lockButton = screen.getByTitle('Lock track')
    // Button uses SVG icon
    expect(lockButton.querySelector('svg')).toBeInTheDocument()

    fireEvent.click(lockButton)

    const unlockedButton = screen.getByTitle('Unlock track')
    expect(unlockedButton.querySelector('svg')).toBeInTheDocument()
  })

  it('remembers volume when muting and restores on unmute', () => {
    // Set volume to 0.5 before rendering
    const track = useEditorStore.getState().project.timeline.tracks[0]
    useEditorStore.getState().updateTrack(track.id, { volume: 0.5 })

    render(<Timeline />)

    // Mute
    const muteButton = screen.getByTitle('Mute')
    fireEvent.click(muteButton)

    // Check volume is 0 and lastVolume is saved
    const mutedTrack = useEditorStore.getState().project.timeline.tracks[0]
    expect(mutedTrack.muted).toBe(true)
    expect(mutedTrack.volume).toBe(0)
    expect(mutedTrack.lastVolume).toBe(0.5)

    // Unmute
    const unmuteButton = screen.getByTitle('Unmute')
    fireEvent.click(unmuteButton)

    // Check volume is restored
    const unmutedTrack = useEditorStore.getState().project.timeline.tracks[0]
    expect(unmutedTrack.muted).toBe(false)
    expect(unmutedTrack.volume).toBe(0.5)
  })
})
