import { describe, it, expect, beforeEach } from 'vitest'
import {
  interpolateKeyframes,
  ensureKeyframesSorted,
  getAnimatedValues,
  getAnimatedValuesCached,
  clearAnimationCache,
  hasAnimation,
  getAllKeyframesForProperty,
  createDefaultAnimation,
  getAnimatedVolume,
  hasVolumeKeyframes,
} from './animation'
import type { Keyframe, ClipAnimation, ClipTransform, ClipEffects } from '../store/types'

// Test fixtures
const baseTransform: ClipTransform = {
  x: 0.5,
  y: 0.5,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
}

const baseEffects: ClipEffects = {
  blur: 0,
}

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

describe('getAnimatedValues', () => {
  it('returns base values when animation is undefined', () => {
    const result = getAnimatedValues(0.5, 2, undefined, baseTransform, baseEffects)

    expect(result.x).toBe(0.5)
    expect(result.y).toBe(0.5)
    expect(result.scaleX).toBe(1)
    expect(result.scaleY).toBe(1)
    expect(result.rotation).toBe(0)
    expect(result.opacity).toBe(1)
    expect(result.blur).toBe(0)
  })

  it('applies fade-in animation at start of clip', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const atStart = getAnimatedValues(0, 2, animation, baseTransform, baseEffects)
    expect(atStart.opacity).toBe(0)

    const atMiddle = getAnimatedValues(0.25, 2, animation, baseTransform, baseEffects)
    expect(atMiddle.opacity).toBe(0.5)

    const afterFade = getAnimatedValues(0.5, 2, animation, baseTransform, baseEffects)
    expect(afterFade.opacity).toBe(1)
  })

  it('applies fade-out animation at end of clip', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'fade', duration: 0.5, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const beforeFade = getAnimatedValues(1.4, 2, animation, baseTransform, baseEffects)
    expect(beforeFade.opacity).toBe(1)

    const atFadeStart = getAnimatedValues(1.5, 2, animation, baseTransform, baseEffects)
    expect(atFadeStart.opacity).toBe(1)

    const atEnd = getAnimatedValues(2, 2, animation, baseTransform, baseEffects)
    expect(atEnd.opacity).toBe(0)
  })

  it('applies scale-up animation', () => {
    const animation: ClipAnimation = {
      in: { type: 'scale-up', duration: 1, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const atStart = getAnimatedValues(0, 2, animation, baseTransform, baseEffects)
    expect(atStart.scaleX).toBe(0)
    expect(atStart.scaleY).toBe(0)

    const atEnd = getAnimatedValues(1, 2, animation, baseTransform, baseEffects)
    expect(atEnd.scaleX).toBe(1)
    expect(atEnd.scaleY).toBe(1)
  })

  it('applies custom keyframes that override presets', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 1, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [],
        y: [],
        scaleX: [],
        scaleY: [],
        rotation: [],
        opacity: [
          { time: 0, value: 0.5, easing: 'linear' }, // Override fade-in start
          { time: 1, value: 0.5, easing: 'linear' }, // Keep at 0.5
        ],
        blur: [],
      },
    }

    const atStart = getAnimatedValues(0, 2, animation, baseTransform, baseEffects)
    expect(atStart.opacity).toBe(0.5)

    const atMiddle = getAnimatedValues(0.5, 2, animation, baseTransform, baseEffects)
    expect(atMiddle.opacity).toBe(0.5)
  })

  it('combines in and out animations', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'linear' },
      out: { type: 'fade', duration: 0.5, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const atStart = getAnimatedValues(0, 2, animation, baseTransform, baseEffects)
    expect(atStart.opacity).toBe(0)

    const inMiddle = getAnimatedValues(1, 2, animation, baseTransform, baseEffects)
    expect(inMiddle.opacity).toBe(1)

    const atEnd = getAnimatedValues(2, 2, animation, baseTransform, baseEffects)
    expect(atEnd.opacity).toBe(0)
  })
})

describe('hasAnimation', () => {
  it('returns false for undefined animation', () => {
    expect(hasAnimation(undefined)).toBe(false)
  })

  it('returns false when no presets or keyframes', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }
    expect(hasAnimation(animation)).toBe(false)
  })

  it('returns true when in preset is set', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }
    expect(hasAnimation(animation)).toBe(true)
  })

  it('returns true when out preset is set', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'scale', duration: 0.5, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }
    expect(hasAnimation(animation)).toBe(true)
  })

  it('returns true when custom keyframes exist', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [{ time: 0, value: 0, easing: 'linear' }],
        y: [],
        scaleX: [],
        scaleY: [],
        rotation: [],
        opacity: [],
        blur: [],
      },
    }
    expect(hasAnimation(animation)).toBe(true)
  })

  it('returns false when preset has zero duration', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }
    expect(hasAnimation(animation)).toBe(false)
  })
})

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

describe('createDefaultAnimation', () => {
  it('creates a valid animation object', () => {
    const animation = createDefaultAnimation()

    expect(animation.in.type).toBe('none')
    expect(animation.in.duration).toBe(0.5) // Default duration even when type is 'none'
    expect(animation.out.type).toBe('none')
    expect(animation.out.duration).toBe(0.5)
    expect(animation.keyframes).toBeDefined()
  })

  it('creates independent copies', () => {
    const anim1 = createDefaultAnimation()
    const anim2 = createDefaultAnimation()

    anim1.in.type = 'fade'
    expect(anim2.in.type).toBe('none')
  })
})

describe('getAnimatedValues with overlay transforms', () => {
  // Simulates overlay base transform (e.g., from textData.x, textData.y)
  const overlayBaseTransform: ClipTransform = {
    x: 0.25, // Overlay positioned at 25% from left
    y: 0.75, // Overlay positioned at 75% from top
    scaleX: 1.5,
    scaleY: 1.5,
    rotation: 45,
    opacity: 1,
  }

  it('uses overlay base transform values when no keyframes', () => {
    const result = getAnimatedValues(0.5, 2, undefined, overlayBaseTransform, baseEffects)

    expect(result.x).toBe(0.25)
    expect(result.y).toBe(0.75)
    expect(result.scaleX).toBe(1.5)
    expect(result.scaleY).toBe(1.5)
    expect(result.rotation).toBe(45)
  })

  it('interpolates position keyframes for overlay movement', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [
          { time: 0, value: 0.25, easing: 'linear' },
          { time: 2, value: 0.75, easing: 'linear' },
        ],
        y: [
          { time: 0, value: 0.75, easing: 'linear' },
          { time: 2, value: 0.25, easing: 'linear' },
        ],
        scaleX: [],
        scaleY: [],
        rotation: [],
        opacity: [],
        blur: [],
      },
    }

    const atStart = getAnimatedValues(0, 2, animation, overlayBaseTransform, baseEffects)
    expect(atStart.x).toBe(0.25)
    expect(atStart.y).toBe(0.75)

    const atMiddle = getAnimatedValues(1, 2, animation, overlayBaseTransform, baseEffects)
    expect(atMiddle.x).toBe(0.5)
    expect(atMiddle.y).toBe(0.5)

    const atEnd = getAnimatedValues(2, 2, animation, overlayBaseTransform, baseEffects)
    expect(atEnd.x).toBe(0.75)
    expect(atEnd.y).toBe(0.25)
  })

  it('interpolates scale keyframes for overlay resizing', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [],
        y: [],
        scaleX: [
          { time: 0, value: 1, easing: 'linear' },
          { time: 1, value: 2, easing: 'linear' },
        ],
        scaleY: [
          { time: 0, value: 1, easing: 'linear' },
          { time: 1, value: 2, easing: 'linear' },
        ],
        rotation: [],
        opacity: [],
        blur: [],
      },
    }

    const atStart = getAnimatedValues(0, 2, animation, overlayBaseTransform, baseEffects)
    expect(atStart.scaleX).toBe(1)
    expect(atStart.scaleY).toBe(1)

    const atMiddle = getAnimatedValues(0.5, 2, animation, overlayBaseTransform, baseEffects)
    expect(atMiddle.scaleX).toBe(1.5)
    expect(atMiddle.scaleY).toBe(1.5)

    const atEnd = getAnimatedValues(1, 2, animation, overlayBaseTransform, baseEffects)
    expect(atEnd.scaleX).toBe(2)
    expect(atEnd.scaleY).toBe(2)
  })

  it('interpolates rotation keyframes for overlay rotation', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [],
        y: [],
        scaleX: [],
        scaleY: [],
        rotation: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 90, easing: 'linear' },
        ],
        opacity: [],
        blur: [],
      },
    }

    const atStart = getAnimatedValues(0, 2, animation, overlayBaseTransform, baseEffects)
    expect(atStart.rotation).toBe(0)

    const atMiddle = getAnimatedValues(0.5, 2, animation, overlayBaseTransform, baseEffects)
    expect(atMiddle.rotation).toBe(45)

    const atEnd = getAnimatedValues(1, 2, animation, overlayBaseTransform, baseEffects)
    expect(atEnd.rotation).toBe(90)
  })

  it('combines multiple animated properties simultaneously', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [
          { time: 0, value: 0.1, easing: 'linear' },
          { time: 1, value: 0.9, easing: 'linear' },
        ],
        y: [
          { time: 0, value: 0.1, easing: 'linear' },
          { time: 1, value: 0.9, easing: 'linear' },
        ],
        scaleX: [
          { time: 0, value: 0.5, easing: 'linear' },
          { time: 1, value: 1.5, easing: 'linear' },
        ],
        scaleY: [
          { time: 0, value: 0.5, easing: 'linear' },
          { time: 1, value: 1.5, easing: 'linear' },
        ],
        rotation: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 180, easing: 'linear' },
        ],
        opacity: [
          { time: 0, value: 0.2, easing: 'linear' },
          { time: 1, value: 1, easing: 'linear' },
        ],
        blur: [],
      },
    }

    const atMiddle = getAnimatedValues(0.5, 1, animation, overlayBaseTransform, baseEffects)
    expect(atMiddle.x).toBe(0.5)
    expect(atMiddle.y).toBe(0.5)
    expect(atMiddle.scaleX).toBe(1)
    expect(atMiddle.scaleY).toBe(1)
    expect(atMiddle.rotation).toBe(90)
    expect(atMiddle.opacity).toBeCloseTo(0.6)
  })
})

describe('getAnimatedValuesCached', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAnimationCache()
  })

  it('returns same result as getAnimatedValues', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const cached = getAnimatedValuesCached('test-clip-1:0.25', 0.25, 1, animation, baseTransform, baseEffects)
    const direct = getAnimatedValues(0.25, 1, animation, baseTransform, baseEffects)

    expect(cached.x).toBe(direct.x)
    expect(cached.y).toBe(direct.y)
    expect(cached.scaleX).toBe(direct.scaleX)
    expect(cached.scaleY).toBe(direct.scaleY)
    expect(cached.rotation).toBe(direct.rotation)
    expect(cached.opacity).toBe(direct.opacity)
    expect(cached.blur).toBe(direct.blur)
  })

  it('returns cached value on second call with same key', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const first = getAnimatedValuesCached('test-clip-2:0.5', 0.5, 1, animation, baseTransform, baseEffects)
    const second = getAnimatedValuesCached('test-clip-2:0.5', 0.5, 1, animation, baseTransform, baseEffects)

    // Should be exact same object reference (cached)
    expect(first).toBe(second)
  })

  it('returns different values for different cache keys', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const atStart = getAnimatedValuesCached('test-clip-3:0', 0, 1, animation, baseTransform, baseEffects)
    const atEnd = getAnimatedValuesCached('test-clip-3:1', 1, 1, animation, baseTransform, baseEffects)

    // Should have different opacity values (fade-in animation)
    expect(atStart.opacity).not.toBe(atEnd.opacity)
  })

  it('handles undefined animation', () => {
    const result = getAnimatedValuesCached('test-clip-4:0', 0, 1, undefined, baseTransform, baseEffects)

    expect(result.x).toBe(baseTransform.x)
    expect(result.y).toBe(baseTransform.y)
    expect(result.opacity).toBe(baseTransform.opacity)
  })
})

describe('clearAnimationCache', () => {
  it('clears cached values', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    // Cache a value
    const first = getAnimatedValuesCached('clear-test:0.5', 0.5, 1, animation, baseTransform, baseEffects)

    // Clear cache
    clearAnimationCache()

    // Get value again - should be a new object (not same reference)
    const second = getAnimatedValuesCached('clear-test:0.5', 0.5, 1, animation, baseTransform, baseEffects)

    // Values should be equal but not same reference
    expect(first).not.toBe(second)
    expect(first.opacity).toBe(second.opacity)
  })
})

describe('volume keyframes', () => {
  describe('getAnimatedVolume', () => {
    it('returns base volume when no animation', () => {
      expect(getAnimatedVolume(0.5, undefined, 1)).toBe(1)
      expect(getAnimatedVolume(0.5, undefined, 0.5)).toBe(0.5)
    })

    it('returns base volume when no volume keyframes', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
      }
      expect(getAnimatedVolume(0.5, animation, 1)).toBe(1)
    })

    it('interpolates volume keyframes linearly', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 1, value: 1, easing: 'linear' },
          ],
        },
      }

      expect(getAnimatedVolume(0, animation, 1)).toBe(0)
      expect(getAnimatedVolume(0.5, animation, 1)).toBe(0.5)
      expect(getAnimatedVolume(1, animation, 1)).toBe(1)
    })

    it('supports ease-in easing for fade in effect', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 0, easing: 'ease-in' },
            { time: 1, value: 1, easing: 'linear' },
          ],
        },
      }

      // With ease-in, volume should be less than linear at midpoint
      const midVolume = getAnimatedVolume(0.5, animation, 1)
      expect(midVolume).toBeLessThan(0.5)
      expect(midVolume).toBeGreaterThan(0)
    })

    it('supports ease-out easing for fade out effect', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 1, easing: 'ease-out' },
            { time: 1, value: 0, easing: 'linear' },
          ],
        },
      }

      // With ease-out going from 1 to 0, volume drops fast initially then slows
      // At midpoint (t=0.5), ease-out gives t' = 0.75, so value = 1 + (0-1)*0.75 = 0.25
      const midVolume = getAnimatedVolume(0.5, animation, 1)
      expect(midVolume).toBeLessThan(0.5) // Faster drop means lower value at midpoint
      expect(midVolume).toBeGreaterThan(0)
    })

    it('handles multiple volume keyframes for complex envelopes', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 0, easing: 'linear' },     // Start silent
            { time: 0.5, value: 1, easing: 'linear' },   // Fade in to full
            { time: 1.5, value: 1, easing: 'linear' },   // Stay at full
            { time: 2, value: 0, easing: 'linear' },     // Fade out
          ],
        },
      }

      expect(getAnimatedVolume(0, animation, 1)).toBe(0)
      expect(getAnimatedVolume(0.25, animation, 1)).toBe(0.5)
      expect(getAnimatedVolume(0.5, animation, 1)).toBe(1)
      expect(getAnimatedVolume(1, animation, 1)).toBe(1)
      expect(getAnimatedVolume(1.75, animation, 1)).toBe(0.5)
      expect(getAnimatedVolume(2, animation, 1)).toBe(0)
    })
  })

  describe('hasVolumeKeyframes', () => {
    it('returns false when no animation', () => {
      expect(hasVolumeKeyframes(undefined)).toBe(false)
    })

    it('returns false when no volume keyframes', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
      }
      expect(hasVolumeKeyframes(animation)).toBe(false)
    })

    it('returns true when volume keyframes exist', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 1, easing: 'linear' },
            { time: 1, value: 0.5, easing: 'linear' },
          ],
        },
      }
      expect(hasVolumeKeyframes(animation)).toBe(true)
    })
  })

  describe('getAnimatedValues includes volume', () => {
    it('returns default volume of 1 when no keyframes', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
      }
      const result = getAnimatedValues(0.5, 1, animation, baseTransform, baseEffects)
      expect(result.volume).toBe(1)
    })

    it('interpolates volume keyframes', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 1, value: 1, easing: 'linear' },
          ],
        },
      }

      const atStart = getAnimatedValues(0, 1, animation, baseTransform, baseEffects)
      expect(atStart.volume).toBe(0)

      const atMid = getAnimatedValues(0.5, 1, animation, baseTransform, baseEffects)
      expect(atMid.volume).toBe(0.5)

      const atEnd = getAnimatedValues(1, 1, animation, baseTransform, baseEffects)
      expect(atEnd.volume).toBe(1)
    })
  })

  describe('hasAnimation includes volume keyframes', () => {
    it('returns true when only volume keyframes exist', () => {
      const animation: ClipAnimation = {
        in: { type: 'none', duration: 0, easing: 'linear' },
        out: { type: 'none', duration: 0, easing: 'linear' },
        keyframes: {
          x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
          volume: [
            { time: 0, value: 1, easing: 'linear' },
            { time: 1, value: 0, easing: 'linear' },
          ],
        },
      }
      expect(hasAnimation(animation)).toBe(true)
    })
  })
})

// ============================================
// Easing curves
// ============================================

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

// ============================================
// Animation presets
// ============================================

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

describe('animation cache eviction', () => {
  beforeEach(() => {
    clearAnimationCache()
  })

  it('drops the whole cache once it is full, then repopulates', () => {
    const compute = (key: string) =>
      getAnimatedValuesCached(key, 0, 10, undefined, baseTransform, baseEffects)

    for (let i = 0; i < 10000; i++) compute(`clip:${i}`)

    // The 10 000th entry filled the cache; the next insert clears it first, so
    // the earliest key is no longer served from cache — it is recomputed.
    const before = compute('clip:0')
    const after = compute('clip:10000')
    const recomputed = compute('clip:0')

    expect(after).toEqual(before)
    // A cache hit returns the very same object; a recompute returns a new one.
    expect(recomputed).not.toBe(before)
    expect(recomputed).toEqual(before)
  })
})

describe('getAnimatedVolume edge cases', () => {
  it('falls back to the base volume when interpolation overflows to infinity', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [],
        volume: [
          { time: 0, value: -Number.MAX_VALUE, easing: 'linear' },
          { time: 2, value: Number.MAX_VALUE, easing: 'linear' },
        ],
      },
    }

    expect(getAnimatedVolume(1, animation, 0.75)).toBe(0.75)
  })
})
