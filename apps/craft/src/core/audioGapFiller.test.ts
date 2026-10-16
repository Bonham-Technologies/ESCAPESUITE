import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createAudioGapFiller,
  gapWindowEvents,
  GAP_WINDOW_MIN_EVENTS,
  MAX_GAP_FILL_SECONDS,
  RENDER_QUANTUM,
} from './audioGapFiller'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  getCreatedFrames,
} from '../test/doubles/webcodecs'

const RATE = 48000
const BUFFER = 4096
const BUFFER_SECONDS = BUFFER / RATE
const QUANTUM = RENDER_QUANTUM / RATE
/** 47: four seconds of 4096-sample buffers at 48 kHz. */
const WINDOW = gapWindowEvents(RATE, BUFFER)

let encoded: AudioData[]
let encode: ReturnType<typeof vi.fn<(data: AudioData) => void>>
let currentTime: number | undefined
let readCurrentTime: ReturnType<typeof vi.fn<() => number | undefined>>

function filler(sampleRate = RATE) {
  return createAudioGapFiller({
    sampleRate,
    bufferLength: BUFFER,
    numberOfChannels: 2,
    label: 'Test',
    readCurrentTime,
    encode,
  })
}

function init(data: AudioData): { numberOfFrames: number; timestamp: number; sampleRate: number } {
  return (data as unknown as { init: { numberOfFrames: number; timestamp: number; sampleRate: number } }).init
}

const filledFrames = () => encoded.reduce((sum, d) => sum + init(d).numberOfFrames, 0)

interface Feed {
  /** Buffers never delivered. */
  lost?: (k: number) => boolean
  /** Seconds added to buffer k's reference time: lateness, or content lost before it. */
  extra?: (k: number) => number
  start?: number
  /** Hand the reference as the context's currentTime, with no playbackTime. */
  viaCurrentTime?: boolean
  sampleRate?: number
}

/**
 * Feed buffers k = 0..count-1 the way the recorder does, skipping the lost
 * ones, buffer k's reference its position plus `extra(k)`. Returns the
 * indices whose call encoded silence.
 */
function feed(f: ReturnType<typeof filler>, count: number, options: Feed = {}): number[] {
  const landed: number[] = []
  const bufferSeconds = BUFFER / (options.sampleRate ?? RATE)
  let ts = 0
  for (let k = 0; k < count; k++) {
    if (options.lost?.(k)) continue
    const reference = (options.start ?? 10) + k * bufferSeconds + (options.extra?.(k) ?? 0)
    const before = encoded.length
    if (options.viaCurrentTime) currentTime = reference
    ts = f.fill(options.viaCurrentTime ? undefined : reference, BUFFER, ts)
    if (encoded.length > before) landed.push(k)
    ts += bufferSeconds * 1e6
  }
  return landed
}

beforeEach(() => {
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  encoded = []
  encode = vi.fn((data: AudioData) => {
    encoded.push(data)
  })
  currentTime = undefined
  readCurrentTime = vi.fn(() => currentTime)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  uninstallWebCodecsDoubles()
  vi.restoreAllMocks()
})

describe('createAudioGapFiller', () => {
  it('is a no-op for an event with no playbackTime and no readable currentTime', () => {
    const f = filler()
    expect(f.fill(undefined, BUFFER, 0)).toBe(0)
    expect(f.fill(undefined, BUFFER, 1234)).toBe(1234)
    expect(readCurrentTime).toHaveBeenCalledTimes(2)
    expect(encode).not.toHaveBeenCalled()
  })

  it('prefers the event\'s playbackTime, and reads currentTime only without one', () => {
    const f = filler()
    f.fill(10, BUFFER, 0)
    expect(readCurrentTime).not.toHaveBeenCalled()
  })

  it('fills nothing while every buffer arrives at its own position', () => {
    expect(feed(filler(), 400)).toEqual([])
  })

  it('fills nothing for a constant latency from the first event: the anchor absorbs it', () => {
    expect(feed(filler(), 400, { extra: () => 0.03 })).toEqual([])
  })

  it('fills nothing for callbacks that are late and the on-time ones after them', () => {
    expect(feed(filler(), 400, { extra: k => (k % 2 ? 0.06 : 0) })).toEqual([])
    expect(feed(filler(), 400, { extra: k => (k === 100 ? 0.08 : 0) })).toEqual([])
  })

  it('leaves a rise of one quantum, and fills all but one of a rise of two', () => {
    const one = filler()
    expect(feed(one, 200, { extra: k => (k >= 60 ? QUANTUM : 0) })).toEqual([])

    const two = filler()
    let ts = 0
    let landedTs = -1
    for (let k = 0; k < 200; k++) {
      const before = encoded.length
      const next = two.fill(10 + k * BUFFER_SECONDS + (k >= 60 ? 2 * QUANTUM : 0), BUFFER, ts)
      if (encoded.length > before) {
        landedTs = ts
        // Contiguous: the delivered buffer goes after the silence.
        expect(next).toBeCloseTo(ts + QUANTUM * 1e6, 6)
      }
      ts = next + BUFFER_SECONDS * 1e6
    }
    expect(encoded).toHaveLength(1)
    expect(init(encoded[0])).toMatchObject({ numberOfFrames: RENDER_QUANTUM, timestamp: landedTs })
    const [data] = getCreatedFrames('AudioData')
    expect(data.closed).toBe(true)
    expect((data.source as Float32Array).every(v => v === 0)).toBe(true)
    expect(data.init).toMatchObject({ format: 'f32-planar', sampleRate: RATE, numberOfChannels: 2 })
  })

  it(`fills a rise a window (${WINDOW} events) after it, once the window is all past it`, () => {
    expect(feed(filler(), 200, { extra: k => (k >= 60 ? 4 * QUANTUM : 0) })).toEqual([60 + WINDOW - 1])
    expect(filledFrames()).toBe(3 * RENDER_QUANTUM)
  })

  it('fills creep one quantum at a time as it comes, never more than it', () => {
    // A quantum lost every 1.3 s for two minutes.
    const creep = (k: number) => Math.floor((k * BUFFER_SECONDS) / 1.3) * QUANTUM
    const count = Math.round(120 / BUFFER_SECONDS)
    feed(filler(), count, { extra: creep })
    const lost = creep(count - 1) * RATE
    expect(filledFrames()).toBeLessThanOrEqual(lost)
    // Everything up to a window before the end, less the quantum it leaves.
    expect(filledFrames()).toBeGreaterThanOrEqual(creep(count - 1 - WINDOW) * RATE - 2 * RENDER_QUANTUM)
  })

  it('fills a lost buffer — all but the last quantum, then that quantum with the next loss', () => {
    const f = filler()
    feed(f, 400, { lost: k => k === 100 || k === 200 })
    expect(encoded.map(d => init(d).numberOfFrames)).toEqual([BUFFER - RENDER_QUANTUM, BUFFER])
  })

  it('encodes a long fill in buffer-sized chunks from one reused zero buffer', () => {
    feed(filler(), 300, { lost: k => k >= 100 && k < 103 })
    expect(encoded.map(d => init(d).numberOfFrames)).toEqual([BUFFER, BUFFER, BUFFER - RENDER_QUANTUM])
    const buffers = getCreatedFrames('AudioData').map(d => (d.source as Float32Array).buffer)
    expect(new Set(buffers).size).toBe(1)
  })

  it('reads the context\'s currentTime when the event has no playbackTime', () => {
    feed(filler(), 300, { lost: k => k === 100, viaCurrentTime: true })
    expect(filledFrames()).toBe(BUFFER - RENDER_QUANTUM)
  })

  it('does not judge a window that is one burst queued behind a hang, however long', () => {
    // Buffers 100..199 came due during an 8.5 s hang — longer than the
    // window — and were all dispatched when it ended, each reading that time.
    const hangEnd = 10 + 200 * BUFFER_SECONDS
    expect(
      feed(filler(), 400, { extra: k => (k >= 100 && k < 200 ? hangEnd - (10 + k * BUFFER_SECONDS) : 0) })
    ).toEqual([])
  })

  it('fills nothing across a reanchor (a pause), and anchors again after it', () => {
    const f = filler()
    feed(f, 100)
    f.reanchor()
    // 50 s later, as after a pause.
    expect(feed(f, 100, { start: 60 })).toEqual([])
    expect(feed(f, 200, { start: 60 + 100 * BUFFER_SECONDS, lost: k => k === 100 })).toHaveLength(1)
  })

  it('uses the sample rate it was given', () => {
    feed(filler(44100), 300, { lost: k => k === 100, sampleRate: 44100 })
    expect(filledFrames()).toBe(BUFFER - RENDER_QUANTUM)
    expect(init(encoded[0]).sampleRate).toBe(44100)
  })

  it(`caps one fill at ${MAX_GAP_FILL_SECONDS} s of silence, keeps the rest as a step, and warns once`, () => {
    const f = filler()
    const cap = Math.floor((MAX_GAP_FILL_SECONDS * RATE) / RENDER_QUANTUM) * RENDER_QUANTUM
    // 60 s of buffers never delivered.
    const stall = Math.round(60 / BUFFER_SECONDS)
    feed(f, 200 + stall, { lost: k => k >= 100 && k < 100 + stall })
    expect(filledFrames()).toBe(cap)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain('Test')
    // A second stall is capped too, and not said again.
    f.reanchor()
    encoded.length = 0
    feed(f, 200 + stall, { lost: k => k >= 100 && k < 100 + stall })
    expect(filledFrames()).toBe(cap)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('skips a non-finite reference instead of letting it poison the anchor and the baseline', () => {
    // One NaN playbackTime before the first window fills (it would have become
    // the anchor) and one after (it would have become the baseline): a later
    // whole-buffer loss is still filled.
    const f = filler()
    feed(f, 400, {
      lost: k => k === 200,
      extra: k => (k === 20 || k === 100 ? NaN : 0),
    })
    expect(filledFrames()).toBe(BUFFER - RENDER_QUANTUM)
  })

  it('skips a non-finite currentTime as well, and still counts that buffer\'s samples', () => {
    const f = filler()
    let ts = 0
    for (let k = 0; k < 400; k++) {
      if (k === 200) continue
      currentTime = k === 100 ? Infinity : 10 + k * BUFFER_SECONDS
      ts = f.fill(undefined, BUFFER, ts) + BUFFER_SECONDS * 1e6
    }
    // Had the Infinity buffer's samples not been counted, every later deficit
    // would read a buffer high and a second buffer would be filled.
    expect(filledFrames()).toBe(BUFFER - RENDER_QUANTUM)
  })

  it('closes a zero AudioData whose encode throws, and lets the error through', () => {
    encode.mockImplementation(() => {
      throw new Error('closed codec')
    })
    expect(() => feed(filler(), 200, { lost: k => k === 60 })).toThrow('closed codec')
    expect(getCreatedFrames('AudioData').every(d => d.closed)).toBe(true)
  })
})

describe('gapWindowEvents', () => {
  it('is four seconds of buffers, and never fewer than eight', () => {
    expect(gapWindowEvents(48000, 4096)).toBe(47)
    expect(gapWindowEvents(44100, 4096)).toBe(44)
    // A buffer over half a second long: four seconds would be under eight.
    expect(gapWindowEvents(8000, 4096)).toBe(GAP_WINDOW_MIN_EVENTS)
  })
})
