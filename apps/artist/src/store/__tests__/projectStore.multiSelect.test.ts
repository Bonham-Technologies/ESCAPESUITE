import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../projectStore'
import type { Clip, Track } from '../types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION } from '../types'

// Helper to create a test clip
function createTestClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: overrides.id || 'clip-1',
    sourceVideoId: 'source-1',
    name: overrides.name || 'Test Clip',
    startTime: 0,
    endTime: 5,
    duration: 5,
    trackId: overrides.trackId || 'track-1',
    timelinePosition: overrides.timelinePosition ?? 0,
    blendMode: 'normal',
    transform: { ...DEFAULT_TRANSFORM },
    effects: { ...DEFAULT_EFFECTS },
    transition: { ...DEFAULT_TRANSITION },
    ...overrides,
  }
}

// Helper to create a test track
function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: overrides.id || 'track-1',
    name: overrides.name || 'Track 1',
    index: overrides.index ?? 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
    ...overrides,
  }
}

// Helper to set up the store with test clips and tracks
function setupStore(clips: Clip[], tracks: Track[]) {
  const store = useEditorStore.getState()
  store.setProject({
    ...store.project,
    timeline: {
      ...store.project.timeline,
      clips,
      tracks,
      duration: clips.length > 0
        ? Math.max(...clips.map(c => c.timelinePosition + c.duration))
        : 0,
    },
  })
  // Clear history from setProject
  useEditorStore.setState({ history: { past: [], future: [] } })
}

describe('Multi-Select Store', () => {
  beforeEach(() => {
    // Reset store to initial state
    const store = useEditorStore.getState()
    store.resetProject()
    useEditorStore.setState({
      history: { past: [], future: [] },
      selectedClipIds: new Set<string>(),
      clipboard: null,
    })
  })

  describe('toggleClipSelection', () => {
    it('adds a clip to the selection set', () => {
      const { toggleClipSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')

      const state = useEditorStore.getState()
      expect(state.selectedClipIds.has('clip-1')).toBe(true)
      expect(state.selectedClipIds.size).toBe(1)
    })

    it('removes a clip from the selection set if already selected', () => {
      const { toggleClipSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      toggleClipSelection('clip-1')

      const state = useEditorStore.getState()
      expect(state.selectedClipIds.has('clip-1')).toBe(false)
      expect(state.selectedClipIds.size).toBe(0)
    })

    it('selects multiple clips via toggle', () => {
      const { toggleClipSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      toggleClipSelection('clip-2')
      toggleClipSelection('clip-3')

      const state = useEditorStore.getState()
      expect(state.selectedClipIds.size).toBe(3)
      expect(state.selectedClipIds.has('clip-1')).toBe(true)
      expect(state.selectedClipIds.has('clip-2')).toBe(true)
      expect(state.selectedClipIds.has('clip-3')).toBe(true)
    })

    it('updates primary selection to last toggled-on clip', () => {
      const { toggleClipSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      expect(useEditorStore.getState().selectedClipId).toBe('clip-1')

      toggleClipSelection('clip-2')
      expect(useEditorStore.getState().selectedClipId).toBe('clip-2')
    })

    it('clears primary selection when toggling off last clip', () => {
      const { toggleClipSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      toggleClipSelection('clip-1') // toggle off

      const state = useEditorStore.getState()
      expect(state.selectedClipId).toBeNull()
      expect(state.selectedClipIds.size).toBe(0)
    })

    it('keeps primary selection when toggling off non-last clip', () => {
      const { toggleClipSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      toggleClipSelection('clip-2')
      toggleClipSelection('clip-1') // toggle off clip-1, clip-2 still selected

      const state = useEditorStore.getState()
      // Primary should remain clip-2 (was set when clip-2 was toggled on)
      expect(state.selectedClipId).toBe('clip-2')
      expect(state.selectedClipIds.size).toBe(1)
      expect(state.selectedClipIds.has('clip-2')).toBe(true)
    })
  })

  describe('setSelectedClipId clears multi-selection', () => {
    it('clears multi-selection on single click', () => {
      const { toggleClipSelection, setSelectedClipId } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      toggleClipSelection('clip-2')

      setSelectedClipId('clip-3')

      const state = useEditorStore.getState()
      expect(state.selectedClipId).toBe('clip-3')
      expect(state.selectedClipIds.size).toBe(0)
    })

    it('clears multi-selection when deselecting', () => {
      const { toggleClipSelection, setSelectedClipId } = useEditorStore.getState()
      toggleClipSelection('clip-1')

      setSelectedClipId(null)

      const state = useEditorStore.getState()
      expect(state.selectedClipId).toBeNull()
      expect(state.selectedClipIds.size).toBe(0)
    })
  })

  describe('selectClipsInRange', () => {
    it('replaces entire selection with given clip IDs', () => {
      const { toggleClipSelection, selectClipsInRange } = useEditorStore.getState()
      toggleClipSelection('clip-1')

      selectClipsInRange(['clip-2', 'clip-3', 'clip-4'])

      const state = useEditorStore.getState()
      expect(state.selectedClipIds.size).toBe(3)
      expect(state.selectedClipIds.has('clip-1')).toBe(false)
      expect(state.selectedClipIds.has('clip-2')).toBe(true)
      expect(state.selectedClipIds.has('clip-3')).toBe(true)
      expect(state.selectedClipIds.has('clip-4')).toBe(true)
    })

    it('sets primary selection to last clip in array', () => {
      const { selectClipsInRange } = useEditorStore.getState()
      selectClipsInRange(['clip-a', 'clip-b', 'clip-c'])

      expect(useEditorStore.getState().selectedClipId).toBe('clip-c')
    })

    it('handles empty array', () => {
      const { toggleClipSelection, selectClipsInRange } = useEditorStore.getState()
      toggleClipSelection('clip-1')

      selectClipsInRange([])

      const state = useEditorStore.getState()
      expect(state.selectedClipIds.size).toBe(0)
      expect(state.selectedClipId).toBeNull()
    })
  })

  describe('clearMultiSelection', () => {
    it('empties the selection set and clears primary selection', () => {
      const { toggleClipSelection, clearMultiSelection } = useEditorStore.getState()
      toggleClipSelection('clip-1')
      toggleClipSelection('clip-2')

      clearMultiSelection()

      const state = useEditorStore.getState()
      expect(state.selectedClipIds.size).toBe(0)
      expect(state.selectedClipId).toBeNull()
    })
  })

  describe('deleteSelectedClips', () => {
    it('removes correct clips and keeps others', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 0 }),
        createTestClip({ id: 'clip-2', timelinePosition: 5 }),
        createTestClip({ id: 'clip-3', timelinePosition: 10 }),
      ]
      setupStore(clips, tracks)

      // Select clip-1 and clip-3
      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().toggleClipSelection('clip-3')

      useEditorStore.getState().deleteSelectedClips()

      const state = useEditorStore.getState()
      expect(state.project.timeline.clips).toHaveLength(1)
      expect(state.project.timeline.clips[0].id).toBe('clip-2')
      expect(state.selectedClipId).toBeNull()
      expect(state.selectedClipIds.size).toBe(0)
    })

    it('pushes to undo history', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().deleteSelectedClips()

      expect(useEditorStore.getState().history.past.length).toBe(1)
    })

    it('does nothing when no clips selected', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().deleteSelectedClips()

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(1)
      expect(useEditorStore.getState().history.past.length).toBe(0)
    })

    it('recalculates timeline duration', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 0, duration: 5 }),
        createTestClip({ id: 'clip-2', timelinePosition: 10, duration: 5 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-2')
      useEditorStore.getState().deleteSelectedClips()

      expect(useEditorStore.getState().project.timeline.duration).toBe(5) // only clip-1 remains
    })
  })

  describe('moveSelectedClips', () => {
    it('adjusts positions maintaining relative offsets', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 0 }),
        createTestClip({ id: 'clip-2', timelinePosition: 10 }),
        createTestClip({ id: 'clip-3', timelinePosition: 20 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().toggleClipSelection('clip-2')

      useEditorStore.getState().moveSelectedClips(5, 0)

      const state = useEditorStore.getState()
      const clip1 = state.project.timeline.clips.find(c => c.id === 'clip-1')!
      const clip2 = state.project.timeline.clips.find(c => c.id === 'clip-2')!
      const clip3 = state.project.timeline.clips.find(c => c.id === 'clip-3')!

      expect(clip1.timelinePosition).toBe(5)
      expect(clip2.timelinePosition).toBe(15)
      expect(clip3.timelinePosition).toBe(20) // unselected, unchanged
    })

    it('clamps position to 0', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1', timelinePosition: 2 })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().moveSelectedClips(-10, 0)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.timelinePosition).toBe(0)
    })

    it('moves clips to different track', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', index: 0 }),
        createTestTrack({ id: 'track-2', name: 'Track 2', index: 1 }),
      ]
      const clips = [
        createTestClip({ id: 'clip-1', trackId: 'track-1' }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().moveSelectedClips(0, 1)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.trackId).toBe('track-2')
    })

    it('clamps track index to valid range', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', index: 0 }),
        createTestTrack({ id: 'track-2', name: 'Track 2', index: 1 }),
      ]
      const clips = [
        createTestClip({ id: 'clip-1', trackId: 'track-2' }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().moveSelectedClips(0, 5) // try to move way beyond

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.trackId).toBe('track-2') // stays at last track
    })

    it('pushes to undo history', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().moveSelectedClips(1, 0)

      expect(useEditorStore.getState().history.past.length).toBe(1)
    })

    it('does nothing when no clips selected', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1', timelinePosition: 5 })]
      setupStore(clips, tracks)

      useEditorStore.getState().moveSelectedClips(10, 0)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.timelinePosition).toBe(5) // unchanged
      expect(useEditorStore.getState().history.past.length).toBe(0)
    })
  })

  describe('copySelectedClips + pasteClips', () => {
    it('copies selected clips to clipboard', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 0 }),
        createTestClip({ id: 'clip-2', timelinePosition: 5 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().toggleClipSelection('clip-2')
      useEditorStore.getState().copySelectedClips()

      const state = useEditorStore.getState()
      expect(state.clipboard).toHaveLength(2)
      expect(state.clipboard![0].id).toBe('clip-1')
      expect(state.clipboard![1].id).toBe('clip-2')
    })

    it('copy does not push to undo history', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().copySelectedClips()

      expect(useEditorStore.getState().history.past.length).toBe(0)
    })

    it('paste creates new clips with new IDs', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1', timelinePosition: 0 })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().copySelectedClips()

      // Set playhead position for paste
      useEditorStore.setState({ currentTime: 10 })
      useEditorStore.getState().pasteClips()

      const state = useEditorStore.getState()
      expect(state.project.timeline.clips).toHaveLength(2)

      const pastedClip = state.project.timeline.clips[1]
      expect(pastedClip.id).not.toBe('clip-1') // new ID
      expect(pastedClip.timelinePosition).toBe(10) // at playhead
    })

    it('paste pushes to undo history', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().copySelectedClips()
      useEditorStore.getState().pasteClips()

      expect(useEditorStore.getState().history.past.length).toBe(1)
    })

    it('paste selects the new clips', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 0 }),
        createTestClip({ id: 'clip-2', timelinePosition: 5 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().toggleClipSelection('clip-2')
      useEditorStore.getState().copySelectedClips()
      useEditorStore.getState().pasteClips()

      const state = useEditorStore.getState()
      // 2 original + 2 pasted
      expect(state.project.timeline.clips).toHaveLength(4)
      // New clips should be selected
      expect(state.selectedClipIds.size).toBe(2)
      // None of the original IDs should be in the new selection
      expect(state.selectedClipIds.has('clip-1')).toBe(false)
      expect(state.selectedClipIds.has('clip-2')).toBe(false)
    })

    it('paste preserves relative positions between clips', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 2, duration: 5 }),
        createTestClip({ id: 'clip-2', timelinePosition: 10, duration: 5 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().toggleClipSelection('clip-2')
      useEditorStore.getState().copySelectedClips()

      useEditorStore.setState({ currentTime: 20 })
      useEditorStore.getState().pasteClips()

      const state = useEditorStore.getState()
      const pastedClips = state.project.timeline.clips.filter(
        c => c.id !== 'clip-1' && c.id !== 'clip-2'
      )
      expect(pastedClips).toHaveLength(2)

      // Relative offset should be preserved: clip-2 was 8s after clip-1
      const positions = pastedClips.map(c => c.timelinePosition).sort((a, b) => a - b)
      expect(positions[1] - positions[0]).toBe(8)
    })

    it('paste does nothing when clipboard is empty', () => {
      useEditorStore.getState().pasteClips()

      const state = useEditorStore.getState()
      expect(state.project.timeline.clips).toHaveLength(0)
      expect(state.history.past.length).toBe(0)
    })

    it('copy does nothing when no clips selected', () => {
      useEditorStore.getState().copySelectedClips()

      expect(useEditorStore.getState().clipboard).toBeNull()
    })

    it('clipboard is a deep copy (modifying original does not affect clipboard)', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1', name: 'Original' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().copySelectedClips()

      // Modify original clip
      useEditorStore.getState().updateClip('clip-1', { name: 'Modified' })

      const clipboard = useEditorStore.getState().clipboard!
      expect(clipboard[0].name).toBe('Original')
    })
  })

  describe('muteSelectedClips', () => {
    it('mutes tracks containing selected clips', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', index: 0 }),
        createTestTrack({ id: 'track-2', name: 'Track 2', index: 1 }),
      ]
      const clips = [
        createTestClip({ id: 'clip-1', trackId: 'track-1' }),
        createTestClip({ id: 'clip-2', trackId: 'track-2', timelinePosition: 0 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().muteSelectedClips()

      const state = useEditorStore.getState()
      const track1 = state.project.timeline.tracks.find(t => t.id === 'track-1')!
      const track2 = state.project.timeline.tracks.find(t => t.id === 'track-2')!

      expect(track1.muted).toBe(true)
      expect(track2.muted).toBe(false)
    })

    it('pushes to undo history', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().muteSelectedClips()

      expect(useEditorStore.getState().history.past.length).toBe(1)
    })

    it('does nothing when no clips selected', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().muteSelectedClips()

      expect(useEditorStore.getState().history.past.length).toBe(0)
    })
  })

  describe('unmuteSelectedClips', () => {
    it('unmutes tracks containing selected clips', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', index: 0, muted: true }),
        createTestTrack({ id: 'track-2', name: 'Track 2', index: 1, muted: true }),
      ]
      const clips = [
        createTestClip({ id: 'clip-1', trackId: 'track-1' }),
        createTestClip({ id: 'clip-2', trackId: 'track-2', timelinePosition: 0 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().unmuteSelectedClips()

      const state = useEditorStore.getState()
      const track1 = state.project.timeline.tracks.find(t => t.id === 'track-1')!
      const track2 = state.project.timeline.tracks.find(t => t.id === 'track-2')!

      expect(track1.muted).toBe(false)
      expect(track2.muted).toBe(true) // clip-2 not selected
    })

    it('pushes to undo history', () => {
      const tracks = [createTestTrack({ muted: true })]
      const clips = [createTestClip({ id: 'clip-1' })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().unmuteSelectedClips()

      expect(useEditorStore.getState().history.past.length).toBe(1)
    })
  })

  describe('undo/redo with multi-select operations', () => {
    it('undo restores deleted clips', () => {
      const tracks = [createTestTrack()]
      const clips = [
        createTestClip({ id: 'clip-1', timelinePosition: 0 }),
        createTestClip({ id: 'clip-2', timelinePosition: 5 }),
      ]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().deleteSelectedClips()

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(1)

      useEditorStore.getState().undo()

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(2)
    })

    it('undo restores moved clip positions', () => {
      const tracks = [createTestTrack()]
      const clips = [createTestClip({ id: 'clip-1', timelinePosition: 5 })]
      setupStore(clips, tracks)

      useEditorStore.getState().toggleClipSelection('clip-1')
      useEditorStore.getState().moveSelectedClips(10, 0)

      expect(useEditorStore.getState().project.timeline.clips[0].timelinePosition).toBe(15)

      useEditorStore.getState().undo()

      expect(useEditorStore.getState().project.timeline.clips[0].timelinePosition).toBe(5)
    })
  })
})
