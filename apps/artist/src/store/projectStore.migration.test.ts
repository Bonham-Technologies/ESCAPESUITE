import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { Project } from './types'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'

describe('projectStore integration', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useEditorStore.getState().resetProject()
    // Clear history after reset
    useEditorStore.setState({ history: { past: [], future: [] } })
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
