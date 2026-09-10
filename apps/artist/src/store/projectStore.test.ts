import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { SourceVideo } from './types'

describe('projectStore integration', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useEditorStore.getState().resetProject()
    // Clear history after reset
    useEditorStore.setState({ history: { past: [], future: [] } })
  })

  describe('source video management', () => {
    it('adds a source video', () => {
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

      const state = useEditorStore.getState()
      expect(state.sourceVideos).toHaveLength(1)
      expect(state.sourceVideos[0].id).toBe('video1')
      expect(state.sourceVideos[0].name).toBe('test.mp4')
    })

    it('removes a source video', () => {
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
      expect(useEditorStore.getState().sourceVideos).toHaveLength(1)

      useEditorStore.getState().removeSourceVideo('video1')
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)
    })
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

  describe('undo/redo', () => {
    it('can undo an action', () => {
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
      expect(useEditorStore.getState().sourceVideos).toHaveLength(1)

      useEditorStore.getState().undo()
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)
    })

    it('can redo an undone action', () => {
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
      useEditorStore.getState().undo()
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)

      useEditorStore.getState().redo()
      expect(useEditorStore.getState().sourceVideos).toHaveLength(1)
    })

    it('clears future history when new action is taken after undo', () => {
      const video1: SourceVideo = {
        id: 'video1',
        name: 'test1.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      const video2: SourceVideo = {
        id: 'video2',
        name: 'test2.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video1)
      useEditorStore.getState().undo()

      // Future should have the video1 action
      expect(useEditorStore.getState().history.future).toHaveLength(1)

      // Add a different video - should clear future
      useEditorStore.getState().addSourceVideo(video2)
      expect(useEditorStore.getState().history.future).toHaveLength(0)
    })
  })

  describe('playback controls', () => {
    it('sets current time', () => {
      useEditorStore.getState().setCurrentTime(5.5)
      expect(useEditorStore.getState().currentTime).toBe(5.5)
    })

    it('toggles play state', () => {
      expect(useEditorStore.getState().isPlaying).toBe(false)

      useEditorStore.getState().setIsPlaying(true)
      expect(useEditorStore.getState().isPlaying).toBe(true)

      useEditorStore.getState().setIsPlaying(false)
      expect(useEditorStore.getState().isPlaying).toBe(false)
    })
  })

  describe('selection', () => {
    it('selects and deselects clips', () => {
      useEditorStore.getState().setSelectedClipId('clip1')
      expect(useEditorStore.getState().selectedClipId).toBe('clip1')

      useEditorStore.getState().setSelectedClipId(null)
      expect(useEditorStore.getState().selectedClipId).toBeNull()
    })

    it('selects and deselects tracks', () => {
      useEditorStore.getState().setSelectedTrackId('track1')
      expect(useEditorStore.getState().selectedTrackId).toBe('track1')

      useEditorStore.getState().setSelectedTrackId(null)
      expect(useEditorStore.getState().selectedTrackId).toBeNull()
    })
  })

  describe('zoom and snap', () => {
    it('sets zoom level', () => {
      useEditorStore.getState().setZoom(2)
      expect(useEditorStore.getState().zoom).toBe(2)
    })

    it('clamps zoom to valid range', () => {
      useEditorStore.getState().setZoom(0.01)
      expect(useEditorStore.getState().zoom).toBe(0.1) // Min zoom

      useEditorStore.getState().setZoom(100)
      expect(useEditorStore.getState().zoom).toBe(10) // Max zoom
    })

    it('toggles snap', () => {
      expect(useEditorStore.getState().snapEnabled).toBe(true)

      useEditorStore.getState().setSnapEnabled(false)
      expect(useEditorStore.getState().snapEnabled).toBe(false)
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

  describe('clip transform', () => {
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
    })

    it('updates clip transform', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipTransform(clipId, {
        x: 0.25,
        y: 0.75,
        scaleX: 0.5,
        opacity: 0.8,
      })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.transform.x).toBe(0.25)
      expect(clip.transform.y).toBe(0.75)
      expect(clip.transform.scaleX).toBe(0.5)
      expect(clip.transform.opacity).toBe(0.8)
    })

    it('updates clip blend mode', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipBlendMode(clipId, 'multiply')

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.blendMode).toBe('multiply')
    })

    it('updates clip effects', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipEffects(clipId, { blur: 10 })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.effects.blur).toBe(10)
    })

    it('updates clip transition', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipTransition(clipId, {
        type: 'fade',
        duration: 1,
      })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.transition.type).toBe('fade')
      expect(clip.transition.duration).toBe(1)
    })
  })

  describe('clip animation', () => {
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
    })

    it('updates clip animation presets', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipAnimation(clipId, {
        in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.animation?.in.type).toBe('fade')
      expect(clip.animation?.in.duration).toBe(0.5)
    })

    it('sets keyframe for clip', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 1,
        value: 0.5,
        easing: 'linear',
      })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      // Auto-creates time-0 keyframe with base value + user keyframe at time 1
      expect(clip.animation?.keyframes.opacity).toHaveLength(2)
      expect(clip.animation?.keyframes.opacity?.[0].time).toBe(0) // Auto-created
      expect(clip.animation?.keyframes.opacity?.[0].value).toBe(1) // Base opacity value
      expect(clip.animation?.keyframes.opacity?.[1].time).toBe(1)
      expect(clip.animation?.keyframes.opacity?.[1].value).toBe(0.5)
    })

    it('removes keyframe from clip', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      // Add keyframe first (this also auto-creates a time-0 keyframe)
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 1,
        value: 0.5,
        easing: 'linear',
      })

      // Remove both keyframes (the user one and the auto-created one)
      useEditorStore.getState().removeClipKeyframe(clipId, 'opacity', 1)
      useEditorStore.getState().removeClipKeyframe(clipId, 'opacity', 0)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.animation?.keyframes.opacity).toBeUndefined()
    })

    it('clears all keyframes for a property', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      // Add multiple keyframes
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 0,
        value: 0,
        easing: 'linear',
      })
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 1,
        value: 1,
        easing: 'linear',
      })

      // Clear opacity keyframes
      useEditorStore.getState().clearClipKeyframes(clipId, 'opacity')

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.animation?.keyframes.opacity).toBeUndefined()
    })

    it('clears all keyframes', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      // Add keyframes for multiple properties
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 0,
        value: 0,
        easing: 'linear',
      })
      useEditorStore.getState().setClipKeyframe(clipId, 'x', {
        time: 0,
        value: 0,
        easing: 'linear',
      })

      // Clear all keyframes
      useEditorStore.getState().clearClipKeyframes(clipId)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(Object.keys(clip.animation?.keyframes || {}).length).toBe(0)
    })

    it('moves keyframe to new time', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      // Add a keyframe
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 1,
        value: 0.5,
        easing: 'ease-in',
      })

      // Move it to a new time
      useEditorStore.getState().moveClipKeyframe(clipId, 'opacity', 1, 2)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      // Auto-created time-0 keyframe + moved keyframe at time 2
      expect(clip.animation?.keyframes.opacity).toHaveLength(2)
      expect(clip.animation?.keyframes.opacity?.[0].time).toBe(0) // Auto-created start keyframe
      expect(clip.animation?.keyframes.opacity?.[1].time).toBe(2)
      expect(clip.animation?.keyframes.opacity?.[1].value).toBe(0.5)
      expect(clip.animation?.keyframes.opacity?.[1].easing).toBe('ease-in')
    })

    it('moves keyframe and replaces existing keyframe at destination', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      // Add two keyframes
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 1,
        value: 0.5,
        easing: 'linear',
      })
      useEditorStore.getState().setClipKeyframe(clipId, 'opacity', {
        time: 2,
        value: 1,
        easing: 'ease-out',
      })

      // Move first keyframe to second keyframe's position
      useEditorStore.getState().moveClipKeyframe(clipId, 'opacity', 1, 2)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      // Auto-created time-0 keyframe + the moved keyframe (which replaced the one at time 2)
      expect(clip.animation?.keyframes.opacity).toHaveLength(2)
      expect(clip.animation?.keyframes.opacity?.[0].time).toBe(0) // Auto-created start keyframe
      expect(clip.animation?.keyframes.opacity?.[1].time).toBe(2)
      expect(clip.animation?.keyframes.opacity?.[1].value).toBe(0.5) // Value from moved keyframe
    })

    it('keeps keyframes sorted after move', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      // Add three keyframes
      useEditorStore.getState().setClipKeyframe(clipId, 'x', {
        time: 0,
        value: 0,
        easing: 'linear',
      })
      useEditorStore.getState().setClipKeyframe(clipId, 'x', {
        time: 1,
        value: 0.5,
        easing: 'linear',
      })
      useEditorStore.getState().setClipKeyframe(clipId, 'x', {
        time: 3,
        value: 1,
        easing: 'linear',
      })

      // Move last keyframe to middle
      useEditorStore.getState().moveClipKeyframe(clipId, 'x', 3, 0.5)

      const clip = useEditorStore.getState().project.timeline.clips[0]
      const keyframes = clip.animation?.keyframes.x
      expect(keyframes).toHaveLength(3)
      // Should be sorted by time
      expect(keyframes?.[0].time).toBe(0)
      expect(keyframes?.[1].time).toBe(0.5)
      expect(keyframes?.[2].time).toBe(1)
    })
  })

  describe('overlay clips', () => {
    it('adds text overlay clip', () => {
      const clip = useEditorStore.getState().addTextOverlayClip({
        text: 'Hello World',
      })

      expect(clip.overlayType).toBe('text')
      expect(clip.textData?.text).toBe('Hello World')
      expect(clip.sourceVideoId).toBe('') // Empty for overlays
    })

    it('adds shape overlay clip', () => {
      const clip = useEditorStore.getState().addShapeOverlayClip({
        type: 'ellipse',
      })

      expect(clip.overlayType).toBe('shape')
      expect(clip.shapeData?.type).toBe('ellipse')
      expect(clip.name).toBe('Ellipse')
    })

    it('updates text overlay data', () => {
      const clip = useEditorStore.getState().addTextOverlayClip({
        text: 'Original',
      })

      useEditorStore.getState().updateTextOverlayData(clip.id, {
        text: 'Updated',
        fontSize: 72,
      })

      const updated = useEditorStore.getState().project.timeline.clips[0]
      expect(updated.textData?.text).toBe('Updated')
      expect(updated.textData?.fontSize).toBe(72)
    })

    it('updates shape overlay data', () => {
      const clip = useEditorStore.getState().addShapeOverlayClip({
        type: 'rectangle',
      })

      useEditorStore.getState().updateShapeOverlayData(clip.id, {
        fillColor: '#ff0000ff',
        blurAmount: 10,
      })

      const updated = useEditorStore.getState().project.timeline.clips[0]
      expect(updated.shapeData?.fillColor).toBe('#ff0000ff')
      expect(updated.shapeData?.blurAmount).toBe(10)
    })
  })

  describe('legacy overlays', () => {
    it('adds and updates legacy text overlay', () => {
      const overlay = useEditorStore.getState().addTextOverlay({
        text: 'Legacy Text',
      })

      expect(overlay.text).toBe('Legacy Text')

      useEditorStore.getState().updateTextOverlay(overlay.id, {
        text: 'Updated Text',
      })

      const updated = useEditorStore.getState().project.timeline.textOverlays[0]
      expect(updated.text).toBe('Updated Text')
    })

    it('removes legacy text overlay', () => {
      const overlay = useEditorStore.getState().addTextOverlay({
        text: 'To Remove',
      })

      useEditorStore.getState().removeTextOverlay(overlay.id)

      expect(useEditorStore.getState().project.timeline.textOverlays).toHaveLength(0)
    })

    it('adds and updates legacy shape overlay', () => {
      const overlay = useEditorStore.getState().addShapeOverlay({
        type: 'rectangle',
      })

      expect(overlay.type).toBe('rectangle')

      useEditorStore.getState().updateShapeOverlay(overlay.id, {
        type: 'ellipse',
      })

      const updated = useEditorStore.getState().project.timeline.shapeOverlays[0]
      expect(updated.type).toBe('ellipse')
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

  describe('overlay selection', () => {
    it('deselects clip when selecting overlay', () => {
      useEditorStore.getState().setSelectedClipId('clip1')
      expect(useEditorStore.getState().selectedClipId).toBe('clip1')

      useEditorStore.getState().setSelectedOverlay('overlay1', 'text')

      expect(useEditorStore.getState().selectedOverlayId).toBe('overlay1')
      expect(useEditorStore.getState().selectedClipId).toBeNull()
    })

    it('deselects overlay when selecting clip', () => {
      useEditorStore.getState().setSelectedOverlay('overlay1', 'text')
      expect(useEditorStore.getState().selectedOverlayId).toBe('overlay1')

      useEditorStore.getState().setSelectedClipId('clip1')

      expect(useEditorStore.getState().selectedClipId).toBe('clip1')
      expect(useEditorStore.getState().selectedOverlayId).toBeNull()
    })
  })
})

// Test helper functions
import {
  getClipsAtTime,
  getClipAtTime,
  getClipPosition,
  getSnapPoints,
  findNearestSnapPoint,
  wouldOverlap,
  selectTimelineDuration,
  selectClipCount,
  selectSelectedClip,
  selectSelectedTrack,
} from './projectStore'
import type { Clip, Track } from './types'

describe('projectStore helper functions', () => {
  const createMockClip = (id: string, trackId: string, position: number, duration: number): Clip => ({
    id,
    sourceVideoId: 'video1',
    name: `Clip ${id}`,
    startTime: 0,
    endTime: duration,
    duration,
    trackId,
    timelinePosition: position,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
  })

  const createMockTrack = (id: string, index: number, visible = true): Track => ({
    id,
    name: `Track ${index + 1}`,
    index,
    visible,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
  })

  describe('getClipsAtTime', () => {
    it('returns clips at the given time', () => {
      const tracks = [createMockTrack('t1', 0), createMockTrack('t2', 1)]
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 2, 5),
      ]

      const result = getClipsAtTime(clips, tracks, 3)

      expect(result).toHaveLength(2)
      expect(result[0].clip.id).toBe('c1')
      expect(result[1].clip.id).toBe('c2')
    })

    it('excludes clips on hidden tracks', () => {
      const tracks = [createMockTrack('t1', 0), createMockTrack('t2', 1, false)]
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 0, 5),
      ]

      const result = getClipsAtTime(clips, tracks, 2)

      expect(result).toHaveLength(1)
      expect(result[0].clip.id).toBe('c1')
    })

    it('sorts by track index', () => {
      const tracks = [createMockTrack('t1', 1), createMockTrack('t2', 0)]
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 0, 5),
      ]

      const result = getClipsAtTime(clips, tracks, 2)

      expect(result[0].clip.trackId).toBe('t2') // Lower index first
      expect(result[1].clip.trackId).toBe('t1')
    })

    it('calculates clipTime correctly', () => {
      const tracks = [createMockTrack('t1', 0)]
      const clips = [createMockClip('c1', 't1', 5, 10)]

      const result = getClipsAtTime(clips, tracks, 8)

      expect(result[0].clipTime).toBe(3) // 8 - 5
    })
  })

  describe('getClipAtTime', () => {
    it('returns the clip at the given time', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 5, 5),
      ]

      const result = getClipAtTime(clips, 3)

      expect(result?.clip.id).toBe('c1')
      expect(result?.clipTime).toBe(3)
    })

    it('returns null if no clip at time', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      const result = getClipAtTime(clips, 10)

      expect(result).toBeNull()
    })
  })

  describe('getClipPosition', () => {
    it('returns the timeline position of a clip', () => {
      const clips = [
        createMockClip('c1', 't1', 5, 10),
        createMockClip('c2', 't1', 20, 5),
      ]

      expect(getClipPosition(clips, 'c1')).toBe(5)
      expect(getClipPosition(clips, 'c2')).toBe(20)
    })

    it('returns -1 for non-existent clip', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(getClipPosition(clips, 'nonexistent')).toBe(-1)
    })
  })

  describe('getSnapPoints', () => {
    it('returns snap points from clip edges', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 10, 3),
      ]

      const points = getSnapPoints(clips)

      expect(points).toContain(0) // Always includes 0
      expect(points).toContain(5) // End of c1
      expect(points).toContain(10) // Start of c2
      expect(points).toContain(13) // End of c2
    })

    it('excludes specified clip', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 10, 3),
      ]

      const points = getSnapPoints(clips, 'c1')

      expect(points).not.toContain(5) // c1 end excluded
      expect(points).toContain(10) // c2 still included
    })
  })

  describe('findNearestSnapPoint', () => {
    it('finds the nearest snap point within threshold', () => {
      const snapPoints = [0, 5, 10, 15]

      expect(findNearestSnapPoint(4.8, snapPoints, 1)).toBe(5)
      expect(findNearestSnapPoint(10.2, snapPoints, 1)).toBe(10)
    })

    it('returns null if no point within threshold', () => {
      const snapPoints = [0, 10, 20]

      expect(findNearestSnapPoint(5, snapPoints, 1)).toBeNull()
    })
  })

  describe('wouldOverlap', () => {
    it('detects overlap with existing clips', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)] // 5-10

      expect(wouldOverlap(clips, 't1', 3, 5)).toBe(true) // 3-8 overlaps
      expect(wouldOverlap(clips, 't1', 8, 5)).toBe(true) // 8-13 overlaps
      expect(wouldOverlap(clips, 't1', 6, 2)).toBe(true) // 6-8 inside
    })

    it('allows non-overlapping placement', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)] // 5-10

      expect(wouldOverlap(clips, 't1', 0, 5)).toBe(false) // 0-5 adjacent
      expect(wouldOverlap(clips, 't1', 10, 5)).toBe(false) // 10-15 adjacent
      expect(wouldOverlap(clips, 't1', 15, 5)).toBe(false) // 15-20 separated
    })

    it('ignores clips on different tracks', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)]

      expect(wouldOverlap(clips, 't2', 5, 5)).toBe(false)
    })

    it('excludes specified clip from check', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)]

      // Same position as c1 but excluding c1 from check
      expect(wouldOverlap(clips, 't1', 5, 5, 'c1')).toBe(false)
    })
  })

  describe('selectors', () => {
    beforeEach(() => {
      useEditorStore.getState().resetProject()
      useEditorStore.setState({ history: { past: [], future: [] } })
    })

    it('selectTimelineDuration returns duration', () => {
      const state = useEditorStore.getState()
      expect(selectTimelineDuration(state)).toBe(0)
    })

    it('selectClipCount returns clip count', () => {
      const state = useEditorStore.getState()
      expect(selectClipCount(state)).toBe(0)
    })

    it('selectSelectedClip returns selected clip', () => {
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

      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().setSelectedClipId(clipId)

      const state = useEditorStore.getState()
      expect(selectSelectedClip(state)?.id).toBe(clipId)
    })

    it('selectSelectedTrack returns selected track', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().setSelectedTrackId(trackId)

      const state = useEditorStore.getState()
      expect(selectSelectedTrack(state)?.id).toBe(trackId)
    })
  })

  describe('updateClipTransform with skipHistory', () => {
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
    })

    it('adds to history when skipHistory is false', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      const initialPastLength = useEditorStore.getState().history.past.length

      useEditorStore.getState().updateClipTransform(clipId, { x: 0.5 }, false)

      expect(useEditorStore.getState().history.past.length).toBe(initialPastLength + 1)
    })

    it('skips history when skipHistory is true', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      const initialPastLength = useEditorStore.getState().history.past.length

      useEditorStore.getState().updateClipTransform(clipId, { x: 0.5 }, true)

      expect(useEditorStore.getState().history.past.length).toBe(initialPastLength)
      // But the transform should still be updated
      expect(useEditorStore.getState().project.timeline.clips[0].transform.x).toBe(0.5)
    })

    it('defaults to adding history when skipHistory is undefined', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      const initialPastLength = useEditorStore.getState().history.past.length

      useEditorStore.getState().updateClipTransform(clipId, { x: 0.5 })

      expect(useEditorStore.getState().history.past.length).toBe(initialPastLength + 1)
    })
  })

  describe('markers', () => {
    beforeEach(() => {
      useEditorStore.getState().clearMarkers()
    })

    it('adds a marker', () => {
      const marker = useEditorStore.getState().addMarker(5, 'Test Marker', '#ff0000')

      expect(marker.time).toBe(5)
      expect(marker.label).toBe('Test Marker')
      expect(marker.color).toBe('#ff0000')
      expect(useEditorStore.getState().markers).toHaveLength(1)
    })

    it('adds markers in sorted order by time', () => {
      useEditorStore.getState().addMarker(10, 'Second')
      useEditorStore.getState().addMarker(5, 'First')
      useEditorStore.getState().addMarker(15, 'Third')

      const markers = useEditorStore.getState().markers
      expect(markers[0].time).toBe(5)
      expect(markers[1].time).toBe(10)
      expect(markers[2].time).toBe(15)
    })

    it('uses default values for label and color', () => {
      const marker = useEditorStore.getState().addMarker(5)

      expect(marker.label).toBe('')
      expect(marker.color).toBe('#ffcc00')
    })

    it('removes a marker', () => {
      const marker = useEditorStore.getState().addMarker(5, 'Test')
      expect(useEditorStore.getState().markers).toHaveLength(1)

      useEditorStore.getState().removeMarker(marker.id)
      expect(useEditorStore.getState().markers).toHaveLength(0)
    })

    it('updates a marker', () => {
      const marker = useEditorStore.getState().addMarker(5, 'Original')

      useEditorStore.getState().updateMarker(marker.id, { label: 'Updated', time: 10 })

      const updated = useEditorStore.getState().markers[0]
      expect(updated.label).toBe('Updated')
      expect(updated.time).toBe(10)
    })

    it('clears all markers', () => {
      useEditorStore.getState().addMarker(5, 'First')
      useEditorStore.getState().addMarker(10, 'Second')
      expect(useEditorStore.getState().markers).toHaveLength(2)

      useEditorStore.getState().clearMarkers()
      expect(useEditorStore.getState().markers).toHaveLength(0)
    })

    it('goToNextMarker moves to the next marker', () => {
      useEditorStore.getState().addMarker(5)
      useEditorStore.getState().addMarker(10)
      useEditorStore.getState().setCurrentTime(0)

      useEditorStore.getState().goToNextMarker()
      expect(useEditorStore.getState().currentTime).toBe(5)

      useEditorStore.getState().goToNextMarker()
      expect(useEditorStore.getState().currentTime).toBe(10)
    })

    it('goToNextMarker does nothing when no next marker exists', () => {
      useEditorStore.getState().addMarker(5)
      useEditorStore.getState().setCurrentTime(10)

      useEditorStore.getState().goToNextMarker()
      expect(useEditorStore.getState().currentTime).toBe(10)
    })

    it('goToPreviousMarker moves to the previous marker', () => {
      useEditorStore.getState().addMarker(5)
      useEditorStore.getState().addMarker(10)
      useEditorStore.getState().setCurrentTime(15)

      useEditorStore.getState().goToPreviousMarker()
      expect(useEditorStore.getState().currentTime).toBe(10)

      useEditorStore.getState().goToPreviousMarker()
      expect(useEditorStore.getState().currentTime).toBe(5)
    })

    it('goToPreviousMarker does nothing when no previous marker exists', () => {
      useEditorStore.getState().addMarker(10)
      useEditorStore.getState().setCurrentTime(5)

      useEditorStore.getState().goToPreviousMarker()
      expect(useEditorStore.getState().currentTime).toBe(5)
    })
  })

  describe('UI state', () => {
    it('sets active tool', () => {
      expect(useEditorStore.getState().activeTool).toBe('select')

      useEditorStore.getState().setActiveTool('razor')
      expect(useEditorStore.getState().activeTool).toBe('razor')

      useEditorStore.getState().setActiveTool('ripple')
      expect(useEditorStore.getState().activeTool).toBe('ripple')
    })

    it('sets loop playback', () => {
      expect(useEditorStore.getState().loopPlayback).toBe(false)

      useEditorStore.getState().setLoopPlayback(true)
      expect(useEditorStore.getState().loopPlayback).toBe(true)

      useEditorStore.getState().setLoopPlayback(false)
      expect(useEditorStore.getState().loopPlayback).toBe(false)
    })
  })
})

describe('projectStore remaining behaviours', () => {
  const video: SourceVideo = {
    id: 'video1',
    name: 'test.mp4',
    duration: 30,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/mp4',
    size: 1000,
  }

  const store = () => useEditorStore.getState()

  /** Add a media clip and return the clip the store actually created. */
  function addClip(
    id: string,
    position: number,
    duration = 2,
    trackId?: string
  ) {
    store().addClipToTimeline(
      { id, sourceVideoId: video.id, name: id, startTime: 0, endTime: duration, duration },
      trackId,
      position
    )
    return store().project.timeline.clips.find((c) => c.id === id)!
  }

  beforeEach(() => {
    store().resetProject()
    useEditorStore.setState({
      history: { past: [], future: [] },
      markers: [],
      keyframePanelState: {
        ...store().keyframePanelState,
        isOpen: false,
        selectedProperty: null,
        graphZoom: 1,
      },
    })
    store().addSourceVideo(video)
  })

  describe('history size cap', () => {
    it('drops the oldest snapshot once 50 are stored', () => {
      // Each undoable action snapshots the state *before* it, so 60 calls push
      // the initial state plus widths 100..158 — 60 entries, capped at 50.
      for (let i = 0; i < 60; i++) store().setProjectResolution(100 + i, 100)

      expect(store().history.past).toHaveLength(50)
      // The ten oldest snapshots, including the initial state, have aged out.
      expect(store().history.past[0].project.resolution.width).toBe(109)
      expect(store().history.past[49].project.resolution.width).toBe(158)
    })
  })

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

  describe('setClipKeyframe', () => {
    it('replaces a keyframe already sitting at that time', () => {
      addClip('clip1', 0, 5)
      store().setClipKeyframe('clip1', 'opacity', { time: 0, value: 1, easing: 'linear' })
      store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.5, easing: 'linear' })

      store().setClipKeyframe('clip1', 'opacity', { time: 2.0005, value: 0.25, easing: 'ease-in' })

      const keyframes = store().project.timeline.clips[0].animation!.keyframes.opacity!
      expect(keyframes).toEqual([
        { time: 0, value: 1, easing: 'linear' },
        { time: 2.0005, value: 0.25, easing: 'ease-in' },
      ])
    })

    it('auto-creates a zero keyframe from the clip transform', () => {
      addClip('clip1', 0, 5)
      store().updateClipTransform('clip1', { x: 0.25 })

      store().setClipKeyframe('clip1', 'x', { time: 3, value: 0.75, easing: 'linear' })

      expect(store().project.timeline.clips[0].animation!.keyframes.x).toEqual([
        { time: 0, value: 0.25, easing: 'ease-out' },
        { time: 3, value: 0.75, easing: 'linear' },
      ])
    })

    it('auto-creates a zero keyframe from the clip blur effect', () => {
      addClip('clip1', 0, 5)
      store().updateClipEffects('clip1', { blur: 7 })

      store().setClipKeyframe('clip1', 'blur', { time: 3, value: 0, easing: 'linear' })

      expect(store().project.timeline.clips[0].animation!.keyframes.blur![0]).toEqual({
        time: 0,
        value: 7,
        easing: 'ease-out',
      })
    })

    it('auto-creates a zero volume keyframe at full volume', () => {
      addClip('clip1', 0, 5)

      store().setClipKeyframe('clip1', 'volume', { time: 3, value: 0, easing: 'linear' })

      expect(store().project.timeline.clips[0].animation!.keyframes.volume![0]).toEqual({
        time: 0,
        value: 1,
        easing: 'ease-out',
      })
    })

    it('auto-creates zero keyframes from a text overlay position and rotation', () => {
      const overlay = store().addTextOverlayClip({ text: 'Hi', x: 0.2, y: 0.8, rotation: 30 })

      store().setClipKeyframe(overlay.id, 'x', { time: 2, value: 0.9, easing: 'linear' })
      store().setClipKeyframe(overlay.id, 'rotation', { time: 2, value: 90, easing: 'linear' })

      const clip = store().project.timeline.clips.find((c) => c.id === overlay.id)!
      expect(clip.animation!.keyframes.x![0]).toEqual({ time: 0, value: 0.2, easing: 'ease-out' })
      expect(clip.animation!.keyframes.rotation![0]).toEqual({ time: 0, value: 30, easing: 'ease-out' })
    })

    it('treats a text overlay with no rotation as zero', () => {
      const overlay = store().addTextOverlayClip({ text: 'Hi' })
      store().updateTextOverlayData(overlay.id, { rotation: undefined })

      store().setClipKeyframe(overlay.id, 'rotation', { time: 2, value: 45, easing: 'linear' })

      const clip = store().project.timeline.clips.find((c) => c.id === overlay.id)!
      expect(clip.animation!.keyframes.rotation![0].value).toBe(0)
    })

    it('auto-creates a zero keyframe from a shape overlay position', () => {
      const overlay = store().addShapeOverlayClip({ type: 'rectangle', x: 0.3, y: 0.4 })

      store().setClipKeyframe(overlay.id, 'y', { time: 2, value: 0.9, easing: 'linear' })

      const clip = store().project.timeline.clips.find((c) => c.id === overlay.id)!
      expect(clip.animation!.keyframes.y![0]).toEqual({ time: 0, value: 0.4, easing: 'ease-out' })
    })

    it('does not auto-create when the caller already keyframed time zero', () => {
      addClip('clip1', 0, 5)

      store().setClipKeyframe('clip1', 'opacity', { time: 0, value: 0.5, easing: 'linear' })

      expect(store().project.timeline.clips[0].animation!.keyframes.opacity).toEqual([
        { time: 0, value: 0.5, easing: 'linear' },
      ])
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

  describe('markers', () => {
    it('updates a marker and keeps the list sorted by time', () => {
      const first = store().addMarker(1, 'A')
      store().addMarker(5, 'B')

      store().updateMarker(first.id, { time: 8, label: 'Moved' })

      expect(store().markers.map((m) => [m.time, m.label])).toEqual([
        [5, 'B'],
        [8, 'Moved'],
      ])
    })
  })

  describe('keyframe panel state', () => {
    it('stores the panel size, selected property and clamped zoom', () => {
      store().setKeyframePanelSize({ width: 700, height: 800 })
      store().setKeyframePanelSelectedProperty('opacity')
      store().setKeyframePanelZoom(2)

      expect(store().keyframePanelState.size).toEqual({ width: 700, height: 800 })
      expect(store().keyframePanelState.selectedProperty).toBe('opacity')
      expect(store().keyframePanelState.graphZoom).toBe(2)

      store().setKeyframePanelZoom(99)
      expect(store().keyframePanelState.graphZoom).toBe(4)

      store().setKeyframePanelZoom(0)
      expect(store().keyframePanelState.graphZoom).toBe(0.5)

      store().setKeyframePanelSelectedProperty(null)
      expect(store().keyframePanelState.selectedProperty).toBeNull()
    })
  })

  describe('setProject migration', () => {
    it('leaves a modern project alone but fills in missing overlay arrays', () => {
      const modern = {
        id: 'p',
        name: 'Modern',
        created: 1,
        modified: 1,
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [
            { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [],
          duration: 0,
        },
      }

      store().setProject(modern as never)

      expect(store().project.timeline.tracks).toHaveLength(1)
      expect(store().project.timeline.textOverlays).toEqual([])
      expect(store().project.timeline.shapeOverlays).toEqual([])
    })

    it('gives a project with no resolution the 1080p default', () => {
      const legacy = {
        id: 'p',
        name: 'Legacy',
        created: 1,
        modified: 1,
        timeline: {
          tracks: [
            { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [],
          textOverlays: [],
          shapeOverlays: [],
          duration: 0,
        },
      }

      store().setProject(legacy as never)

      expect(store().project.resolution).toEqual({ width: 1920, height: 1080 })
    })

    it('lays trackless clips out sequentially on a new default track', () => {
      const legacy = {
        id: 'p',
        name: 'Ancient',
        created: 1,
        modified: 1,
        resolution: { width: 1920, height: 1080 },
        timeline: {
          tracks: [],
          clips: [
            { id: 'a', sourceVideoId: 'video1', name: 'a', startTime: 0, endTime: 3, duration: 3 },
            { id: 'b', sourceVideoId: 'video1', name: 'b', startTime: 0, endTime: 2, duration: 2 },
          ],
          duration: 0,
        },
      }

      store().setProject(legacy as never)

      const timeline = store().project.timeline
      expect(timeline.tracks).toHaveLength(1)
      const trackId = timeline.tracks[0].id
      expect(timeline.clips.map((c) => [c.id, c.timelinePosition, c.trackId])).toEqual([
        ['a', 0, trackId],
        ['b', 3, trackId],
      ])
      expect(timeline.clips[0].blendMode).toBe('normal')
      expect(timeline.clips[0].transform).toBeDefined()
      expect(timeline.clips[0].effects).toBeDefined()
      expect(timeline.clips[0].transition).toBeDefined()
      expect(timeline.duration).toBe(5)
      expect(timeline.textOverlays).toEqual([])
      expect(timeline.shapeOverlays).toEqual([])
    })

    it('keeps positions that legacy clips already carried', () => {
      const legacy = {
        id: 'p',
        name: 'Ancient',
        created: 1,
        modified: 1,
        resolution: { width: 1920, height: 1080 },
        timeline: {
          tracks: [],
          clips: [
            { id: 'a', sourceVideoId: 'video1', name: 'a', startTime: 0, endTime: 3, duration: 3, timelinePosition: 10 },
            { id: 'b', sourceVideoId: 'video1', name: 'b', startTime: 0, endTime: 2, duration: 2 },
          ],
          duration: 0,
        },
      }

      store().setProject(legacy as never)

      expect(store().project.timeline.clips.map((c) => c.timelinePosition)).toEqual([10, 0])
    })
  })
})
