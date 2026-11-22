import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import type { EditorState, SourceVideo } from './types'
import { releasedLatches } from './toolLatches'

// ESCSUITE-500: the preview's two per-clip tools (crop mode, Zoom to region)
// close for good when the selection moves off the clip they were opened on,
// so reselecting that clip shows them closed.

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

const s = () => useEditorStore.getState()

function addClip(id: string, position: number) {
  s().addClipToTimeline({ id, sourceVideoId: video.id, name: id, startTime: 0, endTime: 2, duration: 2 }, undefined, position)
}

beforeEach(() => {
  s().resetProject()
  useEditorStore.setState({ history: { past: [], future: [] }, cropClipId: null, zoomRegionClipId: null })
  s().addSourceVideo(video)
  addClip('a', 0)
  addClip('b', 5)
  s().setSelectedClipId('a')
})

describe('the crop and Zoom to region latches follow the selection (ESCSUITE-500)', () => {
  it('selecting another clip closes Zoom to region, so reselecting the first shows it closed', () => {
    s().setZoomRegionClipId('a')
    s().setSelectedClipId('b')
    expect(s().zoomRegionClipId).toBeNull()
    s().setSelectedClipId('a')
    expect(s().zoomRegionClipId).toBeNull()
  })

  it('deselecting closes Zoom to region', () => {
    s().setZoomRegionClipId('a')
    s().setSelectedClipId(null)
    expect(s().zoomRegionClipId).toBeNull()
    s().setSelectedClipId('a')
    expect(s().zoomRegionClipId).toBeNull()
  })

  it('crop mode behaves the same way', () => {
    s().setCropClipId('a')
    s().setSelectedClipId('b')
    expect(s().cropClipId).toBeNull()
    s().setSelectedClipId('a')
    expect(s().cropClipId).toBeNull()

    s().setCropClipId('a')
    s().clearMultiSelection()
    expect(s().cropClipId).toBeNull()
  })

  it('keeps the tool open while the same clip stays selected', () => {
    s().setZoomRegionClipId('a')
    s().setSelectedClipId('a')
    expect(s().zoomRegionClipId).toBe('a')
    // A multi-selection change that leaves the primary clip where it is:
    // select b then a (primary a), open the tool, then take b back out.
    s().setSelectedClipId(null)
    s().toggleClipSelection('b')
    s().toggleClipSelection('a')
    s().setZoomRegionClipId('a')
    s().toggleClipSelection('b')
    expect(s().selectedClipIds).toEqual(new Set(['a']))
    expect(s().selectedClipId).toBe('a')
    expect(s().zoomRegionClipId).toBe('a')
  })

  it('a multi-selection that moves the primary clip closes it', () => {
    s().setZoomRegionClipId('a')
    s().toggleClipSelection('b')
    expect(s().selectedClipId).toBe('b')
    expect(s().zoomRegionClipId).toBeNull()

    s().setSelectedClipId('a')
    s().setCropClipId('a')
    s().selectClipsInRange(['a', 'b'])
    expect(s().cropClipId).toBeNull()
  })

  it('deleting the clip closes it, and undo brings the clip back with the tool closed', () => {
    s().setZoomRegionClipId('a')
    s().removeClipFromTimeline('a')
    expect(s().selectedClipId).toBeNull()
    expect(s().zoomRegionClipId).toBeNull()
    s().undo()
    s().setSelectedClipId('a')
    expect(s().zoomRegionClipId).toBeNull()
  })

  it('an undo that keeps the selection leaves the tool open', () => {
    s().updateClip('a', { name: 'renamed' })
    s().setZoomRegionClipId('a')
    s().undo()
    expect(s().project.timeline.clips.find((c) => c.id === 'a')?.name).toBe('a')
    expect(s().selectedClipId).toBe('a')
    expect(s().zoomRegionClipId).toBe('a')
  })

  it('opening the tool on the selected clip does not change the selection', () => {
    s().setCropClipId('a')
    expect(s().cropClipId).toBe('a')
    expect(s().selectedClipId).toBe('a')
  })
})

describe('releasedLatches', () => {
  const state = (selectedClipId: string | null, cropClipId: string | null, zoomRegionClipId: string | null) =>
    ({ selectedClipId, cropClipId, zoomRegionClipId }) as EditorState

  it('clears nothing when the write does not change selectedClipId', () => {
    expect(releasedLatches(state('a', 'a', 'a'), { zoom: 2 })).toBeNull()
    expect(releasedLatches(state('a', 'a', 'a'), { selectedClipId: 'a' })).toBeNull()
  })

  it('clears each latch that does not name the new selection', () => {
    expect(releasedLatches(state('a', 'a', null), { selectedClipId: 'b' })).toEqual({ cropClipId: null })
    expect(releasedLatches(state('a', null, 'a'), { selectedClipId: null })).toEqual({ zoomRegionClipId: null })
    expect(releasedLatches(state('a', null, null), { selectedClipId: 'b' })).toBeNull()
  })

  it('judges a latch the same write sets by its new value', () => {
    expect(releasedLatches(state(null, null, null), { selectedClipId: 'b', zoomRegionClipId: 'b' })).toBeNull()
    expect(releasedLatches(state('a', 'a', null), { selectedClipId: 'b', cropClipId: 'a' })).toEqual({ cropClipId: null })
  })

  it('applies to the store\'s own setState too', () => {
    useEditorStore.setState({ cropClipId: 'a' })
    useEditorStore.setState({ selectedClipId: 'b' })
    expect(s().cropClipId).toBeNull()
  })
})
