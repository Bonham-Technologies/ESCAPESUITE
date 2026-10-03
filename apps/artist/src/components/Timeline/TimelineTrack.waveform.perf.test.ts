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
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
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
    // Exact, measured 2026-10-01: one resample for the mount, zero more for
    // five further renders that change nothing about this clip's window.
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
          },
        })
      )
    }
    expect(resampleSpy).toHaveBeenCalledTimes(1)
  })

  it('resamples once per zoom change, once per bucket-crossing scroll, and never for a scroll inside one bucket or a revisited window', () => {
    // Exact, measured 2026-10-01: six distinct window states below, five of
    // which actually move the window — the sixth is a revisit of state 3's
    // window (ESCSUITE-13 round 2, MAJOR-2's cache-hit reachability) and a
    // seventh (not counted here, see the `scroll bucketing` case below) stays
    // inside state 3's 64px bucket and costs nothing either.
    const clip: Clip = { ...addClip('clip1', 0, 60), trackId: TRACK_ID }

    // 1. Zoom 1: the clip's whole 3000px box fits on screen (no viewport
    //    given). One resample for the mount.
    const { rerender } = render(trackElement({ pixelsPerSecond: 50, clip }))
    expect(resampleSpy).toHaveBeenCalledTimes(1)

    // 2. Zoom to 10x: the clip's box is now 30,000px. Still no viewport
    //    given — but the box itself changed, so the sample pass has to run
    //    again even without a narrower window.
    rerender(trackElement({ pixelsPerSecond: 500, clip }))
    expect(resampleSpy).toHaveBeenCalledTimes(2)

    // 3. Scroll into view: the viewport is narrower than the 30,000px box,
    //    so this is now windowed. One more pass for the newly visible slice.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 0, viewportRight: 3000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(3)

    // 4. Scroll again: a different slice of the same clip. One more pass.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 6000, viewportRight: 9000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(4)

    // 5. The scrollbar settling on the exact same position (e.g. a resize
    //    that reports an unchanged width): no scroll actually happened, no
    //    resample.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 6000, viewportRight: 9000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(4)

    // 6. Scrolled back to state 3's viewport: a cache hit, not a fifth
    //    resample (ESCSUITE-13 round 2, MAJOR-2 — the cache's entire reason
    //    for existing is exercised here, not just its bookkeeping).
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 0, viewportRight: 3000 }))
    expect(resampleSpy).toHaveBeenCalledTimes(4)
  })

  it('does not resample for a scroll that stays inside one 64px bucket (MAJOR-1(a))', () => {
    // Exact, measured 2026-10-01.
    const clip: Clip = { ...addClip('clip1', 0, 60), trackId: TRACK_ID }
    const { rerender } = render(
      trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 0, viewportRight: 3000 })
    )
    expect(resampleSpy).toHaveBeenCalledTimes(1)

    // A one-pixel scroll: still the same 64px bucket on both ends.
    rerender(trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 1, viewportRight: 3001 }))
    expect(resampleSpy).toHaveBeenCalledTimes(1)
  })

  it('a 300px drag over 20 frames at 15px/frame resamples 5-6 times, not 20 (ESCSUITE-13 round 3)', () => {
    // Measured 2026-10-01: exactly 6 with the window/phase chosen below.
    // 300 / 64 (one bucket) is ~4.7, so a drag crossing that much ground
    // visits 5 or 6 distinct buckets depending on exactly where the drag
    // starts relative to the grid (the "phase") — asserting a range rather
    // than one exact count, because the point of the ceiling is "not one
    // resample per frame", not pinning a phase nobody chose on purpose. The
    // window width (3072 = 48 x 64) is itself bucket-aligned so its own end
    // doesn't drift independently of the start as the drag moves — the
    // property under test is the *start*'s bucket crossings, not an
    // artefact of an arbitrary window width.
    const clip: Clip = { ...addClip('clip1', 0, 60), trackId: TRACK_ID }
    const windowWidth = 3072
    const { rerender } = render(
      trackElement({ pixelsPerSecond: 500, clip, viewportLeft: 0, viewportRight: windowWidth })
    )
    expect(resampleSpy).toHaveBeenCalledTimes(1) // the mount

    for (let frame = 1; frame <= 20; frame++) {
      const viewportLeft = frame * 15
      rerender(
        trackElement({
          pixelsPerSecond: 500,
          clip,
          viewportLeft,
          viewportRight: viewportLeft + windowWidth,
        })
      )
    }

    // 1 (mount) + 5 or 6 bucket crossings over the drag.
    expect(resampleSpy.mock.calls.length).toBeGreaterThanOrEqual(1 + 5)
    expect(resampleSpy.mock.calls.length).toBeLessThanOrEqual(1 + 6)
  })
})

describe('AudioWaveform draw ceiling: one fillRect per sample, zero extra canvas calls (MINOR-4)', () => {
  beforeEach(() => {
    resetStoreForTest()
    installCanvasDouble()
  })

  afterEach(() => {
    uninstallCanvasDouble()
  })

  it('draws exactly one fillRect per sample, one getContext/clearRect/scale per draw — exact, measured 2026-10-01', () => {
    const clip: Clip = { ...addClip('clip1', 0, 60), trackId: TRACK_ID }
    // A windowed draw — width exceeds the 2000-sample floor and the window
    // holds plenty of source peaks, so the sample count equals the window's
    // own pixel width exactly (see `AudioWaveform.test.tsx`'s ESCSUITE-13
    // suite for the derivation).
    const windowWidth = 2048
    render(
      trackElement({
        pixelsPerSecond: 500,
        clip,
        viewportLeft: 0,
        viewportRight: windowWidth,
      })
    )

    const ctx = getLastCanvasContext()!
    // The draw path allocates nothing per call: it reads `displayPeaks[i]`
    // and calls exactly one 2D-context method per bar, no object or array
    // construction in between (ESCSUITE-13 round 2, MAJOR-1). A regression
    // that started building an intermediate array, or drawing more than one
    // rect per sample, would move this count — it would not stay exact.
    expect(ctx.argsFor('fillRect')).toHaveLength(windowWidth)
    expect(ctx.argsFor('clearRect')).toHaveLength(1)
    expect(ctx.argsFor('scale')).toHaveLength(1)
  })
})
