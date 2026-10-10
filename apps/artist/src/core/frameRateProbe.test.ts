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

  it('snaps a rate measured a little off an NTSC rate, within 0.6 % of it and nearer it than the whole number', () => {
    // 29.95 fps: 0.07 % from 29.97, 0.17 % from 30.
    expect(rateFromMediaTimes(spaced(1 / 29.95, 8))).toBe(29.97)
  })

  it('rounds any other rate to two decimals', () => {
    expect(rateFromMediaTimes(spaced(1 / 120, 8))).toBe(120)
    expect(rateFromMediaTimes(spaced(1 / 47.123, 8))).toBe(47.12)
  })

  it('takes the median spacing, so one dropped frame does not halve the rate', () => {
    // Seven deltas, one of them two frames wide.
    const times = [0, 1, 2, 4, 5, 6, 7, 8].map((n) => n / 60)
    expect(rateFromMediaTimes(times)).toBe(60)
  })

  it('takes the mean of the middle two spacings when there is an even number of them', () => {
    // Three frames, two deltas: 1/50 and 1/70; the mean spacing is 1/58.33….
    const times = [0, 1 / 50, 1 / 50 + 1 / 70]
    expect(rateFromMediaTimes(times)).toBe(58.33)
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

  it('stops after maxFrames presented frames, then pauses and seeks back to 0', async () => {
    const v = probeVideo(spaced(1 / 24, 20, 3))

    await expect(measureFrameRate(v.el, FRAME_RATE_PROBE)).resolves.toBe(24)

    expect(v.delivered()).toBe(8)
    expect(v.pause).toHaveBeenCalledTimes(1)
    expect(v.seeks).toEqual([0])
    expect(v.cancel).toHaveBeenCalledTimes(1)
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
    expect(v.seeks).toEqual([0])
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
    expect(v.seeks).toEqual([0])
  })

  it('finishes once when its own pause rejects the play() it is still waiting on', async () => {
    // A browser rejects a pending play() with AbortError when pause() lands
    // first — and the probe's own finish is that pause().
    const v = probeVideo(spaced(1 / 60, 8), { rejectOnPause: true })

    await expect(measureFrameRate(v.el, FRAME_RATE_PROBE)).resolves.toBe(60)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(v.pause).toHaveBeenCalledTimes(1)
    expect(v.seeks).toEqual([0])
  })
})
