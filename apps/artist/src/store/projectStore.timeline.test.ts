import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { SourceVideo } from './types'
import { addClip, resetStoreForTest, store, video } from '../test/fixtures/projectStore'

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

    // ESCSUITE-115: an id that names no clip is nothing to do, the same
    // refusal `rippleDeleteClip` already gives (`if (!clipToDelete) return
    // state`) — this action just never reported it.
    it('returns false and writes nothing for an unknown clip id', () => {
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, useEditorStore.getState().project.timeline.tracks[0].id, 0)

      const before = useEditorStore.getState().project.timeline.clips
      const entries = useEditorStore.getState().history.past.length

      const result = useEditorStore.getState().removeClipFromTimeline('nope')

      expect(result).toBe(false)
      expect(useEditorStore.getState().project.timeline.clips).toBe(before)
      expect(useEditorStore.getState().history.past.length).toBe(entries)
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

    it('does not remove a locked track, or its clips, and pushes no history entry (ESCSUITE-84)', () => {
      useEditorStore.getState().addTrack()
      const trackId = useEditorStore.getState().project.timeline.tracks[1].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
      }, trackId, 0)
      useEditorStore.getState().updateTrack(trackId, { locked: true })
      // updateTrack and addClipToTimeline each push their own history entry;
      // clear those so the assertion below is about removeTrack's own effect.
      useEditorStore.setState({ history: { past: [], future: [] } })

      useEditorStore.getState().removeTrack(trackId)

      const state = useEditorStore.getState()
      expect(state.project.timeline.tracks).toHaveLength(2)
      expect(state.project.timeline.tracks.some(t => t.id === trackId)).toBe(true)
      expect(state.project.timeline.clips).toHaveLength(1)
      expect(state.history.past.length).toBe(0)
    })

    // ESCSUITE-100: a clipboard entry naming a track that's just been removed
    // can never be pasted back — dropping it here is what keeps pasteClips's
    // own "track no longer on the timeline" refusal a rare belt-and-braces
    // check rather than the normal way this is reached.
    it('drops clipboard entries whose track it removes', () => {
      useEditorStore.getState().addTrack()
      const tracks = useEditorStore.getState().project.timeline.tracks
      const [keptTrack, removedTrack] = tracks

      useEditorStore.getState().addClipToTimeline({
        id: 'clip-kept',
        name: 'Kept',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
      }, keptTrack.id, 0)
      useEditorStore.getState().addClipToTimeline({
        id: 'clip-removed',
        name: 'Removed',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
      }, removedTrack.id, 0)

      useEditorStore.getState().toggleClipSelection('clip-kept')
      useEditorStore.getState().toggleClipSelection('clip-removed')
      useEditorStore.getState().copySelectedClips()
      expect(useEditorStore.getState().clipboard).toHaveLength(2)

      useEditorStore.getState().removeTrack(removedTrack.id)

      const clipboard = useEditorStore.getState().clipboard!
      expect(clipboard).toHaveLength(1)
      expect(clipboard[0].id).toBe('clip-kept')
    })

    it('leaves the clipboard untouched when the removed track holds nothing copied', () => {
      useEditorStore.getState().addTrack()
      const tracks = useEditorStore.getState().project.timeline.tracks
      const [keptTrack, removedTrack] = tracks

      useEditorStore.getState().addClipToTimeline({
        id: 'clip-kept',
        name: 'Kept',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
      }, keptTrack.id, 0)

      useEditorStore.getState().toggleClipSelection('clip-kept')
      useEditorStore.getState().copySelectedClips()
      const clipboardBefore = useEditorStore.getState().clipboard

      useEditorStore.getState().removeTrack(removedTrack.id)

      expect(useEditorStore.getState().clipboard).toBe(clipboardBefore)
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

    // ESCSUITE-79: the trailing `skipHistory` that lets a cross-track clip drag
    // commit its two writes as one undo step. Same shape as
    // `updateClipTransform`'s, so the flag is optional and last and every caller
    // that omits it is one entry exactly as before.
    describe('setClipTimelinePosition with skipHistory', () => {
      let clipId: string

      beforeEach(() => {
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
        clipId = useEditorStore.getState().project.timeline.clips[0].id
      })

      it('moves the clip and pushes nothing when skipHistory is true', () => {
        const before = useEditorStore.getState().history.past.length

        useEditorStore.getState().setClipTimelinePosition(clipId, 10, true)

        expect(useEditorStore.getState().project.timeline.clips[0].timelinePosition).toBe(10)
        expect(useEditorStore.getState().history.past.length).toBe(before)
      })

      it.each([
        ['false', false],
        ['omitted', undefined],
      ])('pushes an entry when skipHistory is %s', (_name, skipHistory) => {
        const before = useEditorStore.getState().history.past.length

        useEditorStore.getState().setClipTimelinePosition(clipId, 10, skipHistory)

        expect(useEditorStore.getState().history.past.length).toBe(before + 1)
      })
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
      const overlay = store().addTextOverlayClip({ text: 'Hi' })!

      const track = store().project.timeline.tracks.find((t) => t.id === overlay.trackId)!
      expect(track.name).toBe('Text')
    })

    it('names an auto-created shape track after the shape', () => {
      addClip('clip1', 0)
      const ellipse = store().addShapeOverlayClip({ type: 'ellipse' })!

      expect(store().project.timeline.tracks.find((t) => t.id === ellipse.trackId)!.name).toBe('Ellipse')
    })

    it('names an auto-created blur track "Blur" and gives it blur defaults', () => {
      addClip('clip1', 0)
      const blur = store().addShapeOverlayClip({ type: 'blur' })!

      expect(store().project.timeline.tracks.find((t) => t.id === blur.trackId)!.name).toBe('Blur')
      expect(blur.name).toBe('Blur Region')
      expect(blur.shapeData).toMatchObject({
        fillColor: '#00000000',
        strokeWidth: 0,
        blurAmount: 10,
      })
    })

    it('never places a clip on an empty track that is locked (ESCSUITE-84)', () => {
      // One track, empty and locked: the clip must go to a NEW track, not this one.
      const lockedId = store().project.timeline.tracks[0].id
      store().updateTrack(lockedId, { locked: true })

      const clip = addClip('clip1', 0)

      const { tracks, clips } = store().project.timeline
      expect(tracks).toHaveLength(2)
      expect(clips[0].trackId).not.toBe(lockedId)
      expect(clip.trackId).not.toBe(lockedId)
    })
  })

  describe('removeSourceVideosPermanently', () => {
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

      store().removeSourceVideosPermanently(['video2'])

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

    // ESCSUITE-110 review round 1: the animation rebase moved out of this
    // action entirely, into `trimClip` below — a timeline trim no longer
    // goes through `updateClip` at all. This pins that `updateClip` itself
    // carries no such logic, so a future change to its other caller
    // (`useClipEditorActions.ts`'s mask/stroke handlers) cannot silently
    // reintroduce it.
    it('carries no animation logic: shortening a clip through this action leaves its animation untouched', () => {
      addClip('clip1', 0, 10)
      store().updateClipAnimation('clip1', { out: { type: 'fade', duration: 2, easing: 'ease-in' } })
      const before = store().project.timeline.clips[0].animation

      store().updateClip('clip1', { endTime: 1 })

      const clip = store().project.timeline.clips[0]
      expect(clip.duration).toBe(1)
      expect(clip.animation).toBe(before)
    })
  })

  // ESCSUITE-110: trimming a clip leaves keyframes past its new end as dead
  // weight and can leave an out-preset's duration longer than the clip
  // (`generateOutPresetKeyframes` then computes a negative `startTime`).
  // Review round 1 split this out of `updateClip` into its own action,
  // `trimClip`, for gesture safety (MAJOR 1) and an explicit edge instead of
  // an inferred one (MAJOR 2) — see `clipSlice.ts`'s doc comment on it.
  describe('trimClip (ESCSUITE-110)', () => {
    /** The origin `useTrimDrag` would capture on mousedown, from a clip snapshot. */
    const originOf = (clip: ReturnType<typeof store>['project']['timeline']['clips'][number]) => ({
      startTime: clip.startTime,
      endTime: clip.endTime,
      timelinePosition: clip.timelinePosition,
      animation: clip.animation,
    })

    it('recomputes the clip duration the same way updateClip used to', () => {
      addClip('clip1', 0, 10)
      const origin = originOf(store().project.timeline.clips[0])

      store().trimClip('clip1', 'end', { endTime: 6 }, origin)

      const clip = store().project.timeline.clips[0]
      expect(clip.duration).toBe(6)
      expect(store().project.timeline.duration).toBe(6)
    })

    describe('rebasing the animation on a trim', () => {
      it('drops a keyframe past the new end and synthesises a boundary, trimming from the end', () => {
        addClip('clip1', 0, 10)
        store().updateClipAnimation('clip1', {
          keyframes: {
            x: [
              { time: 0, value: 0, easing: 'linear' },
              { time: 4, value: 0.5, easing: 'ease-in' },
              { time: 8, value: 1, easing: 'linear' },
            ],
          },
        })
        const origin = originOf(store().project.timeline.clips[0])

        // Trim the end in from 10s to 6s.
        store().trimClip('clip1', 'end', { endTime: 6 }, origin)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(6)
        expect(clip.animation?.keyframes.x).toHaveLength(3)
        expect(clip.animation?.keyframes.x?.[1]).toEqual({ time: 4, value: 0.5, easing: 'ease-in' })
        expect(clip.animation?.keyframes.x?.[2].time).toBe(6)
        expect(clip.animation?.keyframes.x?.[2].value).toBeCloseTo(0.625, 5)
      })

      it('shifts keyframes back to 0, trimming from the start', () => {
        addClip('clip1', 0, 10)
        store().updateClipAnimation('clip1', {
          keyframes: {
            x: [
              { time: 0, value: 0, easing: 'linear' },
              { time: 4, value: 0.5, easing: 'ease-in' },
              { time: 8, value: 1, easing: 'linear' },
            ],
          },
        })
        const origin = originOf(store().project.timeline.clips[0])

        // Trim the start in by 6s: startTime moves to 6, and the trim drag
        // moves timelinePosition by the same amount (endTime untouched).
        store().trimClip('clip1', 'start', { startTime: 6, timelinePosition: 6 }, origin)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(4)
        expect(clip.animation?.keyframes.x).toHaveLength(2)
        expect(clip.animation?.keyframes.x?.[0].time).toBe(0)
        expect(clip.animation?.keyframes.x?.[0].value).toBeCloseTo(0.625, 5)
        expect(clip.animation?.keyframes.x?.[1]).toEqual({ time: 2, value: 1, easing: 'linear' })
      })

      it("clamps a kept out-preset's duration so it can no longer start before 0", () => {
        addClip('clip1', 0, 10)
        store().updateClipAnimation('clip1', { out: { type: 'fade', duration: 2, easing: 'ease-in' } })
        const origin = originOf(store().project.timeline.clips[0])

        // Trim the clip down to 1s — an unclamped 2s fade-out would make
        // generateOutPresetKeyframes compute startTime = 1 - 2 = -1.
        store().trimClip('clip1', 'end', { endTime: 1 }, origin)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(1)
        expect(clip.animation?.out.duration).toBe(0.5) // maxPresetDuration(1)
      })

      it('leaves the animation alone when the trim lengthens the clip', () => {
        // A clip trimmed in from a longer source, so there is room to trim
        // back out again.
        store().addClipToTimeline(
          { id: 'clip1', sourceVideoId: video.id, name: 'clip1', startTime: 2, endTime: 6, duration: 4 },
          undefined,
          0
        )
        store().updateClipAnimation('clip1', {
          out: { type: 'fade', duration: 1, easing: 'ease-in' },
          keyframes: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 4, value: 1, easing: 'linear' }] },
        })
        const before = store().project.timeline.clips[0].animation
        const origin = originOf(store().project.timeline.clips[0])

        // Drag the end handle outward: 6 -> 9, so duration grows 4 -> 7.
        store().trimClip('clip1', 'end', { endTime: 9 }, origin)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(7)
        expect(clip.animation).toBe(before)
      })
    })

    // MAJOR 1 from the review: the first version of this fix rebased from the
    // clip's CURRENT animation, which — since a trim writes on every
    // mousemove — was already whatever the previous move in the same gesture
    // had cropped it to. Compounding that on every move made an overshoot
    // irrecoverable. `trimClip` now always rebases from `origin.animation`,
    // captured once when the gesture began, so it is a pure function of
    // (origin, current pointer position) and an overshoot-and-return is
    // exact.
    describe('gesture safety: rebasing from the origin across multiple moves', () => {
      it('overshooting past a keyframe and back to the start restores it exactly', () => {
        addClip('clip1', 0, 10)
        store().updateClipAnimation('clip1', {
          keyframes: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 8, value: 1, easing: 'linear' }] },
        })
        const startingAnimation = store().project.timeline.clips[0].animation
        const origin = originOf(store().project.timeline.clips[0])

        // Move 1: drag the end handle in to 6s — past the keyframe at 8,
        // which a single-move trim would crop into a synthesised boundary.
        store().trimClip('clip1', 'end', { endTime: 6 }, origin, false)
        expect(store().project.timeline.clips[0].animation?.keyframes.x).not.toEqual(
          startingAnimation?.keyframes.x
        )

        // Move 2: the SAME gesture (same `origin`) moves back out to exactly
        // where it started, 10s.
        store().trimClip('clip1', 'end', { endTime: 10 }, origin, true)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(10)
        expect(clip.animation?.keyframes.x).toEqual(startingAnimation?.keyframes.x)
      })

      it('overshooting to the shortest a trim may leave and back restores the authored preset duration', () => {
        // 0.1s is MIN_CLIP_DURATION (components/Timeline/timelineGeometry.ts)
        // — the shortest a trim drag may leave a clip.
        const MIN_CLIP_DURATION = 0.1
        addClip('clip1', 0, 10)
        store().updateClipAnimation('clip1', { out: { type: 'fade', duration: 2, easing: 'ease-in' } })
        const origin = originOf(store().project.timeline.clips[0])

        // Move 1: overshoot all the way in — clamps the fade-out hard.
        store().trimClip('clip1', 'end', { endTime: MIN_CLIP_DURATION }, origin, false)
        expect(store().project.timeline.clips[0].animation?.out.duration).toBeLessThan(2)

        // Move 2: back out to the origin's own length.
        store().trimClip('clip1', 'end', { endTime: 10 }, origin, true)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(10)
        expect(clip.animation?.out.duration).toBe(2)
      })
    })

    // MAJOR 2 from the review: which edge moved is `edge`, passed straight
    // through from `TrimState.edge` — never inferred from which of `updates`'
    // fields happen to be present. An extendable clip (an overlay, or an
    // image) has no source to trim, so ITS front-trim moves `timelinePosition`
    // rather than `startTime` — the one arm the old sniffing-based version
    // left untested.
    describe('the front-cut for an extendable clip (no startTime to move)', () => {
      it('shifts keyframes back when an overlay clip is trimmed from the start', () => {
        store().addClipToTimeline(
          { id: 'overlay1', sourceVideoId: '', name: 'overlay1', overlayType: 'shape', startTime: 0, endTime: 10, duration: 10 },
          undefined,
          0
        )
        store().updateClipAnimation('overlay1', {
          keyframes: {
            x: [
              { time: 0, value: 0, easing: 'linear' },
              { time: 4, value: 0.5, easing: 'ease-in' },
              { time: 8, value: 1, easing: 'linear' },
            ],
          },
        })
        const origin = originOf(store().project.timeline.clips[0])

        // computeTrimUpdate's extendable start-edge case: timelinePosition,
        // duration and endTime move; startTime never does (it stays 0).
        store().trimClip('overlay1', 'start', { timelinePosition: 6, duration: 4, endTime: 4 }, origin)

        const clip = store().project.timeline.clips[0]
        expect(clip.duration).toBe(4)
        expect(clip.timelinePosition).toBe(6)
        expect(clip.animation?.keyframes.x).toHaveLength(2)
        expect(clip.animation?.keyframes.x?.[0].time).toBe(0)
        expect(clip.animation?.keyframes.x?.[0].value).toBeCloseTo(0.625, 5)
        expect(clip.animation?.keyframes.x?.[1]).toEqual({ time: 2, value: 1, easing: 'linear' })
      })
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

  describe('a clip carries its crop through every copy (ESCSUITE-6)', () => {
    const CROP = { left: 0.25, top: 0.1, right: 0, bottom: 0 }

    beforeEach(() => {
      resetStoreForTest()
    })

    it('gives both halves of a split the crop, as their own objects', () => {
      const clip = addClip('clip1', 0, 4)
      store().updateClip(clip.id, { crop: { ...CROP } })

      store().splitClip(clip.id, 2)

      const halves = store().project.timeline.clips
      expect(halves).toHaveLength(2)
      for (const half of halves) expect(half.crop).toEqual(CROP)
      // cloneClip is structuredClone, so the two halves do not share one object —
      // which matters the day either half's crop is edited.
      expect(halves[0].crop).not.toBe(halves[1].crop)
    })

    it('gives a duplicate the crop', () => {
      const clip = addClip('clip1', 0, 4)
      store().updateClip(clip.id, { crop: { ...CROP } })

      store().duplicateClip(clip.id)

      const copy = store().project.timeline.clips.find((c) => c.id !== clip.id)!
      expect(copy.crop).toEqual(CROP)
      expect(copy.crop).not.toBe(store().project.timeline.clips.find((c) => c.id === clip.id)!.crop)
    })

    it('gives a pasted clone the crop', () => {
      const clip = addClip('clip1', 0, 4)
      store().updateClip(clip.id, { crop: { ...CROP } })
      store().setSelectedClipId(clip.id)
      store().toggleClipSelection(clip.id)
      store().copySelectedClips()
      store().setCurrentTime(6)

      expect(store().pasteClips()).toBe(true)

      const pasted = store().project.timeline.clips.find((c) => c.timelinePosition === 6)!
      expect(pasted.crop).toEqual(CROP)
    })

    it('puts the crop back on an undo of a reset', () => {
      const clip = addClip('clip1', 0, 4)
      store().updateClip(clip.id, { crop: { ...CROP } })
      store().updateClip(clip.id, { crop: undefined })

      store().undo()

      expect(store().project.timeline.clips[0].crop).toEqual(CROP)
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

  describe('a locked track (ESCSUITE-84)', () => {
    let held: string
    let free: string
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    beforeEach(() => {
      held = useEditorStore.getState().project.timeline.tracks[0].id
      free = store().addTrack('Free').id
      addClip('h1', 0, 2, held)
      addClip('h2', 4, 2, held)
      addClip('f1', 0, 2, free)
      store().updateTrack(held, { locked: true })
    })

    /** Assert the action wrote nothing: same clips array, no history entry. */
    const refuses = (act: () => void) => {
      const before = clipsRef(); const entries = past()
      act()
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    /**
     * The same, for an action that *reports* its refusal (ESCSUITE-87): nothing
     * written, and `false` back to the caller so a gesture threading
     * `skipHistory` into a later write knows its first one never landed.
     */
    const reportsRefusal = (act: () => boolean) => {
      const before = clipsRef(); const entries = past()
      expect(act()).toBe(false)
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    it('refuses to add a clip to it by explicit track id', () => refuses(() =>
      store().addClipToTimeline(
        { id: 'new1', sourceVideoId: video.id, name: 'new1', startTime: 0, endTime: 2, duration: 2 },
        held
      )))
    it('refuses to remove a clip on it', () => reportsRefusal(() => store().removeClipFromTimeline('h1')))
    it('refuses to ripple-delete a clip on it', () => refuses(() => store().rippleDeleteClip('h1')))
    it('refuses to update a clip on it', () => reportsRefusal(() => store().updateClip('h1', { endTime: 1 })))
    it('refuses to trim a clip on it', () => reportsRefusal(() =>
      store().trimClip('h1', 'end', { endTime: 1 }, { startTime: 0, endTime: 2, timelinePosition: 0 })))
    it('refuses to split a clip on it', () => refuses(() => store().splitClip('h1', 1)))
    it('refuses to move a clip on it in time', () => reportsRefusal(() => store().setClipTimelinePosition('h1', 8)))
    it('refuses to move a clip on it to another track', () => reportsRefusal(() => store().moveClipToTrack('h1', free)))
    it('refuses to move a clip onto it from another track', () => reportsRefusal(() => store().moveClipToTrack('f1', held)))
    it('refuses to transform a clip on it', () => reportsRefusal(() => store().updateClipTransform('h1', { x: 0.2 })))
    it('refuses to change the blend mode of a clip on it', () => refuses(() => store().updateClipBlendMode('h1', 'multiply')))
    it('refuses to change the effects of a clip on it', () => reportsRefusal(() => store().updateClipEffects('h1', { blur: 3 })))
    it('refuses to change the transition of a clip on it', () => reportsRefusal(() => store().updateClipTransition('h1', { duration: 1 })))
    it('refuses to change the animation of a clip on it', () => reportsRefusal(() => store().updateClipAnimation('h1', { in: { type: 'fade', duration: 1, easing: 'linear' } })))
    it('refuses to duplicate a clip on it', () => refuses(() => store().duplicateClip('h1')))
    it('refuses to shift the clips on it', () => reportsRefusal(() => store().shiftClipsAfter(held, 1, 2)))
    it('still shifts the clips on an unlocked track', () => {
      addClip('f2', 4, 2, free)
      store().shiftClipsAfter(free, 1, 2)
      expect(clipsRef().find((c) => c.id === 'f2')!.timelinePosition).toBe(6)
    })
    // ESCSUITE-154: the store-level lock refusal these two tests pinned
    // belonged to `removeSourceVideo`, deleted when the per-item Remove
    // button — its only caller — moved to the non-undoable
    // `removeSourceVideosPermanently`, which trusts its caller to have
    // already filtered locked ids out. ESCSUITE-84's *protection* is intact —
    // `VideoUploader.tsx`'s own `lockedMedia.has(id)` guard sits ahead of
    // `deleteVideo`, and the button is never rendered enabled for a locked
    // source in the first place — but there is no longer a store-level
    // refusal for a test here to pin. `VideoUploader.test.tsx`'s "refuses to
    // remove media a clip on a locked track uses" pins only the *disabled
    // button*; the component's own guard behind it is a belt-and-braces
    // check, unreachable while that button is rendered disabled, and has no
    // executed-refusal pin of its own (ESCSUITE-154 review, MINOR 2).
    it('still edits a clip on an unlocked track while another track is locked', () => {
      store().updateClipBlendMode('f1', 'multiply')
      expect(clipsRef().find((c) => c.id === 'f1')!.blendMode).toBe('multiply')
    })
  })

  // ESCSUITE-101. Every action here removes a clip from the timeline some way
  // other than the id the caller happened to pass it — a track or a source
  // video taking its clips with it, a split retiring the clip it split, undo
  // and redo landing on an older or newer clip list — and none of them used
  // to reconcile the selection against what was actually left. `pruneSelection`
  // is the one place that question gets asked now; each case here selects the
  // clip (or clips) that is about to leave, along with one that survives, and
  // asserts the Set holds only the survivor.
  describe('selection pruning when a clip leaves the timeline (ESCSUITE-101)', () => {
    it('removeClipFromTimeline drops the removed clip from selectedClipIds and nulls selectedClipId', () => {
      const first = addClip('clip1', 0, 2)
      addClip('clip2', 4, 2, first.trackId)
      store().toggleClipSelection('clip2')
      store().toggleClipSelection('clip1') // selectedClipId is now clip1

      store().removeClipFromTimeline('clip1')

      expect(store().selectedClipId).toBeNull()
      expect([...store().selectedClipIds]).toEqual(['clip2'])
    })

    it('rippleDeleteClip drops the removed clip from selectedClipIds and nulls selectedClipId', () => {
      const first = addClip('clip1', 0, 2)
      addClip('clip2', 4, 2, first.trackId)
      store().toggleClipSelection('clip2')
      store().toggleClipSelection('clip1')

      store().rippleDeleteClip('clip1')

      expect(store().selectedClipId).toBeNull()
      expect([...store().selectedClipIds]).toEqual(['clip2'])
    })

    it('splitClip drops the original (now-retired) clip id from selectedClipIds, swapping in the first half when it was selected', () => {
      const first = addClip('clip1', 0, 4)
      addClip('clip2', 8, 2, first.trackId)
      store().toggleClipSelection('clip2')
      store().toggleClipSelection('clip1') // multi-selection holds the clip about to split

      store().splitClip('clip1', 2)

      // splitClip's own contract is unchanged: the first half is selected.
      const selectedId = store().selectedClipId
      expect(selectedId).not.toBeNull()
      expect(selectedId).not.toBe('clip1')

      // clip1 no longer exists — split into two new clips — so it cannot
      // remain in the Set even though splitClip never named it as "removed".
      // Because it WAS part of the multi-selection, the first half takes its
      // place there too, so selectedClipId and selectedClipIds agree.
      expect([...store().selectedClipIds].sort()).toEqual(['clip2', selectedId].sort())
      expect(store().selectedClipIds.has(selectedId!)).toBe(true)
    })

    it('splitClip leaves an UNSELECTED multi-selection untouched by the first half', () => {
      const first = addClip('clip1', 0, 4)
      addClip('clip2', 8, 2, first.trackId)
      store().toggleClipSelection('clip2') // clip1 is not part of the multi-selection

      store().splitClip('clip1', 2)

      // The first half becomes the sole selection (splitClip's own contract),
      // but the multi-selection Set never held clip1, so it is untouched —
      // the first half is NOT added to a selection it was never part of.
      expect([...store().selectedClipIds]).toEqual(['clip2'])
    })

    it('removeTrack drops the ids of the clips it takes with it', () => {
      const removedTrack = store().addTrack('Removed')
      addClip('clip1', 0, 2, removedTrack.id)
      addClip('clip2', 4, 2)
      store().toggleClipSelection('clip2')
      store().toggleClipSelection('clip1')

      store().removeTrack(removedTrack.id)

      expect(store().selectedClipId).toBeNull()
      expect([...store().selectedClipIds]).toEqual(['clip2'])
    })

    it('removeSourceVideosPermanently drops the ids of the clips it takes with it', () => {
      const other: SourceVideo = { ...video, id: 'video2' }
      store().addSourceVideo(other)
      addClip('clip1', 0, 2)
      store().addClipToTimeline(
        { id: 'clip2', sourceVideoId: 'video2', name: 'clip2', startTime: 0, endTime: 2, duration: 2 },
        undefined,
        4
      )
      store().toggleClipSelection('clip1')
      store().toggleClipSelection('clip2')

      store().removeSourceVideosPermanently(['video2'])

      expect(store().selectedClipId).toBeNull()
      expect([...store().selectedClipIds]).toEqual(['clip1'])
    })

    it('undo drops a ghost that only the earlier, restored state lacks', () => {
      addClip('clip1', 0, 2)
      addClip('clip2', 4, 2) // pushes a snapshot holding only clip1
      store().toggleClipSelection('clip1')
      store().toggleClipSelection('clip2') // selectedClipId is now clip2

      store().undo() // restores the snapshot with only clip1; clip2 is now a ghost

      expect(store().project.timeline.clips.map((c) => c.id)).toEqual(['clip1'])
      expect(store().selectedClipId).toBeNull()
      expect([...store().selectedClipIds]).toEqual(['clip1'])
    })

    it('redo drops a ghost that the redo itself removes', () => {
      addClip('clip1', 0, 2)
      addClip('clip2', 4, 2)
      store().toggleClipSelection('clip2')
      store().removeClipFromTimeline('clip2') // clip2 gone; selection already pruned to nothing

      store().undo() // clip2 restored
      expect(store().project.timeline.clips.map((c) => c.id)).toEqual(['clip1', 'clip2'])

      store().toggleClipSelection('clip1')
      store().toggleClipSelection('clip2') // selectedClipIds = {clip1, clip2}, selectedClipId = clip2

      store().redo() // re-applies the delete: clip2 is gone again

      expect(store().project.timeline.clips.map((c) => c.id)).toEqual(['clip1'])
      expect(store().selectedClipId).toBeNull()
      expect([...store().selectedClipIds]).toEqual(['clip1'])
    })
  })

  // ESCSUITE-87. The refusals above are only half the contract: an action that
  // *did* write says so too, or a caller could not tell "refused" from "wrote"
  // and a gesture would hand `skipHistory` to a second write for an undo entry
  // that was never pushed.
  describe('reporting that it wrote (ESCSUITE-87)', () => {
    let track: string

    beforeEach(() => {
      track = useEditorStore.getState().project.timeline.tracks[0].id
      addClip('c1', 0, 2, track)
      addClip('c2', 4, 2, track)
    })

    it('updateClip', () => expect(store().updateClip('c1', { endTime: 1 })).toBe(true))
    it('setClipTimelinePosition', () => expect(store().setClipTimelinePosition('c1', 8)).toBe(true))
    it('moveClipToTrack', () => expect(store().moveClipToTrack('c1', store().addTrack('Other').id)).toBe(true))
    it('updateClipTransform', () => expect(store().updateClipTransform('c1', { x: 0.2 })).toBe(true))
    it('updateClipEffects', () => expect(store().updateClipEffects('c1', { blur: 3 })).toBe(true))
    it('updateClipTransition', () => expect(store().updateClipTransition('c1', { duration: 1 })).toBe(true))
    it('updateClipAnimation', () => expect(store().updateClipAnimation('c1', {
      in: { type: 'fade', duration: 1, easing: 'linear' },
    })).toBe(true))
    it('shiftClipsAfter', () => expect(store().shiftClipsAfter(track, 1, 2)).toBe(true))

    // Nothing moved, so nothing was written — the same answer a lock gives, for
    // the same reason: there is no undo entry for a later write to join.
    it('shiftClipsAfter says false for a zero delta', () =>
      expect(store().shiftClipsAfter(track, 1, 0)).toBe(false))
  })
})
