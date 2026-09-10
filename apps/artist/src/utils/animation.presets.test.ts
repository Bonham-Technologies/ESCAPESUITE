import { describe, it, expect } from 'vitest'
import { getAllKeyframesForProperty, getAnimatedValues } from './animation'
import type { ClipAnimation } from '../store/types'
import { baseEffects, baseTransform } from '../test/fixtures/animation'

describe('getAllKeyframesForProperty', () => {
  it('returns empty array when no animation', () => {
    const result = getAllKeyframesForProperty('opacity', 2, undefined, baseTransform, baseEffects)
    expect(result).toEqual([])
  })

  it('returns preset keyframes for opacity with fade-in', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const result = getAllKeyframesForProperty('opacity', 2, animation, baseTransform, baseEffects)
    expect(result).toHaveLength(2)
    expect(result[0].time).toBe(0)
    expect(result[0].value).toBe(0)
    expect(result[1].time).toBe(0.5)
    expect(result[1].value).toBe(1)
  })

  it('merges custom keyframes with preset keyframes', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [],
        y: [],
        scaleX: [],
        scaleY: [],
        rotation: [],
        opacity: [{ time: 1, value: 0.5, easing: 'linear' }],
        blur: [],
      },
    }

    const result = getAllKeyframesForProperty('opacity', 2, animation, baseTransform, baseEffects)
    expect(result).toHaveLength(3)
    expect(result[2].time).toBe(1)
    expect(result[2].value).toBe(0.5)
  })
})

describe('animation presets', () => {
  const withPresets = (
    inPreset: ClipAnimation['in']['type'],
    outPreset: ClipAnimation['out']['type'],
    durations: { in: number; out: number } = { in: 1, out: 1 }
  ): ClipAnimation => ({
    in: { type: inPreset, duration: durations.in, easing: 'linear' },
    out: { type: outPreset, duration: durations.out, easing: 'linear' },
    keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [], volume: [] },
  })

  const at = (time: number, animation: ClipAnimation, clipDuration = 10) =>
    getAnimatedValues(time, clipDuration, animation, baseTransform, baseEffects)

  /** Keyframes a preset generates for one property, via the public accessor. */
  const keyframesFor = (
    property: Parameters<typeof getAllKeyframesForProperty>[0],
    animation: ClipAnimation,
    clipDuration = 10
  ) => getAllKeyframesForProperty(property, clipDuration, animation, baseTransform, baseEffects)

  it('generates no keyframes for the "none" preset or a zero duration', () => {
    expect(keyframesFor('opacity', withPresets('none', 'none'))).toEqual([])
    expect(keyframesFor('opacity', withPresets('fade', 'fade', { in: 0, out: 0 }))).toEqual([])
  })

  it('fade in ramps opacity from 0 to the base value', () => {
    const animation = withPresets('fade', 'none')
    expect(at(0, animation).opacity).toBe(0)
    expect(at(0.5, animation).opacity).toBeCloseTo(0.5, 10)
    expect(at(1, animation).opacity).toBe(1)
  })

  it('fade out ramps opacity from the base value to 0 at the clip end', () => {
    const animation = withPresets('none', 'fade')
    expect(at(9, animation).opacity).toBe(1)
    expect(at(9.5, animation).opacity).toBeCloseTo(0.5, 10)
    expect(at(10, animation).opacity).toBe(0)
  })

  it.each([
    ['slide-left', 'x', 0.5 + 0.5],
    ['slide-right', 'x', 0.5 - 0.5],
    ['slide-up', 'y', 0.5 + 0.5],
    ['slide-down', 'y', 0.5 - 0.5],
  ] as const)('%s in starts %s off-frame and settles at the base value', (preset, axis, start) => {
    const animation = withPresets(preset, 'none')
    expect(at(0, animation)[axis]).toBeCloseTo(start, 10)
    expect(at(1, animation)[axis]).toBeCloseTo(0.5, 10)
  })

  it.each([
    ['slide-left', 'x', 0.5 - 0.5],
    ['slide-right', 'x', 0.5 + 0.5],
    ['slide-up', 'y', 0.5 - 0.5],
    ['slide-down', 'y', 0.5 + 0.5],
  ] as const)('%s out leaves %s off-frame at the clip end', (preset, axis, end) => {
    const animation = withPresets('none', preset)
    expect(at(9, animation)[axis]).toBeCloseTo(0.5, 10)
    expect(at(10, animation)[axis]).toBeCloseTo(end, 10)
  })

  it.each(['scale', 'scale-up'] as const)('%s in grows both axes from zero', (preset) => {
    const animation = withPresets(preset, 'none')
    expect(at(0, animation).scaleX).toBe(0)
    expect(at(0, animation).scaleY).toBe(0)
    expect(at(1, animation).scaleX).toBe(1)
    expect(at(1, animation).scaleY).toBe(1)
  })

  it('scale-down in shrinks both axes from double size', () => {
    const animation = withPresets('scale-down', 'none')
    expect(at(0, animation).scaleX).toBe(2)
    expect(at(0, animation).scaleY).toBe(2)
    expect(at(1, animation).scaleX).toBe(1)
  })

  it.each(['scale', 'scale-down'] as const)('%s out shrinks both axes to zero', (preset) => {
    const animation = withPresets('none', preset)
    expect(at(9, animation).scaleX).toBe(1)
    expect(at(10, animation).scaleX).toBe(0)
    expect(at(10, animation).scaleY).toBe(0)
  })

  it('scale-up out grows both axes to double size while fading out', () => {
    const animation = withPresets('none', 'scale-up')
    expect(at(10, animation).scaleX).toBe(2)
    expect(at(10, animation).scaleY).toBe(2)
    expect(at(10, animation).opacity).toBe(0)
  })

  it('pop in overshoots past the base scale before settling', () => {
    const animation = withPresets('pop', 'none')
    expect(at(0, animation).scaleX).toBe(0)
    expect(at(0.7, animation).scaleX).toBeCloseTo(1.1, 10)
    expect(at(0.7, animation).scaleY).toBeCloseTo(1.1, 10)
    expect(at(1, animation).scaleX).toBeCloseTo(1, 10)
  })

  it('pop out overshoots before collapsing to zero', () => {
    const animation = withPresets('none', 'pop')
    expect(at(9, animation).scaleX).toBeCloseTo(1, 10)
    expect(at(9.3, animation).scaleX).toBeCloseTo(1.1, 10)
    expect(at(10, animation).scaleX).toBe(0)
    expect(at(10, animation).scaleY).toBe(0)
  })

  it('blur in starts heavily blurred and transparent', () => {
    const animation = withPresets('blur', 'none')
    expect(at(0, animation).blur).toBe(20)
    expect(at(0, animation).opacity).toBe(0)
    expect(at(1, animation).blur).toBe(0)
    expect(at(1, animation).opacity).toBe(1)
  })

  it('blur out ends heavily blurred and transparent', () => {
    const animation = withPresets('none', 'blur')
    expect(at(9, animation).blur).toBe(0)
    expect(at(10, animation).blur).toBe(20)
    expect(at(10, animation).opacity).toBe(0)
  })

  it('applies an in and an out preset to the same clip', () => {
    const animation = withPresets('fade', 'fade')
    const keyframes = keyframesFor('opacity', animation)
    expect(keyframes.map((k) => k.time)).toEqual([0, 1, 9, 10])
    expect(at(0, animation).opacity).toBe(0)
    expect(at(5, animation).opacity).toBe(1)
    expect(at(10, animation).opacity).toBe(0)
  })
})
