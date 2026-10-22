// The journey users reported in ESCSUITE-355, pinned by ESCSUITE-356: split a
// clip with sound twice, delete the middle piece, drag the last piece left to
// close the gap. Both pieces left must still draw their waveform.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Timeline } from './Timeline'
import { useEditorStore } from '../../store/projectStore'
import type { SourceVideo } from '../../store/types'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock)

const src: SourceVideo = {
  id: 'v', name: 'v.webm', duration: 10, width: 1920, height: 1080, frameRate: 30,
  mimeType: 'video/webm', size: 1, hasAudio: true,
  waveformData: Array.from({ length: 1000 }, () => ({ min: -0.5, max: 0.5 })),
}
const s = () => useEditorStore.getState()
const sorted = () => [...s().project.timeline.clips].sort((a, b) => a.timelinePosition - b.timelinePosition)

describe('waveform after split, delete middle, close gap', () => {
  beforeEach(() => {
    s().resetProject(); installCanvasDouble(); s().addSourceVideo(src)
    s().addClipToTimeline({ id: 'c', name: 'c', sourceVideoId: 'v', startTime: 0, endTime: 10, duration: 10 }, s().project.timeline.tracks[0].id, 0)
  })
  afterEach(() => { uninstallCanvasDouble(); cleanup() })

  it('both remaining pieces draw a waveform', () => {
    s().splitClip('c', 3)
    s().splitClip(sorted()[1].id, 3)
    const [first, middle, third] = sorted()
    s().removeClipFromTimeline(middle.id)
    s().setClipTimelinePosition(third.id, first.duration)
    const { container } = render(<Timeline />)
    const clips = container.querySelectorAll('[data-clip-id]')
    expect(clips).toHaveLength(2)
    for (const el of clips) expect(el.querySelector('canvas')).not.toBeNull()
  })
})
