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
import {
  usePreviewRenderLoop,
  type PreviewRenderLoop,
  type PreviewRenderLoopDeps,
} from './usePreviewRenderLoop'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { FRAME_MS, installPreviewDoubles, last, settle, type PreviewDoubles } from '../../test/renderPreview'

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
})

afterEach(() => {
  doubles.uninstall()
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

/** Every drawFrame call so far, as `[time]`. */
function draws(deps: PreviewRenderLoopDeps): unknown[][] {
  return vi.mocked(deps.drawFrame).mock.calls
}

/** The `time` argument of every drawFrame call so far. */
function drawnTimes(deps: PreviewRenderLoopDeps): number[] {
  return vi.mocked(deps.drawFrame).mock.calls.map((call) => call[0])
}

describe('usePreviewRenderLoop playback', () => {
  it('schedules a frame per rAF tick once playback starts', async () => {
    addClip('clip1', 0, 4)
    const { deps, play } = harness()

    renderHook(() => usePreviewRenderLoop(deps))
    vi.mocked(deps.drawFrame).mockClear()

    play()
    await settle(FRAME_MS * 3)

    const times = drawnTimes(deps)
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

    expect(drawnTimes(deps).length).toBeGreaterThan(0)

    pause()
    // Long enough for the stop to settle its own frame and the 50ms redraw.
    await settle(100)
    const drawnWhenStopped = drawnTimes(deps).length

    await settle(FRAME_MS * 10)

    expect(drawnTimes(deps).length).toBe(drawnWhenStopped)
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
    expect(result.current.getDisplayTime()).toBeGreaterThanOrEqual(1)
    expect(result.current.getDisplayTime()).toBeLessThan(2)
  })

  it('stops at the end of the timeline when loop playback is off', async () => {
    addClip('clip1', 0, 1)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(1200)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(1)
    expect(result.current.getDisplayTime()).toBe(1)
  })
})

describe('usePreviewRenderLoop scrubbing', () => {
  it('draws the uncached frame straight away when there is nothing to seek', async () => {
    const { deps } = harness()

    renderHook(() => usePreviewRenderLoop(deps))

    // No clips at all: black frame, drawn once.
    expect(vi.mocked(deps.drawFrame).mock.calls).toEqual([[0]])
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
    expect(draws(deps)[drawnBeforeFallback]).toEqual([1])
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

/**
 * A <video> as the preview creates it a moment before it has decoded anything:
 * metadata may or may not be in, but no frame is (`readyState` below
 * HAVE_CURRENT_DATA, 2). {@link becomeReady} is the browser getting there.
 */
function notReadyVideo(): HTMLVideoElement {
  doubles.media.script({ video: { readyState: 0 } })
  const element = document.createElement('video')
  doubles.media.script({ video: { readyState: 4 } })
  return element
}

function becomeReady(element: HTMLVideoElement): void {
  Object.defineProperty(element, 'readyState', { value: 2, configurable: true, writable: true })
  element.dispatchEvent(new Event('loadeddata'))
}

/**
 * The 'loadeddata' listeners added to and removed from `element`, as spies
 * that still pass through to the element.
 */
function watchLoadedData(element: HTMLVideoElement) {
  const added = vi.spyOn(element, 'addEventListener')
  const removed = vi.spyOn(element, 'removeEventListener')
  const of = (spy: typeof added | typeof removed) =>
    spy.mock.calls.filter(([type]) => type === 'loadeddata').map(([, listener]) => listener)
  return { added: () => of(added), removed: () => of(removed) }
}

describe('usePreviewRenderLoop readiness paint (ESCSUITE-264)', () => {
  it('paints once more when a paused clip\'s video decodes its first frame, and not before', async () => {
    addClip('clip1', 0, 4)
    const { deps } = harness([])
    deps.videoElementsRef.current.set(video.id, notReadyVideo())
    const element = deps.videoElementsRef.current.get(video.id)!

    renderHook(() => usePreviewRenderLoop(deps))
    // The mount paint and the media-URL paint, both drawn over a video with
    // nothing to draw — and nothing else is coming while the playhead is still.
    await settle(1000)
    const before = draws(deps).length
    expect(before).toBeGreaterThan(0)

    becomeReady(element)

    expect(draws(deps).length).toBe(before + 1)
    expect(last(draws(deps))).toEqual([store().currentTime])
    expect(deps.drawSelectionHandles).toHaveBeenLastCalledWith(store().currentTime)
    expect(deps.drawMultiSelectHandles).toHaveBeenLastCalledWith(store().currentTime)

    // Exactly one: the element reporting data again paints nothing more.
    element.dispatchEvent(new Event('loadeddata'))
    await settle(1000)
    expect(draws(deps).length).toBe(before + 1)
  })

  it('waits for a video that arrives after the clip, as a freshly added clip\'s does', async () => {
    addClip('clip1', 0, 4)
    const { deps } = harness([])

    // The clip is on the timeline before its source has an element at all.
    const { rerender } = renderHook((props: PreviewRenderLoopDeps) => usePreviewRenderLoop(props), {
      initialProps: deps,
    })
    await settle(1000)

    const element = notReadyVideo()
    deps.videoElementsRef.current.set(video.id, element)
    rerender({ ...deps, videoUrlsKey: video.id })
    await settle(1000)
    const before = draws(deps).length

    becomeReady(element)

    expect(draws(deps).length).toBe(before + 1)
  })

  it('leaves no listener behind for a video that is ready already', async () => {
    addClip('clip1', 0, 4)
    const { deps } = harness()
    const element = deps.videoElementsRef.current.get(video.id)!
    const listeners = watchLoadedData(element)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    const before = draws(deps).length

    expect(listeners.added()).toEqual([])
    element.dispatchEvent(new Event('loadeddata'))
    expect(draws(deps).length).toBe(before)
  })

  it('drops the pending paint when the clip leaves before its video is ready', async () => {
    const clip = addClip('clip1', 0, 4)
    const { deps } = harness([])
    const element = notReadyVideo()
    deps.videoElementsRef.current.set(video.id, element)
    const listeners = watchLoadedData(element)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    expect(listeners.added()).toHaveLength(1)
    expect(listeners.removed()).toEqual([])

    act(() => {
      store().removeClipFromTimeline(clip.id)
    })
    await settle(1000)
    // The one listener that was waiting is the one taken off.
    expect(listeners.removed()).toEqual(listeners.added())
    const before = draws(deps).length

    becomeReady(element)

    expect(draws(deps).length).toBe(before)
  })

  it('does not wait on readiness while playing — the next animation frame paints', async () => {
    addClip('clip1', 0, 4)
    const { deps, play } = harness([])
    const element = notReadyVideo()
    deps.videoElementsRef.current.set(video.id, element)
    const listeners = watchLoadedData(element)

    renderHook(() => usePreviewRenderLoop(deps))
    play()
    await settle(FRAME_MS * 3)

    // Attached while paused at mount, taken off the moment playback began.
    expect(listeners.removed()).toEqual(listeners.added())
  })

  /**
   * Paused at 1.5 s inside a one-second fade from `a` (0-2 s) into `b` (2-4 s),
   * each off its own source. `getClipsAtTime` returns only `a` there — the
   * incoming clip has not started — but the frame draws `b`'s element too.
   */
  function pausedInTransition(incoming: HTMLVideoElement) {
    const trackId = store().project.timeline.tracks[0].id
    addClip('a', 0, 2, trackId)
    store().addClipToTimeline(
      { id: 'b', sourceVideoId: 'video2', name: 'b', startTime: 0, endTime: 2, duration: 2 },
      trackId,
      2
    )
    store().updateClipTransition('a', { type: 'fade', duration: 1 })
    const loop = harness()
    loop.deps.videoElementsRef.current.set('video2', incoming)
    loop.seek(1.5)
    return loop
  }

  it('waits for a transition\'s incoming video, which the frame draws though its clip has not started', async () => {
    const incoming = notReadyVideo()
    const { deps } = pausedInTransition(incoming)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    const before = draws(deps).length

    becomeReady(incoming)

    expect(draws(deps).length).toBe(before + 1)
    expect(last(draws(deps))).toEqual([1.5])
  })

  it('leaves no listener on a transition\'s incoming video that is ready already', async () => {
    const incoming = document.createElement('video')
    const listeners = watchLoadedData(incoming)
    const { deps } = pausedInTransition(incoming)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)

    expect(listeners.added()).toEqual([])
  })

  it('a frame step ends on a paint that follows the seek, not only the one before it', async () => {
    doubles.media.script({ video: { stallSeek: true } })
    addClip('clip1', 0, 4)
    const { deps, seek } = harness([])
    const element = document.createElement('video')
    deps.videoElementsRef.current.set(video.id, element)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)
    // Before the seek reports back: only the provisional paint, over the
    // frame the element was showing.
    expect(element.currentTime).toBe(1)
    expect(drawnTimes(deps)).toEqual([1])

    element.dispatchEvent(new Event('seeked'))
    await settle(FRAME_MS)
    // After it: the paint of the frame the seek landed on — and the fallback
    // does not paint a third time.
    expect(drawnTimes(deps)).toEqual([1, 1])
    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 1])
  })
})

/**
 * A <video> whose seeks report back only when the test says so, through
 * {@link seeked}. `readyState` as the double scripts it unless one is given.
 */
function stalledVideo(readyState?: number): HTMLVideoElement {
  doubles.media.script({ video: { stallSeek: true, ...(readyState === undefined ? {} : { readyState }) } })
  const element = document.createElement('video')
  doubles.media.script({ video: { stallSeek: false, readyState: 4 } })
  return element
}

function seeked(element: HTMLVideoElement): void {
  element.dispatchEvent(new Event('seeked'))
}

/** The 'seeked' listeners added to and removed from `element`. */
function watchSeeked(element: HTMLVideoElement) {
  const added = vi.spyOn(element, 'addEventListener')
  const removed = vi.spyOn(element, 'removeEventListener')
  const of = (spy: typeof added | typeof removed) =>
    spy.mock.calls.filter(([type]) => type === 'seeked').map(([, listener]) => listener)
  return { added: () => of(added), removed: () => of(removed) }
}

/**
 * Two clips at the playhead, each off its own source, on two tracks — a
 * picture-in-picture arrangement: `a` (video1, source 0-4) and `b` (video2,
 * source 2-6), both at timeline 0-4. At timeline 1, `a` wants source 1 and `b`
 * source 3. Both elements' seeks are stalled.
 */
function pausedOverTwoClips() {
  addClip('a', 0, 4)
  store().addClipToTimeline(
    { id: 'b', sourceVideoId: 'video2', name: 'b', startTime: 2, endTime: 6, duration: 4 },
    undefined,
    0
  )
  const loop = harness([])
  const a = stalledVideo()
  const b = stalledVideo()
  loop.deps.videoElementsRef.current.set(video.id, a)
  loop.deps.videoElementsRef.current.set('video2', b)
  return { ...loop, a, b }
}

describe('usePreviewRenderLoop seeks (ESCSUITE-275)', () => {
  it('seeks a video that arrives while paused mid-clip, and paints after its seek', async () => {
    addClip('clip1', 0, 4)
    const { deps, seek } = harness([])
    seek(1)

    // The clip is under the playhead before its source has an element at all.
    const { rerender } = renderHook((props: PreviewRenderLoopDeps) => usePreviewRenderLoop(props), {
      initialProps: deps,
    })
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    const element = stalledVideo()
    deps.videoElementsRef.current.set(video.id, element)
    rerender({ ...deps, videoUrlsKey: video.id })
    await settle(100)

    // Seeked to the playhead's source time, not left at 0; and before the seek
    // reports back, only the media-change paint 50 ms after the arrival.
    expect(element.currentTime).toBe(1)
    expect(drawnTimes(deps)).toEqual([1])

    seeked(element)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1, 1])

    // The seek landed, so the fallback has nothing left to paint.
    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 1])
  })

  it('does not seek a video that arrives within 0.05 s of the playhead, and paints once', async () => {
    addClip('clip1', 0, 4)
    const { deps, seek } = harness([])
    seek(1)

    const { rerender } = renderHook((props: PreviewRenderLoopDeps) => usePreviewRenderLoop(props), {
      initialProps: deps,
    })
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    const element = stalledVideo()
    element.currentTime = 1.02
    const seeksBefore = doubles.media.seeks.length
    deps.videoElementsRef.current.set(video.id, element)
    rerender({ ...deps, videoUrlsKey: video.id })
    await settle(1000)

    expect(doubles.media.seeks.length).toBe(seeksBefore)
    expect(element.currentTime).toBe(1.02)
    expect(drawnTimes(deps)).toEqual([1])
  })

  it.each([
    ['loadeddata then seeked', ['loadeddata', 'seeked']],
    ['seeked then loadeddata', ['seeked', 'loadeddata']],
  ])('a video that arrives unready and off the playhead ends on a paint after both its readiness and its seek (%s)', async (_, order) => {
    addClip('clip1', 0, 4)
    const { deps, seek } = harness([])
    seek(1)

    const { rerender } = renderHook((props: PreviewRenderLoopDeps) => usePreviewRenderLoop(props), {
      initialProps: deps,
    })
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    const element = stalledVideo(0)
    deps.videoElementsRef.current.set(video.id, element)
    rerender({ ...deps, videoUrlsKey: video.id })
    await settle(100)
    expect(element.currentTime).toBe(1)
    expect(drawnTimes(deps)).toEqual([1])

    const deliver = (type: string) => {
      if (type === 'loadeddata') becomeReady(element)
      else seeked(element)
    }

    deliver(order[0])
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1, 1])

    deliver(order[1])
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1, 1, 1])

    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 1, 1])
  })

  it('waits for a seek still under way when the element set changes mid-scrub', async () => {
    addClip('clip1', 0, 4)
    const { deps, seek } = harness([])
    const element = stalledVideo()
    deps.videoElementsRef.current.set(video.id, element)
    const initialProps = { ...deps, videoUrlsKey: video.id }

    const { rerender } = renderHook((props: PreviewRenderLoopDeps) => usePreviewRenderLoop(props), {
      initialProps,
    })
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1])
    // The browser has the seek in hand: currentTime already reads the target.
    Object.defineProperty(element, 'seeking', { value: true, configurable: true })

    // An unrelated source arrives before that seek reports back.
    deps.videoElementsRef.current.set('video2', document.createElement('video'))
    rerender({ ...initialProps, videoUrlsKey: `${video.id},video2` })
    await settle(100)
    expect(drawnTimes(deps)).toEqual([1, 1])

    Object.defineProperty(element, 'seeking', { value: false, configurable: true })
    seeked(element)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1, 1, 1])
    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 1, 1])
  })

  it.each([
    ['a then b', (e: { a: HTMLVideoElement; b: HTMLVideoElement }) => [e.a, e.b]],
    ['b then a', (e: { a: HTMLVideoElement; b: HTMLVideoElement }) => [e.b, e.a]],
  ])('paints once after the last of two seeks, not the first (%s)', async (_, order) => {
    const loop = pausedOverTwoClips()
    const { deps, seek } = loop

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)
    expect(loop.a.currentTime).toBe(1)
    expect(loop.b.currentTime).toBe(3)
    expect(drawnTimes(deps)).toEqual([1])

    const [first, second] = order(loop)
    seeked(first)
    await settle(FRAME_MS)
    // The other element still shows its old frame: no paint yet.
    expect(drawnTimes(deps)).toEqual([1])

    seeked(second)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1, 1])
    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 1])
  })

  it('waits for a transition\'s incoming video as well as its outgoing one', async () => {
    const trackId = store().project.timeline.tracks[0].id
    addClip('a', 0, 2, trackId)
    store().addClipToTimeline(
      { id: 'b', sourceVideoId: 'video2', name: 'b', startTime: 1, endTime: 3, duration: 2 },
      trackId,
      2
    )
    store().updateClipTransition('a', { type: 'fade', duration: 1 })
    const { deps, seek } = harness([])
    const outgoing = stalledVideo()
    const incoming = stalledVideo()
    deps.videoElementsRef.current.set(video.id, outgoing)
    deps.videoElementsRef.current.set('video2', incoming)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1.5)
    await settle(FRAME_MS)
    expect(outgoing.currentTime).toBe(1.5)
    expect(incoming.currentTime).toBe(1)
    expect(drawnTimes(deps)).toEqual([1.5])

    seeked(outgoing)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1.5])

    seeked(incoming)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1.5, 1.5])
  })

  it('paints once on the fallback when only one of two seeks reports back, and ignores the late one', async () => {
    const loop = pausedOverTwoClips()
    const { deps, seek, a, b } = loop

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)
    seeked(a)
    await settle(FRAME_MS)
    expect(drawnTimes(deps)).toEqual([1])

    // 300 ms after the scrub: the fallback paints, once.
    await settle(300)
    expect(drawnTimes(deps)).toEqual([1, 1])

    seeked(b)
    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 1])
  })

  it('a playhead move before the seeks land ends the old cycle: its listeners go and it paints nothing', async () => {
    const loop = pausedOverTwoClips()
    const { deps, seek, a, b } = loop
    const listenersA = watchSeeked(a)
    const listenersB = watchSeeked(b)

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)
    const addedA = listenersA.added().length
    const addedB = listenersB.added().length
    expect(addedA).toBeGreaterThan(0)
    expect(addedB).toBeGreaterThan(0)

    // One seek lands, and the playhead moves on before the other does.
    seeked(a)
    seek(2)

    // Every listener the first cycle armed has been taken off.
    for (const listener of listenersA.added().slice(0, addedA)) {
      expect(listenersA.removed()).toContain(listener)
    }
    for (const listener of listenersB.added().slice(0, addedB)) {
      expect(listenersB.removed()).toContain(listener)
    }

    await settle(1000)
    // Nothing at the old playhead: the immediate paint at 2 and its fallback.
    expect(drawnTimes(deps)).toEqual([1, 2, 2])
  })

  it('a playhead move after both seeks land but before their paint drops that paint', async () => {
    const loop = pausedOverTwoClips()
    const { deps, seek, a, b } = loop

    renderHook(() => usePreviewRenderLoop(deps))
    await settle(1000)
    vi.mocked(deps.drawFrame).mockClear()

    seek(1)
    await settle(FRAME_MS)
    seeked(a)
    seeked(b)
    // The final paint is an animation frame away; the playhead moves first.
    seek(2)

    await settle(1000)
    expect(drawnTimes(deps)).toEqual([1, 2, 2])
  })
})

describe('usePreviewRenderLoop display time', () => {
  /**
   * Subscribe to the readout and record every position it is told about.
   * That list is the whole contract: how often React is asked to re-render the
   * timecode, and with what.
   */
  function watch(loop: PreviewRenderLoop): { published: number[]; unsubscribe: () => void } {
    const published: number[] = []
    const unsubscribe = loop.subscribeDisplayTime(() => {
      published.push(loop.getDisplayTime())
    })
    return { published, unsubscribe }
  }

  it('publishes at most ten times a second while playing', async () => {
    addClip('clip1', 0, 4)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    const { published } = watch(result.current)

    play()
    await settle(1000)

    // A second of 16ms frames is ~60 draws but must be at most 10 publishes
    // (plus the leading one the first frame of playback is allowed).
    expect(drawnTimes(deps).length).toBeGreaterThan(30)
    expect(published.length).toBeLessThanOrEqual(11)
    expect(published.length).toBeGreaterThanOrEqual(5)
    // Consecutive publishes are a throttle window apart, not a frame apart.
    for (let i = 1; i < published.length; i++) {
      expect(published[i] - published[i - 1]).toBeGreaterThanOrEqual(0.09)
    }
  })

  it('publishes the in point exactly when playback loops back', async () => {
    addClip('clip1', 0, 4)
    store().setLoopPlayback(true)
    store().setInPoint(1)
    store().setOutPoint(2)
    store().setCurrentTime(1.9)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    const { published } = watch(result.current)

    play()
    await settle(200)

    expect(published).toContain(1)
  })

  it('publishes the timeline duration exactly when playback ends', async () => {
    addClip('clip1', 0, 1)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    const { published } = watch(result.current)

    play()
    await settle(1200)

    expect(last(published)).toBe(1)
    expect(result.current.getDisplayTime()).toBe(1)
  })

  it('publishes a scrub straight away, with no throttle between scrubs', async () => {
    addClip('clip1', 0, 4)
    const { deps, seek } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    const { published } = watch(result.current)

    seek(2)
    await settle(0)
    seek(3)
    await settle(0)

    // Both, inside one throttle window — a scrub never lags the pointer.
    expect(published).toEqual([2, 3])
  })

  it('stops notifying a listener that has unsubscribed', async () => {
    addClip('clip1', 0, 4)
    const { deps, play } = harness()

    const { result } = renderHook(() => usePreviewRenderLoop(deps))
    const { published, unsubscribe } = watch(result.current)

    unsubscribe()
    play()
    await settle(500)

    expect(published).toEqual([])
    expect(result.current.getDisplayTime()).toBeGreaterThan(0)
  })
})
