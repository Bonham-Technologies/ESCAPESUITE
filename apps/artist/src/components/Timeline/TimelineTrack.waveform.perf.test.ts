// Per-change work ceiling for ESCSUITE-13's windowed waveform resampling.
//
// Ordinary test, not `bench` mode: it measures through the same doubles every
// other timeline test uses, then asserts the measurement has not grown. That
// way it runs in CI and in `test:coverage` like anything else, and a
// regression fails the build instead of moving a number in a report nobody
// reads.
//
// What ESCSUITE-13 added is `AudioWaveform` resampling a clip's *visible
// window* instead of its whole box, re-sampled when the zoom or the scroll
// position changes `TimelineTrack`'s `viewportLeft`/`viewportRight`. The
// property that matters for the user's low-spec machines is that this
// resample is **one pass per change that actually moves the window**, never
// one per animation frame: a clip drag re-renders every row on this track
// (`dragState` changes every pointer frame — see `TimelineTrack`'s own doc
// comment), and the playhead ticks during playback without touching this
// component's props at all, so neither may cost a resample.
//
// `resamplePeaks` is the one call `AudioWaveform` makes that does real work
// over the peak data (`getPeaksForRange` is a cheap slice); spying on it
// through the module namespace counts exactly how many times a window was
// actually resampled, independent of how many times React re-rendered.
//
// `.perf.test.ts`, not `.tsx`: the element below is built with
// `createElement`, the same convention `timelineGestures.perf.test.ts` uses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { TimelineTrack } from './TimelineTrack'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import { resetStoreForTest, addClip, video } from '../../test/fixtures/projectStore'
import * as waveformUtils from '../../utils/waveform'
import type { Clip, SourceVideo, Track } from '../../store/types'
import type { DragState } from './types'

const TRACK_ID = 'track-1'

function makeTrack(): Track {
  return {
    id: TRACK_ID,
    name: 'Track 1',
    index: 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
  }
}

const sourceWithWaveform: SourceVideo = {
  ...video,
  duration: 60,
  hasAudio: true,
  // Dense enough that no measurement below is bottlenecked by the source
  // data itself (see `AudioWaveform.test.tsx`'s ESCSUITE-13 suite) — this
  // file only counts *how often* a resample happens, not what it finds.
  waveformData: Array.from({ length: 60 * 1000 }, (_, i) => {
    const v = (i + 1) / (60 * 1000)
    return { min: -v, max: v }
  }),
}

interface TrackProps {
  pixelsPerSecond: number
  viewportLeft?: number
  viewportRight?: number
  clip: Clip
  dragState?: DragState | null
}

function trackElement({ pixelsPerSecond, viewportLeft, viewportRight, clip, dragState }: TrackProps) {
  return createElement(TimelineTrack, {
    track: makeTrack(),
    clips: [clip],
    allClips: [clip],
    sourceVideos: [sourceWithWaveform],
    pixelsPerSecond,
    viewportLeft,
    viewportRight,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    dragState: dragState ?? null,
    trimState: null,
    onClipMouseDown: vi.fn(),
    onTrimMouseDown: vi.fn(),
  })
}

describe('TimelineTrack waveform resample ceiling (ESCSUITE-13)', () => {
  let resampleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStoreForTest()
    installCanvasDouble()
    resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
  })

  afterEach(() => {
    uninstallCanvasDouble()
    vi.restoreAllMocks()
  })

  it('resamples once on mount, never again for a render that leaves the window unchanged', () => {
    const clip: Clip = { ...addClip('clip1', 0, 60), trackId: TRACK_ID }
    const { rerender } = render(trackElement({ pixelsPerSecond: 50, clip }))
    expect(resampleSpy).toHaveBeenCalledTimes(1)

    // A pointer frame of some other gesture: `dragState` changes (as it does
    // on every mousemove of a clip drag elsewhere on this track) but nothing
    // about this clip's own window does. Five "frames" in a row, same answer.
    for (let i = 0; i < 5; i++) {
      rerender(
        trackElement({
          pixelsPerSecond: 50,
          clip,
          dragState: {
            clipId: 'some-other-clip',
            originalTrackId: TRACK_ID,
            originalPosition: 0,
            currentTrackId: TRACK_ID,
            currentPosition: i,
            snappedPosition: null,
            offsetX: 0,
          },
        })
      )
    }
    expect(resampleSpy).toHaveBeenCalledTimes(1)
  })

  it('resamples exactly once per zoom change and once per scroll change', () => {
    const clip: Clip = { ...addClip('clip1', 0, 60), trackId: TRACK_ID }

    // Zoom 1: the clip's whole 3000px box fits on screen (no viewport given)
    // — the zoomed-out fallback. One resample for the mount.
    const { rerender } = render(trackElement({ pixelsPerSecond: 50, clip }))
    expect(resampleSpy).toHaveBeenCalledTimes(1)

    // Zoom to 10x: the clip's box is now 30,000px. Still no viewport given,
    // so still the fallback — but the box itself changed, so the fallback's
    // own sample pass has to run again.
    rerender(trackElement({ pixelsPerSecond: 500, clip }))
    expect(resampleSpy).toHaveBeenCalledTimes(2)

    // Scroll into view: the viewport is narrower than the 30,000px box, so
    // this is now windowed. One more pass for the newly visible slice.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 0, viewportRight: 3000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(3)

    // Scroll again: a different slice of the same clip. One more pass.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 6000, viewportRight: 9000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(4)

    // The scrollbar settling on the exact same position (e.g. a resize that
    // reports an unchanged width): no scroll actually happened, no resample.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 6000, viewportRight: 9000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(4)
  })
})
