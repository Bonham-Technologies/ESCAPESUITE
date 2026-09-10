import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { SourceVideo } from './types'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'

describe('projectStore integration', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useEditorStore.getState().resetProject()
    // Clear history after reset
    useEditorStore.setState({ history: { past: [], future: [] } })
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
})

describe('projectStore remaining behaviours', () => {
  beforeEach(resetStoreForTest)

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
})
