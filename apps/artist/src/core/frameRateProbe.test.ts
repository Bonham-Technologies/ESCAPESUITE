import { describe, it, expect, vi, afterEach } from 'vitest'
import { FRAME_RATE_PROBE, measureFrameRate, rateFromMediaTimes } from './frameRateProbe'

/**
 * ESCSUITE-276: a source's frame rate is measured from the frames its own
 * `<video>` presents, rather than written down as a placeholder 30.
 */

/** `count` presentation times `interval` seconds apart, from `start`. */
function spaced(interval: number, count: number, start = 0): number[] {
  return Array.from({ length: count }, (_, i) => start + i * interval)
}

describe('rateFromMediaTimes', () => {
  it('reads 1/60-spaced frames as 60', () => {
    expect(rateFromMediaTimes(spaced(1 / 60, 8))).toBe(60)
  })

  it('reads 1/24-spaced frames as 24, not the NTSC rate 0.1 % away', () => {
    expect(rateFromMediaTimes(spaced(1 / 24, 8))).toBe(24)
  })

  it('reads 1/30-spaced frames as 30, not 29.97', () => {
    expect(rateFromMediaTimes(spaced(1 / 30, 8))).toBe(30)
  })

  it('snaps 1001/30000-spaced frames to 29.97', () => {
    expect(rateFromMediaTimes(spaced(1001 / 30000, 8))).toBe(29.97)
  })

  it('snaps 1001/24000-spaced frames to 23.976 and 1001/60000-spaced ones to 59.94', () => {
    expect(rateFromMediaTimes(spaced(1001 / 24000, 8))).toBe(23.976)
    expect(rateFromMediaTimes(spaced(1001 / 60000, 8))).toBe(59.94)
  })

  it('snaps a rate measured a little off a standard rate to the nearest one', () => {
    // 29.95 fps: 0.07 % from 29.97, 0.17 % from 30.
    expect(rateFromMediaTimes(spaced(1 / 29.95, 8))).toBe(29.97)
    // 50.6 fps: 1.2 % from 50, inside the 1.5 % tolerance.
    expect(rateFromMediaTimes(spaced(1 / 50.6, 8))).toBe(50)
  })

  it.each([25, 48, 50, 90, 100, 120])('reads exactly %s fps as %s', (fps) => {
    expect(rateFromMediaTimes(spaced(1 / fps, 8))).toBe(fps)
  })

  it('snaps 1001/120000-spaced frames to 119.88', () => {
    expect(rateFromMediaTimes(spaced(1001 / 120000, 8))).toBe(119.88)
  })

  it('rounds a rate more than 1.5 % from every standard rate to two decimals', () => {
    // 47.123 is 1.8 % from 48, the nearest.
    expect(rateFromMediaTimes(spaced(1 / 47.123, 8))).toBe(47.12)
  })

  // A WebM stamps every frame in whole milliseconds, so a 30 fps file presents
  // its frames 33, 34, 33… ms apart. One spacing read as a rate is 30.30 or
  // 29.41; the span over all eight frames is off by at most a millisecond.
  // A whole-number rate and its NTSC neighbour, 0.1 % apart, cannot be told
  // apart from millisecond timestamps over eight frames, so either is right.
  describe('millisecond-rounded timestamps, as a WebM carries them', () => {
    const ms = (times: number[]) => times.map((t) => Math.round(t * 1000) / 1000)

    it.each([
      [30, [30, 29.97]],
      [60, [60, 59.94]],
      [24, [24, 23.976]],
      [120, [120, 119.88]],
    ])('reads %s fps as that rate or its NTSC neighbour, from the first frame', (fps, accepted) => {
      expect(accepted).toContain(rateFromMediaTimes(ms(spaced(1 / fps, 8))))
    })

    it.each([
      [30, [30, 29.97]],
      [60, [60, 59.94]],
      [24, [24, 23.976]],
      [25, [25]],
      [50, [50]],
    ])('reads %s fps the same way from any starting point', (fps, accepted) => {
      for (let offset = 0; offset < 200; offset++) {
        expect(accepted).toContain(rateFromMediaTimes(ms(spaced(1 / fps, 8, 1 + offset * 0.00137))))
      }
    })

    it('still reads a dropped frame as one missing interval, not a slower rate', () => {
      const times = ms([0, 1, 2, 4, 5, 6, 7, 8].map((n) => n / 30))
      expect([30, 29.97]).toContain(rateFromMediaTimes(times))
    })
  })

  it('takes the median spacing, so one dropped frame does not halve the rate', () => {
    // Seven deltas, one of them two frames wide.
    const times = [0, 1, 2, 4, 5, 6, 7, 8].map((n) => n / 60)
    expect(rateFromMediaTimes(times)).toBe(60)
  })

  it('counts intervals by the mean of the middle two spacings when there is an even number of them', () => {
    // Three frames, two spacings, 1/50 and 1/70: their mean says the span holds
    // two intervals, so the rate is 2 / (1/50 + 1/70) = 58.33.
    const times = [0, 1 / 50, 1 / 50 + 1 / 70]
    expect(rateFromMediaTimes(times)).toBe(58.33)
  })

  it('leaves a repeated or reordered presentation time out of the spacing it counts by', () => {
    // A zero spacing among three frames used to halve the median and double
    // the rate; here the one real spacing counts the span as one interval.
    expect(rateFromMediaTimes([0, 0, 1 / 30])).toBe(30)
    expect(rateFromMediaTimes([0, 1 / 30, 1 / 30, 2 / 30])).toBe(30)
  })

  it('answers nothing when the frames end no later than they start', () => {
    expect(rateFromMediaTimes([1, 0.5, 0.6])).toBeUndefined()
  })

  it('answers nothing when the span is too short to hold one interval', () => {
    // One spacing of 0.1 s, and the last frame 0.02 s after the first.
    expect(rateFromMediaTimes([0, 0.1, 0.02])).toBeUndefined()
  })

  it('answers nothing from fewer than three frames', () => {
    expect(rateFromMediaTimes([])).toBeUndefined()
    expect(rateFromMediaTimes([0])).toBeUndefined()
    expect(rateFromMediaTimes([0, 1 / 60])).toBeUndefined()
  })

  it('answers nothing when the frames carry no spacing at all', () => {
    // The same media time three times over: 1 / 0 is not a rate.
    expect(rateFromMediaTimes([0.5, 0.5, 0.5])).toBeUndefined()
  })
})

interface ProbeVideo {
  el: HTMLVideoElement
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  seeks: number[]
  /** How many frame callbacks were answered. */
  delivered(): number
}

/**
 * A `<video>` whose `requestVideoFrameCallback` answers, while it is playing,
 * with the next of `frameTimes` as `mediaTime` — one per callback, a microtask
 * after it is asked for. When the list runs out it stops answering, as a
 * stalled or ended element does.
 */
function probeVideo(
  frameTimes: number[],
  { playRejects = false, rejectOnPause = false }: { playRejects?: boolean; rejectOnPause?: boolean } = {}
): ProbeVideo {
  const el = document.createElement('video')
  const pending = new Map<number, VideoFrameRequestCallback>()
  let nextHandle = 1
  let delivered = 0
  let playing = false
  const seeks: number[] = []
  let rejectPlay: ((reason: unknown) => void) | null = null

  const tick = (handle: number) => {
    queueMicrotask(() => {
      const cb = pending.get(handle)
      if (!cb || !playing || delivered >= frameTimes.length) return
      pending.delete(handle)
      const mediaTime = frameTimes[delivered++]
      cb(performance.now(), { mediaTime } as VideoFrameCallbackMetadata)
    })
  }

  const play = vi.fn(() => {
    if (playRejects) return Promise.reject(new DOMException('autoplay refused', 'NotAllowedError'))
    playing = true
    for (const handle of pending.keys()) tick(handle)
    if (rejectOnPause) {
      return new Promise<void>((_resolve, reject) => {
        rejectPlay = reject
      })
    }
    return Promise.resolve()
  })
  const pause = vi.fn(() => {
    playing = false
    rejectPlay?.(new DOMException('interrupted by pause()', 'AbortError'))
  })
  const cancel = vi.fn((handle: number) => {
    pending.delete(handle)
  })

  Object.defineProperty(el, 'play', { value: play, configurable: true })
  Object.defineProperty(el, 'pause', { value: pause, configurable: true })
  Object.defineProperty(el, 'requestVideoFrameCallback', {
    configurable: true,
    value: (cb: VideoFrameRequestCallback) => {
      const handle = nextHandle++
      pending.set(handle, cb)
      if (playing) tick(handle)
      return handle
    },
  })
  Object.defineProperty(el, 'cancelVideoFrameCallback', { value: cancel, configurable: true })
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => (seeks.length > 0 ? seeks[seeks.length - 1] : 0),
    set: (t: number) => {
      seeks.push(t)
    },
  })

  return { el, play, pause, cancel, seeks, delivered: () => delivered }
}

describe('measureFrameRate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('probes eight frames for at most 400 ms', () => {
    expect(FRAME_RATE_PROBE).toEqual({ maxFrames: 8, maxMs: 400 })
  })

  it('plays the element muted and reads 60 from 1/60-spaced frames', async () => {
    const v = probeVideo(spaced(1 / 60, 8))

    await expect(measureFrameRate(v.el, FRAME_RATE_PROBE)).resolves.toBe(60)

    expect(v.el.muted).toBe(true)
    expect(v.play).toHaveBeenCalledTimes(1)
  })

  it('starts from 0, stops after maxFrames presented frames, then pauses and seeks back to 0', async () => {
    const v = probeVideo(spaced(1 / 24, 20, 3))

    await expect(measureFrameRate(v.el, FRAME_RATE_PROBE)).resolves.toBe(24)

    expect(v.delivered()).toBe(8)
    expect(v.pause).toHaveBeenCalledTimes(1)
    expect(v.seeks).toEqual([0, 0])
    expect(v.cancel).toHaveBeenCalledTimes(1)
  })

  it('seeks to the start before it plays, wherever the element was left', async () => {
    // A headerless WebM's duration probe leaves the element at its end.
    const v = probeVideo(spaced(1 / 60, 8))
    v.el.currentTime = 12.5
    v.seeks.length = 0
    const atPlay: number[] = []
    const play = v.play.getMockImplementation() as () => Promise<void>
    v.play.mockImplementationOnce(() => {
      atPlay.push(v.el.currentTime)
      return play()
    })

    await measureFrameRate(v.el, FRAME_RATE_PROBE)

    expect(atPlay).toEqual([0])
    expect(v.seeks).toEqual([0, 0])
  })

  it('clears its deadline when the frame budget finishes first', async () => {
    vi.useFakeTimers()
    const v = probeVideo(spaced(1 / 60, 8))
    const pending = measureFrameRate(v.el, FRAME_RATE_PROBE)

    await vi.advanceTimersByTimeAsync(0)

    await expect(pending).resolves.toBe(60)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(400)
    expect(v.pause).toHaveBeenCalledTimes(1)
  })

  it('gives up at maxMs with what it has, answering nothing from two frames', async () => {
    vi.useFakeTimers()
    const v = probeVideo(spaced(1 / 60, 2))
    const pending = measureFrameRate(v.el, FRAME_RATE_PROBE)

    await vi.advanceTimersByTimeAsync(399)
    expect(v.pause).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toBeUndefined()
    expect(v.delivered()).toBe(2)
    expect(v.pause).toHaveBeenCalledTimes(1)
    expect(v.seeks).toEqual([0, 0])
  })

  it('measures from the frames it got when maxMs arrives first', async () => {
    vi.useFakeTimers()
    const v = probeVideo(spaced(1001 / 30000, 5))
    const pending = measureFrameRate(v.el, FRAME_RATE_PROBE)

    await vi.advanceTimersByTimeAsync(400)

    await expect(pending).resolves.toBe(29.97)
  })

  it('answers nothing, without playing or seeking, from an element with no requestVideoFrameCallback', async () => {
    const el = document.createElement('video')
    const play = vi.fn()
    Object.defineProperty(el, 'play', { value: play, configurable: true })
    expect('requestVideoFrameCallback' in el).toBe(false)

    await expect(measureFrameRate(el, FRAME_RATE_PROBE)).resolves.toBeUndefined()
    expect(play).not.toHaveBeenCalled()
  })

  it('answers nothing at once when the browser refuses to play, and still pauses and seeks back', async () => {
    vi.useFakeTimers()
    const v = probeVideo(spaced(1 / 60, 8), { playRejects: true })
    const pending = measureFrameRate(v.el, FRAME_RATE_PROBE)

    await vi.advanceTimersByTimeAsync(0)

    await expect(pending).resolves.toBeUndefined()
    expect(v.delivered()).toBe(0)
    expect(v.pause).toHaveBeenCalledTimes(1)
    expect(v.seeks).toEqual([0, 0])
  })

  it('finishes once when its own pause rejects the play() it is still waiting on', async () => {
    // A browser rejects a pending play() with AbortError when pause() lands
    // first — and the probe's own finish is that pause().
    const v = probeVideo(spaced(1 / 60, 8), { rejectOnPause: true })

    await expect(measureFrameRate(v.el, FRAME_RATE_PROBE)).resolves.toBe(60)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(v.pause).toHaveBeenCalledTimes(1)
    expect(v.seeks).toEqual([0, 0])
  })
})
