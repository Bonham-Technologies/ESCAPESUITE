// When the preview asks for a frame, and — just as importantly — when it stops.
//
// The component tests watch the canvas and so can only see the frames that
// were drawn. These watch the loop itself: that an animation frame is
// scheduled the moment playback starts and cancelled on pause and on unmount
// (a loop left running past unmount would draw to a dead canvas forever), that
// a scrub settles on the accurate frame once the seek reports back, and that
// the in/out points bound the loop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePreviewRenderLoop, type PreviewRenderLoopDeps } from './usePreviewRenderLoop'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { FRAME_MS, installPreviewDoubles, settle, type PreviewDoubles } from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

interface LoopHarness {
  deps: PreviewRenderLoopDeps
  /** Set the store playing and mirror it into the ref, as the component does. */
  play(): void
  pause(): void
  /** Move the playhead and mirror it into the ref, as the component does. */
  seek(time: number): void
}

/**
 * The deps the component hands the loop: two element maps, the playback
 * mirrors, and the three draw functions, each a spy.
 */
function harness(sources: string[] = [video.id]): LoopHarness {
  const videoElementsRef = { current: new Map<string, HTMLVideoElement>() }
  const audioElementsRef = { current: new Map<string, HTMLAudioElement>() }
  for (const id of sources) {
    videoElementsRef.current.set(id, document.createElement('video'))
  }

  const isPlayingRef = { current: false }
  const currentTimeRef = { current: store().currentTime }

  const deps: PreviewRenderLoopDeps = {
    drawFrame: vi.fn(),
    drawSelectionHandles: vi.fn(),
    drawMultiSelectHandles: vi.fn(),
    videoElementsRef,
    audioElementsRef,
    isPlayingRef,
    currentTimeRef,
    videoUrlsKey: sources.join(','),
    imageUrlsKey: '',
  }

  return {
    deps,
    play() {
      isPlayingRef.current = true
      store().setIsPlaying(true)
    },
    pause() {
      isPlayingRef.current = false
      store().setIsPlaying(false)
    },
    seek(time: number) {
      currentTimeRef.current = time
      store().setCurrentTime(time)
    },
  }
}

/** Every drawFrame call so far, as `[time]` or `[time, useCache]`. */
function draws(deps: PreviewRenderLoopDeps): unknown[][] {
  return vi.mocked(deps.drawFrame).mock.calls
}

/** The `time` argument of every drawFrame call so far. */
function drawnTimes(deps: PreviewRenderLoopDeps): number[] {
  return vi.mocked(deps.drawFrame).mock.calls.map((call) => call[0])
}

/**
 * The frames the playback loop drew. Only it leaves `useCache` at its default;
 * every other redraw in the hook passes `false` explicitly.
 */
function playbackDraws(deps: PreviewRenderLoopDeps): number[] {
  return draws(deps).filter((call) => call.length === 1).map((call) => call[0] as number)
}

describe('usePreviewRenderLoop playback', () => {
  it('schedules a frame per rAF tick once playback starts', async () => {
    addClip('clip1', 0, 4)
    const { deps, play } = harness()

    renderHook(() => usePreviewRenderLoop(deps))
    vi.mocked(deps.drawFrame).mockClear()

    play()
    await settle(FRAME_MS * 3)

    const times = playbackDraws(deps)
    expect(times.length).toBeGreaterThanOrEqual(3)
    // The loop runs off performance.now(), so each frame draws a later time.
    expect(times[times.length - 1]).toBeGreaterThan(times[0])
  })

  it('cancels the loop when playback stops', async () => {
    addClip('clip1', 0, 4)
    const { deps, play, pause } = harness()

    renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(FRAME_MS * 3)

    const drawnWhilePlaying = playbackDraws(deps).length
    expect(drawnWhilePlaying).toBeGreaterThan(0)

    pause()
    // Long enough for the stop to settle its own frame and the 50ms redraw.
    await settle(100)
    const drawnWhenStopped = drawnTimes(deps).length

    await settle(FRAME_MS * 10)

    expect(drawnTimes(deps).length).toBe(drawnWhenStopped)
    expect(playbackDraws(deps).length).toBeLessThanOrEqual(drawnWhilePlaying + 1)
  })

  it('pauses every media element when playback stops', async () => {
    addClip('clip1', 0, 4)
    const { deps, play, pause } = harness()
    const element = deps.videoElementsRef.current.get(video.id)!

    renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(FRAME_MS)

    pause()
    await settle()

    expect(element.pause).toHaveBeenCalled()
    expect(element.muted).toBe(true)
  })

  it('cancels the pending frame on unmount', async () => {
    addClip('clip1', 0, 4)
    const { deps, play } = harness()

    const { unmount } = renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(FRAME_MS * 2)

    act(() => unmount())
    const drawnAtUnmount = drawnTimes(deps).length

    await settle(FRAME_MS * 5)

    expect(drawnTimes(deps).length).toBe(drawnAtUnmount)
    expect(drawnAtUnmount).toBeGreaterThan(0)
  })

  it('loops back to the in point when it reaches the out point', async () => {
    addClip('clip1', 0, 4)
    store().setLoopPlayback(true)
    store().setInPoint(1)
    store().setOutPoint(2)
    store().setCurrentTime(1.9)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(200)

    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBeCloseTo(1, 1)
    // Back inside the in/out range, and running on from there.
    expect(result.current.displayTime).toBeGreaterThanOrEqual(1)
    expect(result.current.displayTime).toBeLessThan(2)
  })

  it('stops at the end of the timeline when loop playback is off', async () => {
    addClip('clip1', 0, 1)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(1200)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(1)
    expect(result.current.displayTime).toBe(1)
  })
})

describe('usePreviewRenderLoop scrubbing', () => {
  it('draws the uncached frame straight away when there is nothing to seek', async () => {
    const { deps } = harness()

    renderHook(() => usePreviewRenderLoop(deps))

    // No clips at all: black frame, drawn once, with the cache bypassed.
    expect(vi.mocked(deps.drawFrame).mock.calls).toEqual([[0, false]])
    expect(deps.drawSelectionHandles).toHaveBeenCalledWith(0)
    expect(deps.drawMultiSelectHandles).toHaveBeenCalledWith(0)
  })

  it('seeks the active video and redraws once the seek reports back', async () => {
    const clip = addClip('clip1', 0, 4)
    store().updateClip(clip.id, { startTime: 3, endTime: 7 })
    const { deps, seek } = harness()
    const element = deps.videoElementsRef.current.get(video.id)!

    renderHook(() => usePreviewRenderLoop(deps))
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)

    // Seeked to the clip's own start plus the offset into it.
    expect(element.currentTime).toBe(4)
    // Once immediately with whatever frame is showing, once after 'seeked'.
    expect(draws(deps).filter((call) => call[0] === 1).length).toBeGreaterThanOrEqual(2)
  })

  it('redraws on the fallback timeout when the seek never reports back', async () => {
    doubles.media.script({ video: { stallSeek: true } })
    addClip('clip1', 0, 4)
    const { deps, seek } = harness([])
    deps.videoElementsRef.current.set(video.id, document.createElement('video'))

    renderHook(() => usePreviewRenderLoop(deps))

    seek(1)
    // Long enough for the media-URL redraw at 50ms, short of the 300ms fallback.
    await settle(100)
    const drawnBeforeFallback = draws(deps).length

    await settle(250)

    expect(draws(deps).length).toBe(drawnBeforeFallback + 1)
    expect(draws(deps)[drawnBeforeFallback]).toEqual([1, false])
  })

  it('redraws after a media URL change, once the elements have settled', async () => {
    addClip('clip1', 0, 4)
    const { deps } = harness()

    const { rerender } = renderHook((props: PreviewRenderLoopDeps) => usePreviewRenderLoop(props), {
      initialProps: deps,
    })
    vi.mocked(deps.drawFrame).mockClear()

    rerender({ ...deps, videoUrlsKey: 'video1,video2' })
    expect(deps.drawFrame).not.toHaveBeenCalled()

    await settle(50)

    expect(deps.drawFrame).toHaveBeenCalledWith(store().currentTime)
  })
})
