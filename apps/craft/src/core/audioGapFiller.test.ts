import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAudioGapFiller, MAX_GAP_FILL_SECONDS } from './audioGapFiller'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  getCreatedFrames,
} from '../test/doubles/webcodecs'

const RATE = 48000
const BUFFER = 4096
const BUFFER_SECONDS = BUFFER / RATE

let encoded: AudioData[]
let encode: ReturnType<typeof vi.fn<(data: AudioData) => void>>

function filler(sampleRate = RATE) {
  return createAudioGapFiller({ sampleRate, bufferLength: BUFFER, numberOfChannels: 2, label: 'Test', encode })
}

function frames(data: AudioData): number {
  return (data as unknown as { init: { numberOfFrames: number } }).init.numberOfFrames
}

function stamp(data: AudioData): number {
  return (data as unknown as { init: { timestamp: number } }).init.timestamp
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

  it('takes the first buffer as given, and fills nothing between contiguous buffers', () => {
    const f = filler()
    expect(f.fill(10, BUFFER, 0)).toBe(0)
    expect(f.fill(10 + BUFFER_SECONDS, BUFFER, 85_333)).toBe(85_333)
    expect(encode).not.toHaveBeenCalled()
  })

  it('ignores a gap under half a buffer', () => {
    const f = filler()
    f.fill(10, BUFFER, 0)
    expect(f.fill(10 + BUFFER_SECONDS * 1.4, BUFFER, 500)).toBe(500)
    expect(encode).not.toHaveBeenCalled()
  })

  it('fills a lost buffer with one zero AudioData stamped where the lost one would have been', () => {
    const f = filler()
    f.fill(10, BUFFER, 0)
    const next = f.fill(10 + 2 * BUFFER_SECONDS, BUFFER, 85_000)
    expect(encode).toHaveBeenCalledTimes(1)
    expect(stamp(encoded[0])).toBe(85_000)
    expect(frames(encoded[0])).toBe(BUFFER)
    expect(next).toBeCloseTo(85_000 + BUFFER_SECONDS * 1e6, 6)
    // Encoded and closed, and silent.
    const [data] = getCreatedFrames('AudioData')
    expect(data.closed).toBe(true)
    expect((data.source as Float32Array).every(v => v === 0)).toBe(true)
    expect(data.init).toMatchObject({ format: 'f32-planar', sampleRate: RATE, numberOfChannels: 2 })
  })

  it('fills in chunks of one buffer, the last one partial, from one reused zero buffer', () => {
    const f = filler()
    f.fill(0, BUFFER, 0)
    // 2.5 buffers missing.
    const next = f.fill(3.5 * BUFFER_SECONDS, BUFFER, 0)
    expect(encoded.map(frames)).toEqual([BUFFER, BUFFER, BUFFER / 2])
    expect(next).toBeCloseTo(2.5 * BUFFER_SECONDS * 1e6, 6)
    const sources = getCreatedFrames('AudioData').map(d => (d.source as Float32Array).buffer)
    expect(new Set(sources).size).toBe(1)
    // A second gap reuses the same zeros.
    f.fill(5 * BUFFER_SECONDS, BUFFER, next)
    expect(new Set(getCreatedFrames('AudioData').map(d => (d.source as Float32Array).buffer)).size).toBe(1)
  })

  it('fills nothing across a reanchor (a pause)', () => {
    const f = filler()
    f.fill(10, BUFFER, 0)
    f.reanchor()
    expect(f.fill(60, BUFFER, 85_000)).toBe(85_000)
    expect(encode).not.toHaveBeenCalled()
    // ...and measures the next gap from the new anchor.
    f.fill(60 + 2 * BUFFER_SECONDS, BUFFER, 170_000)
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('uses the sample rate it was given', () => {
    const f = filler(44100)
    f.fill(0, BUFFER, 0)
    f.fill((2 * BUFFER) / 44100, BUFFER, 0)
    expect(encoded.map(frames)).toEqual([BUFFER])
    expect(getCreatedFrames('AudioData')[0].init).toMatchObject({ sampleRate: 44100 })
  })

  it(`caps one fill at ${MAX_GAP_FILL_SECONDS} s of silence and warns once`, () => {
    const f = filler()
    f.fill(0, BUFFER, 0)
    const next = f.fill(BUFFER_SECONDS + 60, BUFFER, 0)
    const filled = encoded.reduce((sum, d) => sum + frames(d), 0)
    expect(filled).toBe(MAX_GAP_FILL_SECONDS * RATE)
    expect(next).toBeCloseTo(MAX_GAP_FILL_SECONDS * 1e6, 3)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain('Test')
    // A second stall is capped too, and not said again.
    f.fill(2 * BUFFER_SECONDS + 120, BUFFER, next)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('closes a zero AudioData whose encode throws, and lets the error through', () => {
    encode.mockImplementation(() => {
      throw new Error('closed codec')
    })
    const f = filler()
    f.fill(0, BUFFER, 0)
    expect(() => f.fill(2 * BUFFER_SECONDS, BUFFER, 0)).toThrow('closed codec')
    expect(getCreatedFrames('AudioData').every(d => d.closed)).toBe(true)
  })
})
