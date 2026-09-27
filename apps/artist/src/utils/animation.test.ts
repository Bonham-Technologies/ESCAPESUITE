import { describe, it, expect } from 'vitest'
import {
  getAnimatedValues,
  hasAnimation,
  createDefaultAnimation,
  getAnimatedVolume,
  hasVolumeKeyframes,
  splitAnimation,
} from './animation'
import type { ClipAnimation, ClipTransform } from '../store/types'
import { baseEffects, baseTransform } from '../test/fixtures/animation'

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

describe('splitAnimation (ESCSUITE-95)', () => {
  const emptyKeyframes: ClipAnimation['keyframes'] = {}

  it('gives the in-preset to the first half only, and clears it on the second', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 1, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: emptyKeyframes,
    }

    const { first, second } = splitAnimation(animation, 5, 5, 5)

    expect(first.in).toEqual({ type: 'fade', duration: 1, easing: 'ease-out' })
    expect(second.in).toEqual({ type: 'none', duration: 0.5, easing: 'ease-out' })
  })

  it('gives the out-preset to the second half only, and clears it on the first', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'fade', duration: 1, easing: 'ease-in' },
      keyframes: emptyKeyframes,
    }

    const { first, second } = splitAnimation(animation, 5, 5, 5)

    expect(first.out).toEqual({ type: 'none', duration: 0.5, easing: 'ease-in' })
    expect(second.out).toEqual({ type: 'fade', duration: 1, easing: 'ease-in' })
  })

  it('clamps a kept preset duration to its own half duration', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 3, easing: 'ease-out' },
      out: { type: 'fade', duration: 3, easing: 'ease-in' },
      keyframes: emptyKeyframes,
    }

    // Split a 10s clip at 2s: first half is 2s long, second half 8s.
    const { first, second } = splitAnimation(animation, 2, 2, 8)

    expect(first.in.duration).toBe(2) // clamped down from 3
    expect(second.out.duration).toBe(3) // untouched, 3 <= 8
  })

  it('keeps every keyframe before the split as-is, appending nothing when none sit at or past it', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        opacity: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 2, value: 1, easing: 'ease-in' },
        ],
      },
    }

    // 0-10s clip, opacity fades 0->1 over [0,2]. Split at 5s: the fade has
    // long finished, so the first half needs no synthesised boundary — the
    // last real keyframe's value (1) already holds all the way to the cut.
    const { first } = splitAnimation(animation, 5, 5, 5)

    expect(first.keyframes.opacity).toEqual([
      { time: 0, value: 0, easing: 'linear' },
      { time: 2, value: 1, easing: 'ease-in' },
    ])
  })

  it('shifts the second half keyframes and prepends the boundary value when the split falls between two keyframes', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        opacity: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 2, value: 1, easing: 'ease-in' },
        ],
      },
    }

    const { second } = splitAnimation(animation, 5, 5, 5)

    // Nothing in the parent's opacity track sits at or after t=5, so the
    // second half has no real keyframe to shift — but it must still hold the
    // last value (1) from its own start, or the picture would jump to the
    // base value.
    expect(second.keyframes.opacity).toEqual([
      { time: 0, value: 1, easing: 'ease-in' }, // easing copied from the preceding parent keyframe
    ])
  })

  it('splits a keyframe track that spans the cut: clips before, shifts at-or-after, synthesises both boundaries', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        x: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 4, value: 0.5, easing: 'ease-in' },
          { time: 8, value: 1, easing: 'linear' },
        ],
      },
    }

    // 0-10s clip, split at 6s (between the keyframes at 4 and 8). Interpolating
    // the parent track at t=6 (halfway between 4 and 8, using kf@4's
    // 'ease-in' easing: t=0.5 eases to 0.25) gives 0.5 + 0.5 * 0.25 = 0.625.
    const { first, second } = splitAnimation(animation, 6, 6, 4)

    // First half: keyframes before 6 (at 0 and 4), plus a synthesised one at
    // 6 holding that interpolated value, using the easing of the keyframe
    // that followed it in the parent (the one at 8).
    expect(first.keyframes.x).toHaveLength(3)
    expect(first.keyframes.x?.[2].time).toBe(6)
    expect(first.keyframes.x?.[2].value).toBeCloseTo(0.625, 5)
    expect(first.keyframes.x?.[2].easing).toBe('linear')

    // Second half: only the keyframe at 8 remains (>= 6), shifted by -6 to 2.
    // No keyframe sits exactly at the split, so one is synthesised at 0
    // holding the same interpolated value, with the easing of the preceding
    // parent keyframe (the one at 4).
    expect(second.keyframes.x?.[0].time).toBe(0)
    expect(second.keyframes.x?.[0].value).toBeCloseTo(0.625, 5)
    expect(second.keyframes.x?.[0].easing).toBe('ease-in')
    expect(second.keyframes.x?.[1]).toEqual({ time: 2, value: 1, easing: 'linear' })
  })

  it('does not prepend a boundary keyframe when one already sits exactly at the split', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        x: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 5, value: 1, easing: 'ease-in' },
        ],
      },
    }

    const { second } = splitAnimation(animation, 5, 5, 5)

    expect(second.keyframes.x).toEqual([
      { time: 0, value: 1, easing: 'ease-in' },
    ])
  })

  it('leaves a property with no keyframes out of both halves', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: { opacity: [] },
    }

    const { first, second } = splitAnimation(animation, 5, 5, 5)

    expect(first.keyframes.opacity).toBeUndefined()
    expect(second.keyframes.opacity).toBeUndefined()
  })

  it('shares no references with the parent or between the two halves', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 1, easing: 'ease-out' },
      out: { type: 'fade', duration: 1, easing: 'ease-in' },
      keyframes: {
        opacity: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 2, value: 1, easing: 'ease-in' },
        ],
      },
    }

    const { first, second } = splitAnimation(animation, 5, 5, 5)

    expect(first).not.toBe(animation)
    expect(second).not.toBe(animation)
    expect(first).not.toBe(second)
    expect(first.keyframes).not.toBe(second.keyframes)
    expect(first.keyframes.opacity).not.toBe(animation.keyframes.opacity)
    expect(first.keyframes.opacity?.[0]).not.toBe(animation.keyframes.opacity?.[0])
    expect(first.in).not.toBe(animation.in)
    expect(second.out).not.toBe(animation.out)

    // Mutating one half must not affect the other or the parent.
    first.keyframes.opacity![0].value = 99
    expect(animation.keyframes.opacity![0].value).toBe(0)
    expect(second.keyframes.opacity![0].value).toBe(1)
  })
})
