// The journey users reported in ESCSUITE-355, pinned by ESCSUITE-356: split a
// clip with sound twice, delete the middle piece, drag the last piece left to
// close the gap. The first piece must still sound, and playback must jump the
// source across the cut rather than play the deleted middle.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePreviewRenderLoop, type PreviewRenderLoopDeps } from './usePreviewRenderLoop'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { FRAME_MS, audioSource, installPreviewDoubles, settle, type PreviewDoubles } from '../../test/renderPreview'

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

function harness() {
  const videoElementsRef = { current: new Map<string, HTMLVideoElement>() }
  const extraVideoElementsRef = { current: new Map<string, HTMLVideoElement[]>() }
  const audioElementsRef = { current: new Map<string, HTMLAudioElement>() }
  videoElementsRef.current.set(video.id, document.createElement('video'))
  audioElementsRef.current.set(audioSource.id, document.createElement('audio'))
  const isPlayingRef = { current: false }
  const currentTimeRef = { current: store().currentTime }
  const deps: PreviewRenderLoopDeps = {
    drawFrame: vi.fn(),
    drawSelectionHandles: vi.fn(),
    drawMultiSelectHandles: vi.fn(),
    videoElementsRef,
    extraVideoElementsRef,
    elementSlotsRef: { current: new Map<string, number>() },
    audioElementsRef,
    isPlayingRef,
    currentTimeRef,
    videoUrlsKey: video.id,
    imageUrlsKey: '',
  }
  return {
    deps,
    play() { isPlayingRef.current = true; store().setIsPlaying(true) },
    seek(t: number) { currentTimeRef.current = t; store().setCurrentTime(t) },
  }
}

/** Split at 3 and 6, delete the middle, move the third piece to 3. */
function splitDeleteClose(id: string) {
  store().splitClip(id, 3)
  const [first, rest] = sorted()
  store().splitClip(rest.id, 3)
  const [, middle, third] = sorted()
  expect(store().removeClipFromTimeline(middle.id)).toBe(true)
  expect(store().setClipTimelinePosition(third.id, first.timelinePosition + first.duration)).toBe(true)
  return sorted()
}
function sorted() {
  return [...store().project.timeline.clips].sort((a, b) => a.timelinePosition - b.timelinePosition)
}

describe('split, delete the middle, close the gap (ESCSUITE-356)', () => {
  it('keeps each piece on its own source window', () => {
    addClip('v', 0, 10)
    const [a, b] = splitDeleteClose('v')
    expect([a.timelinePosition, a.startTime, a.endTime, a.duration]).toEqual([0, 0, 3, 3])
    expect([b.timelinePosition, b.startTime, b.endTime, b.duration]).toEqual([3, 6, 10, 4])
  })

  it('video+audio clip: plays the first piece with sound, then jumps the source across the cut', async () => {
    addClip('v', 0, 10)
    splitDeleteClose('v')
    const { deps, play, seek } = harness()
    const el = deps.videoElementsRef.current.get(video.id)!
    seek(2.5)
    renderHook(() => usePreviewRenderLoop(deps))
    await settle(500)
    play()
    await settle(FRAME_MS * 2)
    expect(el.muted).toBe(false)
    expect(el.currentTime).toBeGreaterThanOrEqual(2.5)
    expect(el.currentTime).toBeLessThan(3)
    await settle(700)
    expect(el.muted).toBe(false)
    expect(el.currentTime).toBeGreaterThanOrEqual(6)
    expect(el.currentTime).toBeLessThan(6.5)
  })

  it('audio-only clip: plays the first piece, then jumps the source across the cut', async () => {
    store().addSourceVideo(audioSource)
    store().addClipToTimeline({ id: 'a', sourceVideoId: audioSource.id, name: 'a', startTime: 0, endTime: 10, duration: 10 }, undefined, 0)
    splitDeleteClose('a')
    const { deps, play, seek } = harness()
    const el = deps.audioElementsRef.current.get(audioSource.id)!
    seek(2.5)
    renderHook(() => usePreviewRenderLoop(deps))
    await settle(500)
    play()
    await settle(FRAME_MS * 2)
    expect(el.play).toHaveBeenCalled()
    expect(el.currentTime).toBeGreaterThanOrEqual(2.5)
    expect(el.currentTime).toBeLessThan(3)
    await settle(700)
    expect(el.currentTime).toBeGreaterThanOrEqual(6)
    expect(el.currentTime).toBeLessThan(6.5)
  })
})
