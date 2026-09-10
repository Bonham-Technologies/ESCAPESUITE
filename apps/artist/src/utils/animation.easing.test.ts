import { describe, it, expect } from 'vitest'
import { ensureKeyframesSorted, interpolateKeyframes } from './animation'
import type { Keyframe } from '../store/types'

describe('interpolateKeyframes', () => {
  it('returns default value when keyframes array is empty', () => {
    expect(interpolateKeyframes([], 0.5, 100)).toBe(100)
  })

  it('returns default value when keyframes is undefined', () => {
    expect(interpolateKeyframes(undefined as unknown as Keyframe[], 0.5, 100)).toBe(100)
  })

  it('returns first keyframe value when time is before first keyframe', () => {
    const keyframes: Keyframe[] = [
      { time: 1, value: 50, easing: 'linear' },
      { time: 2, value: 100, easing: 'linear' },
    ]
    expect(interpolateKeyframes(keyframes, 0, 0)).toBe(50)
  })

  it('returns last keyframe value when time is after last keyframe', () => {
    const keyframes: Keyframe[] = [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 100, easing: 'linear' },
    ]
    expect(interpolateKeyframes(keyframes, 2, 0)).toBe(100)
  })

  it('interpolates linearly between keyframes with linear easing', () => {
    const keyframes: Keyframe[] = [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 100, easing: 'linear' },
    ]
    expect(interpolateKeyframes(keyframes, 0.5, 0)).toBe(50)
    expect(interpolateKeyframes(keyframes, 0.25, 0)).toBe(25)
    expect(interpolateKeyframes(keyframes, 0.75, 0)).toBe(75)
  })

  it('applies ease-in easing correctly', () => {
    const keyframes: Keyframe[] = [
      { time: 0, value: 0, easing: 'ease-in' },
      { time: 1, value: 100, easing: 'linear' },
    ]
    // ease-in: t * t, so at t=0.5, eased value is 0.25
    expect(interpolateKeyframes(keyframes, 0.5, 0)).toBe(25)
  })

  it('applies ease-out easing correctly', () => {
    const keyframes: Keyframe[] = [
      { time: 0, value: 0, easing: 'ease-out' },
      { time: 1, value: 100, easing: 'linear' },
    ]
    // ease-out: t * (2 - t), so at t=0.5, eased value is 0.75
    expect(interpolateKeyframes(keyframes, 0.5, 0)).toBe(75)
  })

  it('requires pre-sorted keyframes (use ensureKeyframesSorted for unsorted)', () => {
    // interpolateKeyframes now expects pre-sorted keyframes for performance
    // Use ensureKeyframesSorted to sort before interpolating
    const unsortedKeyframes: Keyframe[] = [
      { time: 2, value: 200, easing: 'linear' },
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 100, easing: 'linear' },
    ]
    const sortedKeyframes = ensureKeyframesSorted(unsortedKeyframes)
    expect(interpolateKeyframes(sortedKeyframes, 0.5, 0)).toBe(50)
    expect(interpolateKeyframes(sortedKeyframes, 1.5, 0)).toBe(150)
  })

  it('ensureKeyframesSorted sorts unsorted keyframes', () => {
    const unsorted: Keyframe[] = [
      { time: 2, value: 200, easing: 'linear' },
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 100, easing: 'linear' },
    ]
    const sorted = ensureKeyframesSorted(unsorted)
    expect(sorted[0].time).toBe(0)
    expect(sorted[1].time).toBe(1)
    expect(sorted[2].time).toBe(2)
  })

  it('ensureKeyframesSorted returns same array if already sorted', () => {
    const sorted: Keyframe[] = [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 100, easing: 'linear' },
      { time: 2, value: 200, easing: 'linear' },
    ]
    const result = ensureKeyframesSorted(sorted)
    expect(result).toBe(sorted) // Same reference, not a copy
  })

  it('handles multiple keyframe segments', () => {
    const keyframes: Keyframe[] = [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 100, easing: 'linear' },
      { time: 2, value: 50, easing: 'linear' },
    ]
    expect(interpolateKeyframes(keyframes, 0.5, 0)).toBe(50)
    expect(interpolateKeyframes(keyframes, 1.5, 0)).toBe(75)
  })
})

describe('easing curves', () => {
  /** The interpolated value at the midpoint of a 0 -> 1 ramp under `easing`. */
  const midpoint = (easing: Keyframe['easing']) =>
    interpolateKeyframes(
      [
        { time: 0, value: 0, easing },
        { time: 1, value: 1, easing: 'linear' },
      ],
      0.5,
      0
    )

  it.each([
    ['linear', 0.5],
    ['ease-in', 0.25],
    ['ease-out', 0.75],
    ['ease-in-out', 0.5],
    ['ease-in-quad', 0.25],
    ['ease-out-quad', 0.75],
    ['ease-in-out-quad', 0.5],
    ['ease-in-cubic', 0.125],
    ['ease-out-cubic', 0.875],
    ['ease-in-out-cubic', 0.5],
  ] as const)('%s reaches %f at the halfway point', (easing, expected) => {
    expect(midpoint(easing)).toBeCloseTo(expected, 10)
  })

  it.each([
    ['ease-in', 0.25, 0.0625],
    ['ease-out', 0.25, 0.4375],
    ['ease-in-out', 0.25, 0.125],
    ['ease-in-out', 0.75, 0.875],
    ['ease-in-out-quad', 0.75, 0.875],
    ['ease-in-cubic', 0.25, 0.015625],
    ['ease-out-cubic', 0.25, 0.578125],
    ['ease-in-out-cubic', 0.25, 0.0625],
    ['ease-in-out-cubic', 0.75, 0.9375],
  ] as const)('%s at t=%f is %f', (easing, t, expected) => {
    const value = interpolateKeyframes(
      [
        { time: 0, value: 0, easing },
        { time: 1, value: 1, easing: 'linear' },
      ],
      t,
      0
    )
    expect(value).toBeCloseTo(expected, 10)
  })

  it('falls back to linear for an unknown easing name', () => {
    const value = interpolateKeyframes(
      [
        { time: 0, value: 0, easing: 'bounce' as Keyframe['easing'] },
        { time: 1, value: 10, easing: 'linear' },
      ],
      0.3,
      0
    )
    expect(value).toBeCloseTo(3, 10)
  })
})

describe('ensureKeyframesSorted', () => {
  it('returns an empty or single-element array untouched', () => {
    const empty: Keyframe[] = []
    expect(ensureKeyframesSorted(empty)).toBe(empty)
    const single: Keyframe[] = [{ time: 3, value: 1, easing: 'linear' }]
    expect(ensureKeyframesSorted(single)).toBe(single)
  })
})
