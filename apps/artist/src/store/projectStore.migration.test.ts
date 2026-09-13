import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { Project } from './types'
import { getSessionState, saveSessionState, type SessionState } from '../core/storage'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'

/** A project as an older ARTIST version saved it: overlays in the two legacy arrays. */
const projectWithLegacyOverlays = (): Project => ({
  id: 'p',
  name: 'Has legacy overlays',
  created: 1,
  modified: 1,
  resolution: { width: 1920, height: 1080 },
  timeline: {
    tracks: [
      { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
    ],
    clips: [],
    textOverlays: [
      {
        id: 'text1', text: 'Legacy', x: 0.25, y: 0.5, fontFamily: 'Arial', fontSize: 48,
        fontWeight: 'normal', fontStyle: 'normal', color: '#ffffff',
        backgroundColor: '#00000000', textAlign: 'center', startTime: 1, endTime: 3, opacity: 0.5,
      },
    ],
    shapeOverlays: [
      {
        id: 'shape1', type: 'rectangle', x: 0.5, y: 0.5, width: 0.2, height: 0.2,
        fillColor: '#ff0000ff', strokeColor: '#ffffff', strokeWidth: 2,
        startTime: 0, endTime: 2, opacity: 1, rotation: 0,
      },
    ],
    duration: 0,
  },
})

describe('projectStore remaining behaviours', () => {
  beforeEach(resetStoreForTest)

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

      store().setProject(modern as unknown as Project)

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

      store().setProject(legacy as unknown as Project)

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

      store().setProject(legacy as unknown as Project)

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

    it('converts legacy overlay arrays into overlay clips and empties the arrays', () => {
      store().setProject(projectWithLegacyOverlays())

      const timeline = store().project.timeline
      expect(timeline.clips).toHaveLength(2)
      expect(timeline.clips.map((c) => [c.id, c.overlayType])).toEqual([
        ['legacy-shape-shape1', 'shape'],
        ['legacy-text-text1', 'text'],
      ])
      expect(timeline.textOverlays).toEqual([])
      expect(timeline.shapeOverlays).toEqual([])
    })

    it('converts a trackless legacy project\'s overlays too', () => {
      // The other return path of ensureTimelineHasTracks: a project old enough to
      // predate tracks carries overlays in the arrays as well.
      const ancient = projectWithLegacyOverlays()
      ancient.timeline.tracks = []
      ancient.timeline.clips = [
        { id: 'a', sourceVideoId: 'video1', name: 'a', startTime: 0, endTime: 3, duration: 3 },
      ] as unknown as Project['timeline']['clips']

      store().setProject(ancient)

      const timeline = store().project.timeline
      expect(timeline.clips.map((c) => c.id)).toEqual(['a', 'legacy-shape-shape1', 'legacy-text-text1'])
      expect(timeline.tracks).toHaveLength(3)
      expect(timeline.textOverlays).toEqual([])
      expect(timeline.shapeOverlays).toEqual([])
    })

    it('pushes exactly one history entry, so a single undo returns to the previous project', () => {
      const before = store().project
      const entriesBefore = useEditorStore.getState().history.past.length

      store().setProject(projectWithLegacyOverlays())
      expect(store().project.timeline.clips).toHaveLength(2)
      expect(useEditorStore.getState().history.past).toHaveLength(entriesBefore + 1)

      store().undo()

      // The conversion happens inside the load, not as a second undoable step.
      expect(store().project).toEqual(before)
      expect(useEditorStore.getState().history.past).toHaveLength(entriesBefore)
    })

    it('converts a session restored from storage, which comes back through setProject', () => {
      // buildSessionSnapshot persists state.project whole, so a session autosaved
      // before this change still holds the legacy arrays; it heals on restore.
      const session: SessionState = {
        project: projectWithLegacyOverlays(),
        sourceVideos: [],
        currentTime: 0,
        selectedClipId: null,
        zoom: 1,
        timestamp: 1,
      }

      return saveSessionState(session)
        .then(getSessionState)
        .then((restored) => {
          store().setProject(restored!.project)

          const timeline = store().project.timeline
          expect(timeline.clips.map((c) => c.overlayType)).toEqual(['shape', 'text'])
          expect(timeline.textOverlays).toEqual([])
          expect(timeline.shapeOverlays).toEqual([])
        })
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

      store().setProject(legacy as unknown as Project)

      expect(store().project.timeline.clips.map((c) => c.timelinePosition)).toEqual([10, 0])
    })
  })
})
