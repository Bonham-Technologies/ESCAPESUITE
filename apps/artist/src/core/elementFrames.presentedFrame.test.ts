// ESCSUITE-454: the element exporters (WebM, GIF) drew each `<video>` as soon
// as its seek's 'seeked' fired. Chromium can fire it while the frame the
// element paints is still the one from before the seek, so an export
// sometimes repeated a frame after a cut or a trim. `syncVideoToTime` now waits
// for the frame callback it registered before the seek, within a ceiling, and
// stops waiting on an element that never answers one after a paused seek.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFrameComposer, rewindElementSources, type ElementSources } from './elementFrames'
import { elementSeekTarget } from './elementSeek'
import { MISSED_PRESENTATIONS_LIMIT, PRESENTED_FRAME_WAIT_MS } from './presentedFrame'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { PresentingVideo, type PresentingVideoOptions } from '../test/doubles/presentingVideo'
import { makeClip, makeTrack } from '../test/fixtures/clipFixtures'

const PROJECT = { width: 640, height: 360 }
const PRESENT_AFTER_MS = 40

beforeEach(() => {
  installCanvasDouble()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  uninstallCanvasDouble()
  vi.restoreAllMocks()
})

/** A one-clip export over `video`, its clip trimmed to start 0.5 s into the source. */
function composerOver(video: PresentingVideo) {
  const element = video as unknown as HTMLVideoElement
  const sources: ElementSources = {
    videoElements: new Map([['v1', element]]),
    imageElements: new Map(),
    extraVideoElements: new Map([['v1', []]]),
    sourceNames: new Map([['v1', 'take.webm']]),
  }
  const clips = [
    makeClip({ id: 'A', sourceVideoId: 'v1', trackId: 't1', startTime: 0.5, endTime: 2.5, duration: 2 }),
  ]
  const playbackState = rewindElementSources(sources)
  const canvas = document.createElement('canvas')
  canvas.width = PROJECT.width
  canvas.height = PROJECT.height
  canvas.getContext('2d', { alpha: false })
  const ctx = getLastCanvasContext() as RecordingCanvasRenderingContext2D
  // What each draw of the element painted, at the moment it was drawn.
  const drawn: number[] = []
  ctx.drawImage.mockImplementation((source: unknown) => {
    if (source === element) drawn.push(video.shownTime)
  })
  const composeFrame = createFrameComposer({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    canvas,
    clips,
    tracks: [makeTrack({ id: 't1', index: 0 })],
    sources,
    playbackState,
    projectSize: PROJECT,
    outputSize: PROJECT,
    drawOptions: { filterScale: 1 },
    frameRate: 30,
  })
  return { composeFrame, drawn }
}

/** Compose one frame under fake timers; resolves to the fake milliseconds it took. */
async function compose(composeFrame: (time: number) => Promise<void>, time: number): Promise<number> {
  const started = Date.now()
  let done = false
  const pending = composeFrame(time).then(() => {
    done = true
  })
  while (!done) await vi.advanceTimersByTimeAsync(1)
  await pending
  return Date.now() - started
}

function video(options: PresentingVideoOptions) {
  return new PresentingVideo(options)
}

describe('element exporters wait for the sought frame to be presented (ESCSUITE-454)', () => {
  it('draws the sought frame, not the one before the seek, from the trimmed clip’s first frame on', async () => {
    const element = video({ presentAfterMs: PRESENT_AFTER_MS })
    const { composeFrame, drawn } = composerOver(element)
    const wanted: number[] = []
    for (let n = 0; n < 10; n++) {
      await compose(composeFrame, n / 30)
      wanted.push(elementSeekTarget(0.5 + n / 30))
    }
    expect(drawn).toEqual(wanted)
  })

  it('registers the frame callback before it seeks, and leaves none behind', async () => {
    const element = video({ presentAfterMs: PRESENT_AFTER_MS })
    const { composeFrame } = composerOver(element)
    element.calls.length = 0
    await compose(composeFrame, 0)
    expect(element.calls).toEqual(['rvfc', 'seek'])
    expect(element.pending.size).toBe(0)
  })

  it('gives up on an element whose frame callback never fires after a paused seek: the ceiling twice, then not at all', async () => {
    const element = video({ presentAfterMs: PRESENT_AFTER_MS, frameCallbacks: 'never' })
    const { composeFrame } = composerOver(element)
    element.calls.length = 0
    const elapsed: number[] = []
    for (let n = 0; n < 6; n++) elapsed.push(await compose(composeFrame, n / 30))
    for (const ms of elapsed.slice(0, MISSED_PRESENTATIONS_LIMIT)) {
      expect(ms).toBeGreaterThanOrEqual(PRESENTED_FRAME_WAIT_MS)
      expect(ms).toBeLessThanOrEqual(PRESENTED_FRAME_WAIT_MS + 1)
    }
    for (const ms of elapsed.slice(MISSED_PRESENTATIONS_LIMIT)) expect(ms).toBeLessThanOrEqual(1)
    expect(element.pending.size).toBe(0)
    expect(element.calls.filter((call) => call === 'rvfc')).toHaveLength(MISSED_PRESENTATIONS_LIMIT)
  })

  it('does not wait for, or count against the element, frames past the source’s end, which leave it where it is', async () => {
    // The clip runs past its source's end: every frame there lands on the end,
    // and Chromium presents no frame for a seek that does not move the element.
    const element = video({ presentAfterMs: PRESENT_AFTER_MS })
    element.duration = 0.6
    const { composeFrame, drawn } = composerOver(element)
    for (let n = 0; n < 4; n++) await compose(composeFrame, n / 30)
    expect(drawn[drawn.length - 1]).toBe(0.6)
    const elapsed: number[] = []
    for (let n = 4; n < 8; n++) elapsed.push(await compose(composeFrame, n / 30))
    for (const ms of elapsed) expect(ms).toBeLessThanOrEqual(1)
    expect(element.pending.size).toBe(0)
    // Back in range, the element is still waited for.
    await compose(composeFrame, 0)
    expect(drawn[drawn.length - 1]).toBe(elementSeekTarget(0.5))
  })

  it('draws at once, as before, from an element with no requestVideoFrameCallback', async () => {
    const element = video({ presentAfterMs: PRESENT_AFTER_MS, frameCallbacks: 'absent' })
    const { composeFrame } = composerOver(element)
    element.calls.length = 0
    expect(await compose(composeFrame, 0)).toBeLessThanOrEqual(1)
    expect(element.calls).toEqual(['seek'])
  })
})
