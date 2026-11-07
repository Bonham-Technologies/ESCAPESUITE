// The slot rule (ESCSUITE-417): no two frames of a take share a 30 fps slot —
// and so a WebM timecode, once Mediabunny snaps them to the grid — and a run
// of collisions never pushes the video ahead of the clock.
import { describe, it, expect } from 'vitest'
import { frameSlot, newFrameTiming, stampFrame } from './frameTiming'

const FPS = 30
const SLOT_US = 1e6 / FPS

/** Stamp frames captured at these microsecond offsets; `null` for each one dropped. */
function stampAll(capturedUs: number[]) {
  const timing = newFrameTiming()
  return capturedUs.map(us => stampFrame(timing, us, FPS))
}

/** A small seeded PRNG, so a jitter run is the same run every time. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('frameSlot', () => {
  it("is Mediabunny's own rounding onto the frame-rate grid", () => {
    expect(frameSlot(0, FPS)).toBe(0)
    expect(frameSlot(16_666, FPS)).toBe(0)
    expect(frameSlot(16_667, FPS)).toBe(1)
    expect(frameSlot(1_033_333, FPS)).toBe(31)
    // Distinct slots are distinct millisecond timecodes.
    const ms = Array.from({ length: 3000 }, (_, slot) => Math.round((1000 * slot) / FPS))
    expect(new Set(ms).size).toBe(ms.length)
  })
})

describe('stampFrame', () => {
  it('keeps the capture time of a frame whose slot is free', () => {
    expect(stampAll([0, 33_333, 70_000, 140_000])).toEqual([
      { timestamp: 0, keyFrame: true },
      { timestamp: 33_333, keyFrame: false },
      { timestamp: 70_000, keyFrame: false },
      { timestamp: 140_000, keyFrame: false },
    ])
  })

  it('moves a frame captured in the slot of the frame before it to the next slot', () => {
    // 50 ms and 77 ms are both slot 2.
    expect(stampAll([0, 50_000, 77_000]).map(s => s?.timestamp)).toEqual([0, 50_000, 100_000])
  })

  it("gives a key frame captured in its delta's slot a slot of its own", () => {
    // The ESCSUITE-412 take: a delta at 2.020 s and the key frame at 2.040 s,
    // both slot 61, which Mediabunny wrote as two blocks at 2033 ms.
    const timing = newFrameTiming()
    stampFrame(timing, 0, FPS)
    timing.nextKeyFrameUs = 2_030_000
    const delta = stampFrame(timing, 2_020_000, FPS)!
    const key = stampFrame(timing, 2_040_000, FPS)!
    expect(delta).toEqual({ timestamp: 2_020_000, keyFrame: false })
    expect(key).toEqual({ timestamp: 2_066_667, keyFrame: true })
    expect(frameSlot(key.timestamp, FPS)).toBe(frameSlot(delta.timestamp, FPS) + 1)
  })

  it('drops a frame whose own slot is behind the last one used, rather than stacking it', () => {
    // A frozen clock: the second frame takes the next slot, the third has none
    // within one of its own and is dropped.
    expect(stampAll([0, 0, 0])).toEqual([{ timestamp: 0, keyFrame: true }, { timestamp: 33_333, keyFrame: false }, null])
  })

  it('drops frames while a clock pulled back is behind the video, and resumes once it is past', () => {
    // An audio-context refresh pulls the clock back 200 ms after 1.0 s.
    const stamps = stampAll([0, 500_000, 1_000_000, 800_000, 900_000, 1_000_000, 1_050_000])
    expect(stamps.map(s => s?.timestamp ?? null)).toEqual([0, 500_000, 1_000_000, null, null, 1_033_333, 1_050_000])
    expect(stamps.map(s => s && frameSlot(s.timestamp, FPS))).toEqual([0, 15, 30, null, null, 31, 32])
  })

  it('never stamps below zero', () => {
    expect(stampAll([-3_000, 40_000])).toEqual([
      { timestamp: 0, keyFrame: true },
      { timestamp: 40_000, keyFrame: false },
    ])
  })

  it('still keys the first frame at or past each elapsed second', () => {
    const capturedUs = Array.from({ length: 91 }, (_, k) => Math.round(k * SLOT_US))
    const keys = stampAll(capturedUs).flatMap((s, k) => (s?.keyFrame ? [k] : []))
    expect(keys).toEqual([0, 30, 60, 90])
  })

  for (const fps of [24, 29, 31, 36, 45, 60, 120]) {
    it(`gives every frame a slot of its own and builds no lead, under jitter at ${fps} fps`, () => {
      const random = mulberry32(fps)
      const timing = newFrameTiming()
      const stamped: Array<{ capturedUs: number; timestamp: number }> = []
      let capturedUs = 0
      let kept = 0
      while (capturedUs < 60e6) {
        const stamp = stampFrame(timing, capturedUs, FPS)
        if (stamp) {
          stamped.push({ capturedUs, timestamp: stamp.timestamp })
          kept++
        }
        // Up to ±60% of an interval of jitter, never backwards.
        capturedUs += Math.max(0, Math.round((1e6 / fps) * (1 + (random() - 0.5) * 1.2)))
      }

      for (let i = 1; i < stamped.length; i++) {
        expect(frameSlot(stamped[i].timestamp, FPS)).toBeGreaterThan(frameSlot(stamped[i - 1].timestamp, FPS))
      }
      for (const { capturedUs: at, timestamp } of stamped) {
        expect(timestamp).toBeGreaterThanOrEqual(at)
        expect(frameSlot(timestamp, FPS) - frameSlot(at, FPS)).toBeLessThanOrEqual(1)
      }
      // Never more than one a slot over the minute.
      expect(kept).toBeLessThanOrEqual(60 * FPS + 2)
    })
  }
})
