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
      [120, [120, 119.88]],
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

  it('counts one dropped frame as one missing interval, so it does not halve the rate', () => {
    // Seven deltas, one of them two frames wide.
    const times = [0, 1, 2, 4, 5, 6, 7, 8].map((n) => n / 60)
    expect(rateFromMediaTimes(times)).toBe(60)
  })

  it('counts each spacing in whole multiples of the smallest one', () => {
    // Three frames, spacings 1/50 and 1/70: 1/50 is 1.4 of the smaller, which
    // rounds to one interval, so the span holds two and the rate is
    // 2 / (1/50 + 1/70) = 58.33.
    const times = [0, 1 / 50, 1 / 50 + 1 / 70]
    expect(rateFromMediaTimes(times)).toBe(58.33)
  })

  // Review round 2, F1: counting the span's intervals as round(span / median)
  // miscounts once frames are dropped. With millisecond stamps the median is a
  // rounded 8 ms against a true 8.33, and 134 / 8 rounds to 17 intervals where
  // there are 16 — 126.87, seen in a real Chromium run of a 120 fps WebM. And
  // once half the spacings or more are doubled, the median is itself a doubled
  // spacing and the rate halves. Counting each spacing on its own against the
  // smallest one keeps every rounding error inside a single interval.
  describe('dropped frames (review round 2, F1)', () => {
    const ms = (times: number[]) => times.map((t) => t / 1000)

    it('reads the real 120 fps WebM run that read 126.87 as 120 or 119.88', () => {
      // Frames 1, 5, 6, 7, 11, 12, 13 and 17 of a 120 fps file, stamped in
      // whole milliseconds: a stall of three refreshes after every third
      // presentation.
      expect([120, 119.88]).toContain(rateFromMediaTimes(ms([8, 42, 50, 58, 92, 100, 108, 142])))
    })

    it('reads 120 when three of seven spacings are doubled, not 65.45', () => {
      expect(rateFromMediaTimes([0, 1, 3, 5, 7, 8, 10, 11].map((i) => i / 120))).toBe(120)
    })

    it('reads 120 when four of seven spacings are doubled, not 60', () => {
      expect(rateFromMediaTimes([0, 2, 3, 5, 7, 9, 10, 12].map((i) => i / 120))).toBe(120)
    })

    it('reads 60 when four of seven spacings are doubled, not 30', () => {
      expect(rateFromMediaTimes([0, 2, 3, 5, 7, 9, 10, 12].map((i) => i / 60))).toBe(60)
    })

    it('reads a gap of several frames as that many intervals, from millisecond stamps', () => {
      // A ten-frame stall in a 120 fps WebM: 83 ms is 9.96 of the 8 ms
      // spacings, which still rounds to the ten it is.
      const times = [0, 1, 2, 12, 13, 14, 15, 16].map((i) => Math.round((i / 120) * 1000) / 1000)
      expect([120, 119.88]).toContain(rateFromMediaTimes(times))
    })
  })

  it('leaves a repeated presentation time out of the spacing it counts by', () => {
    // A zero spacing among three frames used to halve the median and double
    // the rate; here the one real spacing counts the span as one interval.
    expect(rateFromMediaTimes([0, 0, 1 / 30])).toBe(30)
    expect(rateFromMediaTimes([0, 1 / 30, 1 / 30, 2 / 30])).toBe(30)
  })

  it('answers nothing when the frames end no later than they start', () => {
    expect(rateFromMediaTimes([1, 0.5, 0.6])).toBeUndefined()
  })

  it('answers nothing when a presentation time goes backwards, even if the run ends later than it starts', () => {
    // 0.1 s, then back to 0.02 s: the run is out of order and its spacings
    // describe nothing.
    expect(rateFromMediaTimes([0, 0.1, 0.02])).toBeUndefined()
    expect(rateFromMediaTimes([0, 1 / 30, 2 / 30, 1.5 / 30, 3 / 30])).toBeUndefined()
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

  // Review round 2 checked 117,000 drop-free inputs and found the per-spacing
  // count identical to the median count it replaced. A seeded sample of that
  // space, so no drop-free reading can move without this going red.
  it('reads every drop-free run exactly as the median count it replaced did', () => {
    const rates = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120]
    const ntsc: Record<number, number> = { 23.976: 24000 / 1001, 29.97: 30000 / 1001, 59.94: 60000 / 1001, 119.88: 120000 / 1001 }
    const stamps = [
      (t: number) => t,
      (t: number) => Math.round(t * 1000) / 1000,
      (t: number) => Math.floor(t * 1000) / 1000,
    ]
    const random = mulberry32(276)
    for (let n = 0; n < 400; n++) {
      const rate = rates[Math.floor(random() * rates.length)]
      const fps = ntsc[rate] ?? rate
      const stamp = stamps[Math.floor(random() * stamps.length)]
      const count = 3 + Math.floor(random() * 6)
      const start = random() * 10
      const times = Array.from({ length: count }, (_, i) => stamp(start + i / fps))
      expect(rateFromMediaTimes(times), JSON.stringify(times)).toBe(medianCountRate(times))
    }
  })
})

/** A small seeded PRNG, so the sample above is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The estimator `rateFromMediaTimes` used before review round 2, F1:
 * `round(span / median of the positive spacings)` intervals over the span,
 * snapped the same way. Kept here only as the reference the drop-free sample
 * is checked against; the snap is re-derived from the module's own answer for
 * an exact run so the two cannot disagree about the table.
 */
function medianCountRate(mediaTimes: readonly number[]): number | undefined {
  if (mediaTimes.length < 3) return undefined
  const span = mediaTimes[mediaTimes.length - 1] - mediaTimes[0]
  if (!(span > 0)) return undefined
  const spacings: number[] = []
  for (let i = 1; i < mediaTimes.length; i++) {
    const spacing = mediaTimes[i] - mediaTimes[i - 1]
    if (spacing > 0) spacings.push(spacing)
  }
  spacings.sort((a, b) => a - b)
  const middle = spacings.length >> 1
  const median = spacings.length % 2 === 1 ? spacings[middle] : (spacings[middle - 1] + spacings[middle]) / 2
  const intervals = Math.round(span / median)
  if (intervals < 1) return undefined
  // The rate the old estimator measured, put through the module's own snap by
  // handing it an evenly spaced run at exactly that rate.
  const measured = intervals / span
  return rateFromMediaTimes([0, 1 / measured, 2 / measured])
}

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

  it('probes eight frames for at most 500 ms, at half speed', () => {
    expect(FRAME_RATE_PROBE).toEqual({ maxFrames: 8, maxMs: 500, playbackRate: 0.5 })
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
    await vi.advanceTimersByTimeAsync(500)
    expect(v.pause).toHaveBeenCalledTimes(1)
  })

  it('gives up at maxMs with what it has, answering nothing from two frames', async () => {
    vi.useFakeTimers()
    const v = probeVideo(spaced(1 / 60, 2))
    const pending = measureFrameRate(v.el, FRAME_RATE_PROBE)

    await vi.advanceTimersByTimeAsync(499)
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

    await vi.advanceTimersByTimeAsync(500)

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

/**
 * A `<video>` on a display that refreshes 60 times a second, closer to how a
 * browser answers `requestVideoFrameCallback`: at most once per refresh, and
 * only when the refresh shows a frame the last one did not. Between refreshes
 * media time advances at `playbackRate` times wall time, so a 120 fps file
 * played at 1x shows every other frame — 2/120 s of media per refresh — and its
 * callbacks report a 60 fps file. The doubles above answer every frame asked
 * for, which no real browser does.
 *
 * What it leaves out unless asked: by default every refresh happens on time
 * and `mediaTime` is exact. `missesRefresh(n)` makes refresh `n` (counted from
 * 1 after `play()`) present nothing while media time still advances — the jank
 * that drops frames when half speed puts a 120 fps file exactly at 60 Hz — and
 * `millisecondStamps` rounds each `mediaTime` to a whole millisecond, the way
 * a WebM stamps its frames. It still models no decode stall, no clock drift
 * between media and display, and no variation in when a refresh lands.
 *
 * Driven by fake timers: a 1 ms interval counts wall milliseconds, and a
 * refresh happens whenever the count crosses a multiple of 1000/60.
 */
function displayCappedVideo(
  fps: number,
  {
    refreshHz = 60,
    missesRefresh = () => false,
    millisecondStamps = false,
  }: { refreshHz?: number; missesRefresh?: (refresh: number) => boolean; millisecondStamps?: boolean } = {}
) {
  const el = document.createElement('video')
  let playbackRate = 1
  let playing = false
  let pending: VideoFrameRequestCallback | null = null
  let wallMs = 0
  let refreshes = 0
  let mediaPosition = 0
  let shownFrame = -1
  let clock: ReturnType<typeof setInterval> | null = null
  const ratesAtPlay: number[] = []

  const refresh = () => {
    mediaPosition += playbackRate / refreshHz
    if (missesRefresh(refreshes)) return
    const frame = Math.floor(mediaPosition * fps + 1e-9)
    if (frame === shownFrame) return
    shownFrame = frame
    if (!pending) return
    const callback = pending
    pending = null
    const mediaTime = millisecondStamps ? Math.round((frame / fps) * 1000) / 1000 : frame / fps
    callback(wallMs, { mediaTime } as VideoFrameCallbackMetadata)
  }

  const play = vi.fn(() => {
    ratesAtPlay.push(playbackRate)
    playing = true
    clock = setInterval(() => {
      wallMs += 1
      const due = Math.floor((wallMs * refreshHz) / 1000)
      while (playing && refreshes < due) {
        refreshes += 1
        refresh()
      }
    }, 1)
    return Promise.resolve()
  })
  const pause = vi.fn(() => {
    playing = false
    if (clock !== null) clearInterval(clock)
  })

  Object.defineProperty(el, 'play', { value: play, configurable: true })
  Object.defineProperty(el, 'pause', { value: pause, configurable: true })
  Object.defineProperty(el, 'playbackRate', {
    configurable: true,
    get: () => playbackRate,
    set: (rate: number) => {
      playbackRate = rate
    },
  })
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => mediaPosition,
    set: (t: number) => {
      mediaPosition = t
      shownFrame = Math.floor(t * fps + 1e-9)
    },
  })
  Object.defineProperty(el, 'requestVideoFrameCallback', {
    configurable: true,
    value: (callback: VideoFrameRequestCallback) => {
      pending = callback
      return 1
    },
  })
  Object.defineProperty(el, 'cancelVideoFrameCallback', {
    configurable: true,
    value: () => {
      pending = null
    },
  })

  return { el, play, pause, ratesAtPlay }
}

// `requestVideoFrameCallback` fires once per rendered frame, so at 1x a source
// faster than the display is measured as the display (ESCSUITE-276 review
// round 2, N1). The probe plays at half speed, at which a source up to twice
// the refresh rate — 120 fps on 60 Hz — can be sampled frame by frame; a
// refresh that misses drops a frame, and the estimator counts it as one.
describe('measureFrameRate on a 60 Hz display', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function measure(v: { el: HTMLVideoElement }) {
    const pending = measureFrameRate(v.el, FRAME_RATE_PROBE)
    await vi.advanceTimersByTimeAsync(FRAME_RATE_PROBE.maxMs)
    return pending
  }

  it('reads a 120 fps source as 120, not as the display rate', async () => {
    vi.useFakeTimers()
    const v = displayCappedVideo(120)

    await expect(measure(v)).resolves.toBe(120)
    expect(v.ratesAtPlay).toEqual([0.5])
  })

  it('reads a 120 fps WebM as 120 or 119.88 when the display drops frames', async () => {
    // Review round 2, F1: half speed puts a 120 fps file exactly at 60 Hz, with
    // no headroom, and a real run stalled three refreshes after every third
    // presentation — frames 1, 5, 6, 7, 11, 12, 13, 17, stamped in whole
    // milliseconds — which the median count read as 126.87.
    vi.useFakeTimers()
    const v = displayCappedVideo(120, { missesRefresh: (n) => (n + 4) % 6 < 3, millisecondStamps: true })

    expect([120, 119.88]).toContain(await measure(v))
    expect(v.ratesAtPlay).toEqual([0.5])
  })

  it('reads 100 fps as 100 and 90 fps as 90', async () => {
    vi.useFakeTimers()
    await expect(measure(displayCappedVideo(100))).resolves.toBe(100)
    await expect(measure(displayCappedVideo(90))).resolves.toBe(90)
  })

  it('still reads a 24 fps source as 24 inside the 500 ms budget', async () => {
    vi.useFakeTimers()
    // At half speed 500 ms of wall time is 250 ms of media: six 1/24 s
    // intervals, seven frames — the frame cap is not reached, the three-frame
    // floor is cleared with room.
    await expect(measure(displayCappedVideo(24))).resolves.toBe(24)
  })

  it('still under-reads a source more than twice the refresh rate', async () => {
    // The honest limit: at half speed a 240 fps source shows every other
    // frame on 60 Hz, exactly as 120 fps did at 1x.
    vi.useFakeTimers()
    await expect(measure(displayCappedVideo(240))).resolves.toBe(120)
  })

  it.each([
    ['the frame budget', 120, false],
    ['the deadline', 24, false],
    ['a refused play()', 120, true],
  ])('restores the playback rate it found when it finishes on %s', async (_how, fps, refuse) => {
    vi.useFakeTimers()
    const v = displayCappedVideo(fps)
    if (refuse) v.play.mockImplementationOnce(() => Promise.reject(new DOMException('no', 'NotAllowedError')))
    v.el.playbackRate = 1.25

    await measure(v)

    expect(v.el.playbackRate).toBe(1.25)
  })
})

