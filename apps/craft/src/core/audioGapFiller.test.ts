import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAudioGapFiller, GAP_WINDOW, MAX_GAP_FILL_SECONDS } from './audioGapFiller'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  getCreatedFrames,
} from '../test/doubles/webcodecs'

const RATE = 48000
const BUFFER = 4096
const BUFFER_SECONDS = BUFFER / RATE
const BUFFER_US = BUFFER_SECONDS * 1e6

let encoded: AudioData[]
let encode: ReturnType<typeof vi.fn<(data: AudioData) => void>>

function filler(sampleRate = RATE) {
  return createAudioGapFiller({ sampleRate, bufferLength: BUFFER, numberOfChannels: 2, label: 'Test', encode })
}

function init(data: AudioData): { numberOfFrames: number; timestamp: number; sampleRate: number } {
  return (data as unknown as { init: { numberOfFrames: number; timestamp: number; sampleRate: number } }).init
}

/**
 * Feed buffers k = 0..count-1 the way the recorder does, skipping the lost
 * ones; `playbackTime` is buffer k's position plus `delay(k)` seconds.
 * Returns the index of each delivered buffer during whose call a fill landed.
 */
function feed(
  f: ReturnType<typeof filler>,
  count: number,
  options: { lost?: (k: number) => boolean; delay?: (k: number) => number; start?: number } = {}
): number[] {
  const landed: number[] = []
  let ts = 0
  for (let k = 0; k < count; k++) {
    if (options.lost?.(k)) continue
    const before = encoded.length
    ts = f.fill((options.start ?? 10) + k * BUFFER_SECONDS + (options.delay?.(k) ?? 0), BUFFER, ts)
    if (encoded.length > before) landed.push(k)
    ts += BUFFER_US
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
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  uninstallWebCodecsDoubles()
  vi.restoreAllMocks()
})

describe('createAudioGapFiller', () => {
  it('is a no-op for an event without playbackTime', () => {
    const f = filler()
    expect(f.fill(undefined, BUFFER, 0)).toBe(0)
    expect(f.fill(undefined, BUFFER, 1234)).toBe(1234)
    expect(encode).not.toHaveBeenCalled()
  })

  it('fills nothing while every buffer arrives at its own position', () => {
    expect(feed(filler(), 200)).toEqual([])
  })

  it(`fills a lost buffer once, ${GAP_WINDOW} events after the loss, with one zero AudioData`, () => {
    const f = filler()
    let ts = 0
    let filledAt = -1
    for (let k = 0; k < 40; k++) {
      if (k === 20) continue
      const before = encoded.length
      const next = f.fill(10 + k * BUFFER_SECONDS, BUFFER, ts)
      if (encoded.length > before) {
        filledAt = k
        // Stamped where the delivered buffer would have gone, which moves on by one buffer.
        expect(init(encoded[0]).timestamp).toBe(ts)
        expect(next).toBeCloseTo(ts + BUFFER_US, 6)
      }
      ts = next + BUFFER_US
    }
    // The window has to hold eight events from after the loss before it is sure.
    expect(filledAt).toBe(20 + GAP_WINDOW)
    expect(encoded).toHaveLength(1)
    const [data] = getCreatedFrames('AudioData')
    expect(data.closed).toBe(true)
    expect((data.source as Float32Array).every(v => v === 0)).toBe(true)
    expect(data.init).toMatchObject({ format: 'f32-planar', sampleRate: RATE, numberOfChannels: 2, numberOfFrames: BUFFER })
  })

  it('fills two lost buffers as two whole buffers of silence, from one reused zero buffer', () => {
    const f = filler()
    feed(f, 60, { lost: k => k === 20 || k === 21 || k === 45 })
    expect(encoded.map(d => init(d).numberOfFrames)).toEqual([BUFFER, BUFFER, BUFFER])
    const sources = getCreatedFrames('AudioData').map(d => (d.source as Float32Array).buffer)
    expect(new Set(sources).size).toBe(1)
  })

  it('fills nothing for a callback that is late and the on-time ones after it', () => {
    expect(feed(filler(), 200, { delay: k => (k % 2 ? 0.06 : 0) })).toEqual([])
    expect(feed(filler(), 200, { delay: k => (k === 50 ? 0.08 : 0) })).toEqual([])
  })

  it('fills nothing for a burst queued behind a hang (every event the same playbackTime)', () => {
    // Buffers 20..59 came due during a 3.4 s hang and are all dispatched,
    // back to back, when it ends: each reads the end of the hang.
    const hangEnd = 10 + 60 * BUFFER_SECONDS
    expect(
      feed(filler(), 120, { delay: k => (k >= 20 && k < 60 ? hangEnd - (10 + k * BUFFER_SECONDS) : 0) })
    ).toEqual([])
  })

  it('follows a late first event down, so a later loss still reads as a whole buffer', () => {
    const f = filler()
    // The anchor comes from a callback 60 ms late; without the correction a
    // loss would read as 85 - 60 = 25 ms and never be filled.
    expect(feed(f, 60, { delay: k => (k === 0 ? 0.06 : 0), lost: k => k === 30 })).toHaveLength(1)
    expect(encoded).toHaveLength(1)
  })

  it('judges the next fill only by events from after the last one', () => {
    // Late events on both sides of a loss: the window that fills the loss
    // still holds pre-loss events, which — kept — would read as a late anchor,
    // pull it down a buffer and fill the same loss again.
    const delay = (k: number) => (k >= 15 && k < 30 ? 0.045 : 0)
    expect(feed(filler(), 80, { delay, lost: k => k === 20 })).toHaveLength(1)
  })

  it('fills nothing across a reanchor (a pause)', () => {
    const f = filler()
    feed(f, 20)
    f.reanchor()
    // 50 s later, as after a pause.
    expect(feed(f, 40, { start: 60 })).toEqual([])
    // ...and measures from the new anchor.
    expect(feed(f, 40, { start: 60 + 40 * BUFFER_SECONDS, lost: k => k === 5 })).toHaveLength(1)
  })

  it('uses the sample rate it was given', () => {
    const f = createAudioGapFiller({ sampleRate: 44100, bufferLength: BUFFER, numberOfChannels: 2, label: 'Test', encode })
    let ts = 0
    for (let k = 0; k < 30; k++) {
      if (k === 10) continue
      ts = f.fill(k * (BUFFER / 44100), BUFFER, ts) + (BUFFER / 44100) * 1e6
    }
    expect(encoded).toHaveLength(1)
    expect(init(encoded[0]).sampleRate).toBe(44100)
  })

  it(`caps one fill at ${MAX_GAP_FILL_SECONDS} s of silence, keeps the rest as a step, and warns once`, () => {
    const f = filler()
    const maxBuffers = Math.floor(MAX_GAP_FILL_SECONDS / BUFFER_SECONDS)
    // 60 s of buffers never delivered.
    const stall = Math.round(60 / BUFFER_SECONDS)
    feed(f, 100 + stall, { lost: k => k >= 50 && k < 50 + stall })
    expect(encoded).toHaveLength(maxBuffers)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain('Test')
    // A second stall is capped too, and not said again.
    const g = f
    g.reanchor()
    encoded.length = 0
    feed(g, 100 + stall, { lost: k => k >= 50 && k < 50 + stall })
    expect(encoded).toHaveLength(maxBuffers)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('closes a zero AudioData whose encode throws, and lets the error through', () => {
    encode.mockImplementation(() => {
      throw new Error('closed codec')
    })
    expect(() => feed(filler(), 40, { lost: k => k === 10 })).toThrow('closed codec')
    expect(getCreatedFrames('AudioData').every(d => d.closed)).toBe(true)
  })
})
