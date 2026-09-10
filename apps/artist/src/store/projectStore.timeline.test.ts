import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { SourceVideo } from './types'
import { addClip, resetStoreForTest, store, video } from './projectStore.testUtils'

describe('projectStore integration', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useEditorStore.getState().resetProject()
    // Clear history after reset
    useEditorStore.setState({ history: { past: [], future: [] } })
  })

  describe('clip management', () => {
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

    it('adds a clip to the timeline', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clips = useEditorStore.getState().project.timeline.clips
      expect(clips).toHaveLength(1)
      expect(clips[0].sourceVideoId).toBe('video1')
      expect(clips[0].duration).toBe(5)
    })

    it('updates clip position', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClip(clipId, { timelinePosition: 2 })

      const updatedClip = useEditorStore.getState().project.timeline.clips[0]
      expect(updatedClip.timelinePosition).toBe(2)
    })

    it('removes a clip', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().removeClipFromTimeline(clipId)

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
    })

    it('calculates timeline duration based on clips', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      // Add first clip at position 0, duration 5
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip 1',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      expect(useEditorStore.getState().project.timeline.duration).toBe(5)

      // Add second clip at position 10, duration 3
      useEditorStore.getState().addClipToTimeline({
        id: 'clip2',
        name: 'Test Clip 2',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 3,
        duration: 3,
        animation: undefined,
      }, trackId, 10)

      expect(useEditorStore.getState().project.timeline.duration).toBe(13)
    })
  })

  describe('track management', () => {
    it('starts with one default track', () => {
      const tracks = useEditorStore.getState().project.timeline.tracks
      expect(tracks).toHaveLength(1)
      expect(tracks[0].name).toBe('Track 1')
    })

    it('adds a new track', () => {
      useEditorStore.getState().addTrack()

      const tracks = useEditorStore.getState().project.timeline.tracks
      expect(tracks).toHaveLength(2)
      expect(tracks[1].name).toBe('Track 2')
    })

    it('removes a track', () => {
      useEditorStore.getState().addTrack()
      const trackId = useEditorStore.getState().project.timeline.tracks[1].id

      useEditorStore.getState().removeTrack(trackId)

      expect(useEditorStore.getState().project.timeline.tracks).toHaveLength(1)
    })

    it('updates track properties', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id

      useEditorStore.getState().updateTrack(trackId, { muted: true, visible: false })

      const track = useEditorStore.getState().project.timeline.tracks[0]
      expect(track.muted).toBe(true)
      expect(track.visible).toBe(false)
    })
  })

  describe('clip operations', () => {
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

    it('splits a clip', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 10,
        duration: 10,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().splitClip(clipId, 5)

      const clips = useEditorStore.getState().project.timeline.clips
      expect(clips).toHaveLength(2)
      expect(clips[0].duration).toBe(5)
      expect(clips[1].duration).toBe(5)
      expect(clips[1].timelinePosition).toBe(5)
    })

    it('duplicates a clip', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().duplicateClip(clipId)

      const clips = useEditorStore.getState().project.timeline.clips
      expect(clips).toHaveLength(2)
      expect(clips[1].name).toBe('Test Clip (copy)')
      expect(clips[1].timelinePosition).toBe(5) // After original
    })

    it('moves clip to different track', () => {
      const track1 = useEditorStore.getState().project.timeline.tracks[0]
      const track2 = useEditorStore.getState().addTrack()

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, track1.id, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().moveClipToTrack(clipId, track2.id)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.trackId).toBe(track2.id)
    })

    it('sets clip timeline position', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().setClipTimelinePosition(clipId, 10)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.timelinePosition).toBe(10)
    })

    it('prevents negative timeline position', () => {
      const state = useEditorStore.getState()
      const trackId = state.project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().setClipTimelinePosition(clipId, -5)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.timelinePosition).toBe(0)
    })
  })

  describe('track operations', () => {
    it('keeps at least one track', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id

      useEditorStore.getState().removeTrack(trackId)

      // Should still have one track
      expect(useEditorStore.getState().project.timeline.tracks).toHaveLength(1)
    })

    it('reorders tracks', () => {
      useEditorStore.getState().addTrack('Track 2')
      useEditorStore.getState().addTrack('Track 3')

      const tracks = useEditorStore.getState().project.timeline.tracks
      const reordered = [tracks[2].id, tracks[0].id, tracks[1].id]

      useEditorStore.getState().reorderTracks(reordered)

      const newTracks = useEditorStore.getState().project.timeline.tracks
      expect(newTracks[0].index).toBe(0)
      expect(newTracks[1].index).toBe(1)
      expect(newTracks[2].index).toBe(2)
    })

    it('removes clips when track is removed', () => {
      // First track exists by default, we add a second one
      const track2 = useEditorStore.getState().addTrack()

      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }
      useEditorStore.getState().addSourceVideo(video)

      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Clip 1',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, track2.id, 0)

      useEditorStore.getState().removeTrack(track2.id)

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
    })
  })
})

describe('projectStore remaining behaviours', () => {
  beforeEach(resetStoreForTest)

  describe('automatic track creation', () => {
    it('stacks a new track on top when every existing track is occupied', () => {
      const first = addClip('clip1', 0)
      const second = addClip('clip2', 5)

      const tracks = store().project.timeline.tracks
      expect(tracks).toHaveLength(2)
      expect(second.trackId).not.toBe(first.trackId)
      const newTrack = tracks.find((t) => t.id === second.trackId)!
      expect(newTrack.index).toBe(1)
      expect(newTrack.name).toBe('Track 2')
      expect(newTrack).toMatchObject({ visible: true, locked: false, muted: false, volume: 1, height: 60 })
    })

    it('names an auto-created text track "Text"', () => {
      addClip('clip1', 0)
      const overlay = store().addTextOverlayClip({ text: 'Hi' })

      const track = store().project.timeline.tracks.find((t) => t.id === overlay.trackId)!
      expect(track.name).toBe('Text')
    })

    it('names an auto-created shape track after the shape', () => {
      addClip('clip1', 0)
      const ellipse = store().addShapeOverlayClip({ type: 'ellipse' })

      expect(store().project.timeline.tracks.find((t) => t.id === ellipse.trackId)!.name).toBe('Ellipse')
    })

    it('names an auto-created blur track "Blur" and gives it blur defaults', () => {
      addClip('clip1', 0)
      const blur = store().addShapeOverlayClip({ type: 'blur' })

      expect(store().project.timeline.tracks.find((t) => t.id === blur.trackId)!.name).toBe('Blur')
      expect(blur.name).toBe('Blur Region')
      expect(blur.shapeData).toMatchObject({
        fillColor: '#00000000',
        strokeWidth: 0,
        blurAmount: 10,
      })
    })
  })

  describe('removeSourceVideo', () => {
    it('drops the clips that referenced it and shortens the timeline', () => {
      addClip('clip1', 0, 4)
      const other: SourceVideo = { ...video, id: 'video2' }
      store().addSourceVideo(other)
      store().addClipToTimeline(
        { id: 'clip2', sourceVideoId: 'video2', name: 'clip2', startTime: 0, endTime: 2, duration: 2 },
        undefined,
        10
      )
      expect(store().project.timeline.duration).toBe(12)

      store().removeSourceVideo('video2')

      expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1'])
      expect(store().project.timeline.clips.map((c) => c.id)).toEqual(['clip1'])
      expect(store().project.timeline.duration).toBe(4)
    })
  })

  describe('rippleDeleteClip', () => {
    it('removes the clip and pulls the later clips on that track back', () => {
      const first = addClip('clip1', 0, 4)
      addClip('clip2', 4, 3, first.trackId)
      addClip('clip3', 10, 2, first.trackId)

      store().setSelectedClipId('clip1')
      store().rippleDeleteClip('clip1')

      const byId = Object.fromEntries(store().project.timeline.clips.map((c) => [c.id, c]))
      expect(byId.clip1).toBeUndefined()
      expect(byId.clip2.timelinePosition).toBe(0)
      expect(byId.clip3.timelinePosition).toBe(6)
      expect(store().project.timeline.duration).toBe(8)
      expect(store().selectedClipId).toBeNull()
    })

    it('leaves clips on other tracks where they are', () => {
      const first = addClip('clip1', 0, 4)
      const onOtherTrack = addClip('clip2', 8, 2)
      expect(onOtherTrack.trackId).not.toBe(first.trackId)

      store().rippleDeleteClip('clip1')

      expect(store().project.timeline.clips.find((c) => c.id === 'clip2')!.timelinePosition).toBe(8)
    })

    it('never pulls a clip before zero', () => {
      const first = addClip('clip1', 5, 10)
      addClip('clip2', 15, 2, first.trackId)

      store().rippleDeleteClip('clip1')

      expect(store().project.timeline.clips.find((c) => c.id === 'clip2')!.timelinePosition).toBe(5)
    })

    it('ignores an unknown clip id', () => {
      addClip('clip1', 0, 4)
      const before = store().project

      store().rippleDeleteClip('nope')

      expect(store().project).toBe(before)
    })

    it('keeps the selection when a different clip is deleted', () => {
      const first = addClip('clip1', 0, 4)
      addClip('clip2', 4, 2, first.trackId)
      store().setSelectedClipId('clip2')

      store().rippleDeleteClip('clip1')

      expect(store().selectedClipId).toBe('clip2')
    })
  })

  describe('shiftClipsAfter', () => {
    it('moves the clips at or after the given time on that track', () => {
      const first = addClip('clip1', 0, 2)
      addClip('clip2', 5, 2, first.trackId)
      addClip('clip3', 10, 2, first.trackId)

      store().shiftClipsAfter(first.trackId, 5, 3)

      const byId = Object.fromEntries(store().project.timeline.clips.map((c) => [c.id, c]))
      expect(byId.clip1.timelinePosition).toBe(0)
      expect(byId.clip2.timelinePosition).toBe(8)
      expect(byId.clip3.timelinePosition).toBe(13)
      expect(store().project.timeline.duration).toBe(15)
    })

    it('clamps a negative shift at zero', () => {
      const first = addClip('clip1', 4, 2)

      store().shiftClipsAfter(first.trackId, 0, -10)

      expect(store().project.timeline.clips[0].timelinePosition).toBe(0)
    })

    it('is a no-op for a zero delta', () => {
      const first = addClip('clip1', 4, 2)
      const before = store().project

      store().shiftClipsAfter(first.trackId, 0, 0)

      expect(store().project).toBe(before)
    })

    it('leaves other tracks alone', () => {
      const first = addClip('clip1', 4, 2)
      const other = addClip('clip2', 4, 2)
      expect(other.trackId).not.toBe(first.trackId)

      store().shiftClipsAfter(first.trackId, 0, 5)

      const byId = Object.fromEntries(store().project.timeline.clips.map((c) => [c.id, c]))
      expect(byId.clip1.timelinePosition).toBe(9)
      expect(byId.clip2.timelinePosition).toBe(4)
    })
  })

  describe('updateClip', () => {
    it('recomputes the clip duration when the trim points move', () => {
      addClip('clip1', 0, 10)

      store().updateClip('clip1', { startTime: 2, endTime: 6 })

      const clip = store().project.timeline.clips[0]
      expect(clip.duration).toBe(4)
      expect(store().project.timeline.duration).toBe(4)
    })

    it('leaves the duration alone for unrelated updates', () => {
      addClip('clip1', 0, 10)

      store().updateClip('clip1', { name: 'Renamed' })

      expect(store().project.timeline.clips[0].duration).toBe(10)
      expect(store().project.timeline.clips[0].name).toBe('Renamed')
    })
  })

  describe('splitClip', () => {
    it('refuses a split at or beyond the clip bounds', () => {
      addClip('clip1', 0, 5)
      const before = store().project

      store().splitClip('clip1', 0)
      expect(store().project).toBe(before)

      store().splitClip('clip1', 5)
      expect(store().project).toBe(before)
    })
  })

  describe('duplicateClip', () => {
    it('places the copy after the original when the track is clear', () => {
      const original = addClip('clip1', 0, 4)

      store().duplicateClip('clip1')

      const copy = store().project.timeline.clips.find((c) => c.id !== 'clip1')!
      expect(copy.timelinePosition).toBe(4)
      expect(copy.trackId).toBe(original.trackId)
      expect(copy.name).toBe('clip1 (copy)')
      expect(store().selectedClipId).toBe(copy.id)
    })

    it('pushes the copy past a clip already occupying that slot', () => {
      const first = addClip('clip1', 0, 4)
      addClip('clip2', 4, 3, first.trackId)

      store().duplicateClip('clip1')

      const copy = store().project.timeline.clips.find(
        (c) => c.id !== 'clip1' && c.id !== 'clip2'
      )!
      expect(copy.timelinePosition).toBe(7)
      expect(store().project.timeline.duration).toBe(11)
    })

    it('walks past every occupied slot, in time order', () => {
      const first = addClip('clip1', 0, 4)
      // Added out of order so the copy placement really depends on the sort.
      addClip('clip3', 8, 3, first.trackId)
      addClip('clip2', 4, 3, first.trackId)

      store().duplicateClip('clip1')

      const copy = store().project.timeline.clips.find(
        (c) => !['clip1', 'clip2', 'clip3'].includes(c.id)
      )!
      expect(copy.timelinePosition).toBe(11)
    })

    it('ignores an unknown clip id', () => {
      addClip('clip1', 0, 4)
      const before = store().project

      store().duplicateClip('nope')

      expect(store().project).toBe(before)
    })
  })

  describe('standalone shape overlays', () => {
    it('adds, updates and removes one, clearing the selection with it', () => {
      const overlay = store().addShapeOverlay({ type: 'ellipse' })
      expect(store().selectedOverlayId).toBe(overlay.id)
      expect(store().selectedOverlayType).toBe('shape')

      store().updateShapeOverlay(overlay.id, { strokeWidth: 4 })
      expect(store().project.timeline.shapeOverlays![0].strokeWidth).toBe(4)

      store().removeShapeOverlay(overlay.id)

      expect(store().project.timeline.shapeOverlays).toEqual([])
      expect(store().selectedOverlayId).toBeNull()
      expect(store().selectedOverlayType).toBeNull()
    })

    it('keeps a different selection when another overlay is removed', () => {
      const first = store().addShapeOverlay({ type: 'ellipse' })
      const second = store().addShapeOverlay({ type: 'rectangle' })
      expect(store().selectedOverlayId).toBe(second.id)

      store().removeShapeOverlay(first.id)

      expect(store().selectedOverlayId).toBe(second.id)
      expect(store().selectedOverlayType).toBe('shape')
      expect(store().project.timeline.shapeOverlays!.map((o) => o.id)).toEqual([second.id])
    })
  })

  describe('recalculateTimelineDuration', () => {
    it('resyncs the stored duration with the clips', () => {
      addClip('clip1', 0, 4)
      useEditorStore.setState({
        project: {
          ...store().project,
          timeline: { ...store().project.timeline, duration: 999 },
        },
      })

      store().recalculateTimelineDuration()

      expect(store().project.timeline.duration).toBe(4)
    })
  })
})
