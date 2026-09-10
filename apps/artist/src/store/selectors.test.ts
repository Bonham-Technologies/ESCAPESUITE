import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useEditorStore } from './projectStore'
import {
  createClipsByTrackMap,
  selectActions,
  selectActiveTool,
  selectClipCount,
  selectClips,
  selectCurrentTime,
  selectIsPlaying,
  selectKeyframePanelOpen,
  selectKeyframePanelPosition,
  selectLoopPlayback,
  selectMarkers,
  selectSelectedClip,
  selectSelectedClipId,
  selectSelectedTrack,
  selectSelectedTrackId,
  selectShapeOverlays,
  selectSnapEnabled,
  selectSourceVideos,
  selectTextOverlays,
  selectTimelineDuration,
  selectTrackCount,
  selectTracks,
  selectZoom,
  useClipsByTrack,
  usePlaybackActions,
  usePlaybackState,
  usePreviewActions,
  usePreviewState,
  useTimelineActions,
  useTimelineState,
} from './selectors'
import type { Clip, EditorState, SourceVideo } from './types'

const video: SourceVideo = {
  id: 'video1',
  name: 'test.mp4',
  duration: 10,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 1000,
}

/** Add a media clip to the timeline and return the clip the store created. */
function addClip(id: string, position: number, duration = 2, trackId?: string): Clip {
  useEditorStore.getState().addClipToTimeline(
    {
      id,
      sourceVideoId: video.id,
      name: id,
      startTime: 0,
      endTime: duration,
      duration,
    },
    trackId,
    position
  )
  return useEditorStore.getState().project.timeline.clips.find((c) => c.id === id)!
}

const state = (): EditorState => useEditorStore.getState()

// The store is a module singleton and resetProject() only resets the project,
// not the surrounding editor state (markers, panel, playhead...). Snapshot the
// pristine store before any test touches it and restore that wholesale, so each
// test starts from the state a freshly loaded editor really has.
const pristine = useEditorStore.getState()

describe('selectors', () => {
  beforeEach(() => {
    useEditorStore.setState(pristine, true)
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    useEditorStore.getState().addSourceVideo(video)
  })

  afterEach(() => {
    cleanup()
  })

  describe('basic state selectors', () => {
    it('read the primitive editor state straight off the store', () => {
      useEditorStore.setState({
        currentTime: 4.5,
        isPlaying: true,
        selectedClipId: 'c1',
        selectedTrackId: 't1',
        zoom: 3,
        loopPlayback: true,
        activeTool: 'razor',
        snapEnabled: false,
      })

      const s = state()
      expect(selectCurrentTime(s)).toBe(4.5)
      expect(selectIsPlaying(s)).toBe(true)
      expect(selectSelectedClipId(s)).toBe('c1')
      expect(selectSelectedTrackId(s)).toBe('t1')
      expect(selectZoom(s)).toBe(3)
      expect(selectLoopPlayback(s)).toBe(true)
      expect(selectActiveTool(s)).toBe('razor')
      expect(selectSnapEnabled(s)).toBe(false)
    })
  })

  describe('timeline selectors', () => {
    it('read the timeline arrays and duration', () => {
      addClip('clip1', 0, 3)

      const s = state()
      expect(selectClips(s)).toHaveLength(1)
      expect(selectClipCount(s)).toBe(1)
      expect(selectTracks(s)).toBe(s.project.timeline.tracks)
      expect(selectTrackCount(s)).toBe(s.project.timeline.tracks.length)
      expect(selectTimelineDuration(s)).toBe(3)
      expect(selectSourceVideos(s)).toEqual([video])
    })

    it('return empty arrays when the overlay arrays are absent', () => {
      const s = state()
      expect(selectTextOverlays(s)).toEqual([])
      expect(selectShapeOverlays(s)).toEqual([])

      const legacy = {
        ...s,
        project: {
          ...s.project,
          timeline: { ...s.project.timeline, textOverlays: undefined, shapeOverlays: undefined },
        },
      } as unknown as EditorState
      expect(selectTextOverlays(legacy)).toEqual([])
      expect(selectShapeOverlays(legacy)).toEqual([])
    })

    it('read the markers list', () => {
      act(() => {
        useEditorStore.getState().addMarker(2, 'Cue')
      })
      expect(selectMarkers(state())).toEqual([
        expect.objectContaining({ time: 2, label: 'Cue' }),
      ])
    })
  })

  describe('selectSelectedClip / selectSelectedTrack', () => {
    it('return undefined when nothing is selected', () => {
      expect(selectSelectedClip(state())).toBeUndefined()
      expect(selectSelectedTrack(state())).toBeUndefined()
    })

    it('look up the selected clip and track by id', () => {
      const clip = addClip('clip1', 0)
      useEditorStore.setState({ selectedClipId: 'clip1', selectedTrackId: clip.trackId })

      expect(selectSelectedClip(state())?.id).toBe('clip1')
      expect(selectSelectedTrack(state())?.id).toBe(clip.trackId)
    })

    it('return undefined when the selected id no longer exists', () => {
      useEditorStore.setState({ selectedClipId: 'gone', selectedTrackId: 'gone' })
      expect(selectSelectedClip(state())).toBeUndefined()
      expect(selectSelectedTrack(state())).toBeUndefined()
    })
  })

  describe('keyframe panel selectors', () => {
    it('read the panel open flag and position', () => {
      act(() => {
        useEditorStore.getState().setKeyframePanelOpen(true)
        useEditorStore.getState().setKeyframePanelPosition({ x: 12, y: 34 })
      })

      expect(selectKeyframePanelOpen(state())).toBe(true)
      expect(selectKeyframePanelPosition(state())).toEqual({ x: 12, y: 34 })
    })
  })

  describe('selectActions', () => {
    it('bundles the action functions off the store', () => {
      const actions = selectActions(state())
      const s = state()

      expect(actions.setCurrentTime).toBe(s.setCurrentTime)
      expect(actions.setIsPlaying).toBe(s.setIsPlaying)
      expect(actions.setSelectedClipId).toBe(s.setSelectedClipId)
      expect(actions.setSelectedTrackId).toBe(s.setSelectedTrackId)
      expect(actions.updateClipTransform).toBe(s.updateClipTransform)
      expect(actions.updateTextOverlayData).toBe(s.updateTextOverlayData)
      expect(actions.updateShapeOverlayData).toBe(s.updateShapeOverlayData)
      expect(actions.setClipKeyframe).toBe(s.setClipKeyframe)
      expect(actions.addMarker).toBe(s.addMarker)
      expect(actions.removeMarker).toBe(s.removeMarker)
      expect(actions.goToNextMarker).toBe(s.goToNextMarker)
      expect(actions.goToPreviousMarker).toBe(s.goToPreviousMarker)

      // The bundle really drives the store.
      act(() => actions.setCurrentTime(7))
      expect(state().currentTime).toBe(7)
    })
  })

  describe('usePreviewState', () => {
    it('groups the preview-relevant state and re-renders only when it changes', () => {
      const { result, rerender } = renderHook(() => usePreviewState())

      expect(result.current.clips).toEqual([])
      expect(result.current.currentTime).toBe(0)
      expect(result.current.isPlaying).toBe(false)
      expect(result.current.keyframePanelOpen).toBe(false)
      expect(result.current.textOverlays).toEqual([])
      expect(result.current.shapeOverlays).toEqual([])

      const first = result.current
      // A field this hook does not select must not produce a new snapshot.
      act(() => useEditorStore.getState().setZoom(9))
      rerender()
      expect(result.current).toBe(first)

      act(() => useEditorStore.getState().setCurrentTime(3))
      expect(result.current.currentTime).toBe(3)
      expect(result.current).not.toBe(first)
    })
  })

  describe('usePreviewActions', () => {
    it('exposes stable action references that drive the store', () => {
      const { result, rerender } = renderHook(() => usePreviewActions())
      const first = result.current

      act(() => result.current.setIsPlaying(true))
      expect(state().isPlaying).toBe(true)

      rerender()
      // Actions never change identity, so the shallow bundle stays the same.
      expect(result.current).toBe(first)
      expect(result.current.setClipKeyframe).toBe(state().setClipKeyframe)
      expect(result.current.updateClipTransform).toBe(state().updateClipTransform)
      expect(result.current.updateTextOverlayData).toBe(state().updateTextOverlayData)
      expect(result.current.updateShapeOverlayData).toBe(state().updateShapeOverlayData)
      expect(result.current.setSelectedClipId).toBe(state().setSelectedClipId)
      expect(result.current.setCurrentTime).toBe(state().setCurrentTime)
    })
  })

  describe('useTimelineState', () => {
    it('groups the timeline-relevant state', () => {
      addClip('clip1', 0, 4)
      const { result } = renderHook(() => useTimelineState())

      expect(result.current.clips).toHaveLength(1)
      expect(result.current.duration).toBe(4)
      expect(result.current.snapEnabled).toBe(state().snapEnabled)
      expect(result.current.snapThreshold).toBe(state().snapThreshold)
      expect(result.current.activeTool).toBe(state().activeTool)
      expect(result.current.markers).toEqual([])

      act(() => useEditorStore.getState().setZoom(2.5))
      expect(result.current.zoom).toBe(2.5)
    })
  })

  describe('useTimelineActions', () => {
    it('exposes the timeline mutators and they really mutate', () => {
      const { result } = renderHook(() => useTimelineActions())

      let trackId = ''
      act(() => {
        trackId = result.current.addTrack('Extra').id
      })
      expect(state().project.timeline.tracks.some((t) => t.id === trackId)).toBe(true)

      act(() => result.current.updateTrack(trackId, { name: 'Renamed' }))
      expect(state().project.timeline.tracks.find((t) => t.id === trackId)?.name).toBe('Renamed')

      act(() => result.current.removeTrack(trackId))
      expect(state().project.timeline.tracks.some((t) => t.id === trackId)).toBe(false)

      expect(result.current.splitClip).toBe(state().splitClip)
      expect(result.current.duplicateClip).toBe(state().duplicateClip)
      expect(result.current.moveClipToTrack).toBe(state().moveClipToTrack)
      expect(result.current.setClipTimelinePosition).toBe(state().setClipTimelinePosition)
      expect(result.current.removeClipFromTimeline).toBe(state().removeClipFromTimeline)
      expect(result.current.updateMarker).toBe(state().updateMarker)
      expect(result.current.removeMarker).toBe(state().removeMarker)
      expect(result.current.setSelectedTrackId).toBe(state().setSelectedTrackId)
      expect(result.current.setSelectedClipId).toBe(state().setSelectedClipId)
      expect(result.current.setIsPlaying).toBe(state().setIsPlaying)
      expect(result.current.setCurrentTime).toBe(state().setCurrentTime)
      expect(result.current.addMarker).toBe(state().addMarker)
    })
  })

  describe('usePlaybackState / usePlaybackActions', () => {
    it('tracks playback state and drives it through the actions', () => {
      addClip('clip1', 0, 6)
      const { result } = renderHook(() => usePlaybackState())
      const { result: actions } = renderHook(() => usePlaybackActions())

      expect(result.current).toEqual({
        isPlaying: false,
        currentTime: 0,
        duration: 6,
        loopPlayback: state().loopPlayback,
      })

      act(() => actions.current.setIsPlaying(true))
      expect(result.current.isPlaying).toBe(true)

      act(() => actions.current.setCurrentTime(2))
      expect(result.current.currentTime).toBe(2)

      act(() => actions.current.setLoopPlayback(true))
      expect(result.current.loopPlayback).toBe(true)

      act(() => {
        useEditorStore.getState().addMarker(1)
        useEditorStore.getState().addMarker(5)
      })
      act(() => actions.current.goToNextMarker())
      expect(state().currentTime).toBe(5)
      act(() => actions.current.goToPreviousMarker())
      expect(state().currentTime).toBe(1)
    })
  })

  describe('createClipsByTrackMap', () => {
    it('returns an empty map for no clips', () => {
      expect(createClipsByTrackMap([])).toEqual(new Map())
    })

    it('groups clips by track id, preserving order within a track', () => {
      const clips = [
        { id: 'a', trackId: 't1' },
        { id: 'b', trackId: 't2' },
        { id: 'c', trackId: 't1' },
      ] as unknown as Clip[]

      const map = createClipsByTrackMap(clips)

      expect([...map.keys()]).toEqual(['t1', 't2'])
      expect(map.get('t1')!.map((c) => c.id)).toEqual(['a', 'c'])
      expect(map.get('t2')!.map((c) => c.id)).toEqual(['b'])
    })
  })

  describe('useClipsByTrack', () => {
    it('groups the store timeline clips by track', () => {
      const first = addClip('clip1', 0)
      addClip('clip2', 5, 2, first.trackId)

      const { result } = renderHook(() => useClipsByTrack())

      expect(result.current.get(first.trackId)!.map((c) => c.id)).toEqual(['clip1', 'clip2'])
    })
  })
})
