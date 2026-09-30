import { describe, it, expect } from 'vitest'
import {
  getAnimatedValues,
  hasAnimation,
  createDefaultAnimation,
  getAnimatedVolume,
  hasVolumeKeyframes,
  splitAnimation,
  trimAnimation,
  maxPresetDuration,
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

  // ESCSUITE-125: an out preset's duration used to reach `generateOutPresetKeyframes`
  // unclamped, so a duration longer than the clip made `startTime = clipDuration -
  // duration` negative — the clip opened mid-animation instead of at its base value.
  it('clamps an out preset longer than the clip so it does not open already animated', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'fade', duration: 0.5, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const atStart = getAnimatedValues(0, 0.4, animation, baseTransform, baseEffects)
    expect(atStart.opacity).toBe(1)
  })

  it('clamps a slide-left out preset longer than the clip to its base position at open', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0, easing: 'linear' },
      out: { type: 'slide-left', duration: 0.5, easing: 'linear' },
      keyframes: { x: [], y: [], scaleX: [], scaleY: [], rotation: [], opacity: [], blur: [] },
    }

    const atStart = getAnimatedValues(0, 0.2, animation, baseTransform, baseEffects)
    expect(atStart.x).toBe(0.5)
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

    const { first, second } = splitAnimation(animation, 5)

    expect(first.in).toEqual({ type: 'fade', duration: 1, easing: 'ease-out' })
    expect(second.in).toEqual({ type: 'none', duration: 0.5, easing: 'ease-out' })
  })

  it('gives the out-preset to the second half only, and clears it on the first', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'fade', duration: 1, easing: 'ease-in' },
      keyframes: emptyKeyframes,
    }

    const { first, second } = splitAnimation(animation, 5)

    expect(first.out).toEqual({ type: 'none', duration: 0.5, easing: 'ease-in' })
    expect(second.out).toEqual({ type: 'fade', duration: 1, easing: 'ease-in' })
  })

  it("leaves a kept preset's duration untouched, even past its own half's new length", () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 3, easing: 'ease-out' },
      out: { type: 'fade', duration: 3, easing: 'ease-in' },
      keyframes: emptyKeyframes,
    }

    // Split a 10s clip at 2s: the first half is only 2s long, shorter than
    // the in-preset's own 3s duration. Nothing else in the app clamps a
    // preset's duration to the clip it sits on (trimming a clip leaves a
    // longer preset alone), and an unclamped 3s fade-in on a 2s first half
    // still renders bit-identically to what the parent showed over those
    // same two seconds — so splitAnimation carries the duration over exactly
    // as authored rather than shortening it.
    const { first, second } = splitAnimation(animation, 2)

    expect(first.in.duration).toBe(3)
    expect(second.out.duration).toBe(3)
  })

  describe('when nothing survives past the cut', () => {
    // 0-10s clip, opacity fades 0->1 over [0,2]. Split at 5s: the fade has
    // long finished before the cut.
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

    it("keeps the first half's keyframes as-is, appending nothing", () => {
      const { first } = splitAnimation(animation, 5)

      // The last real keyframe's value (1) already holds all the way to the
      // cut, so the first half needs no synthesised boundary.
      expect(first.keyframes.opacity).toEqual([
        { time: 0, value: 0, easing: 'linear' },
        { time: 2, value: 1, easing: 'ease-in' },
      ])
    })

    it('gives the second half a single synthesised keyframe holding the last value', () => {
      const { second } = splitAnimation(animation, 5)

      // Nothing in the parent's opacity track sits at or after t=5, so the
      // second half has no real keyframe to shift — but it must still hold
      // the last value (1) from its own start, or the picture would jump to
      // the base value.
      expect(second.keyframes.opacity).toEqual([
        { time: 0, value: 1, easing: 'ease-in' }, // easing copied from the preceding parent keyframe
      ])
    })
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
    const { first, second } = splitAnimation(animation, 6)

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

  it('holds the interpolated value on both halves when the split falls before the first keyframe', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        x: [
          { time: 4, value: 0, easing: 'linear' },
          { time: 8, value: 1, easing: 'linear' },
        ],
      },
    }

    // Split at 2s, before the track's own first keyframe (at 4): `before` is
    // empty, so there is nothing for the first half to keep other than the
    // synthesised boundary itself, and the second half's prepend condition
    // (`before.length > 0`) does not fire — the shifted keyframe at 4 (now 2)
    // already supplies the value there.
    const { first, second } = splitAnimation(animation, 2)

    expect(first.keyframes.x).toEqual([
      { time: 2, value: 0, easing: 'linear' },
    ])
    expect(second.keyframes.x).toEqual([
      { time: 2, value: 0, easing: 'linear' },
      { time: 6, value: 1, easing: 'linear' },
    ])
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

    const { second } = splitAnimation(animation, 5)

    expect(second.keyframes.x).toEqual([
      { time: 0, value: 1, easing: 'ease-in' },
    ])
  })

  it('treats a keyframe within tolerance of the split exactly like one sitting exactly at it', () => {
    const makeAnimation = (nearSplitTime: number): ClipAnimation => ({
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        x: [
          { time: 0, value: 0, easing: 'linear' },
          { time: nearSplitTime, value: 1, easing: 'ease-in' },
        ],
      },
    })

    // KEYFRAME_TIME_EPSILON is 0.001, so 5 - 0.0005 is within tolerance of
    // the split at 5 and must partition, shift and synthesise exactly as if
    // the keyframe sat exactly at 5.
    expect(splitAnimation(makeAnimation(5 - 0.0005), 5)).toEqual(splitAnimation(makeAnimation(5), 5))
  })

  it('leaves a property with no keyframes out of both halves', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: { opacity: [] },
    }

    const { first, second } = splitAnimation(animation, 5)

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

    const { first, second } = splitAnimation(animation, 5)

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

describe('trimAnimation (ESCSUITE-110)', () => {
  it("clamps a kept out-preset's duration so it can never start before 0", () => {
    // A 2s fade-out survives untouched by a plain trim today, so shortening
    // the clip to 1s leaves `generateOutPresetKeyframes` computing
    // `startTime = clipDuration - duration = 1 - 2 = -1`: the clip opens
    // already part-faded, and the keyframe panel plots a negative time.
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'fade', duration: 2, easing: 'ease-in' },
      keyframes: {},
    }

    const result = trimAnimation(animation, { start: 0, end: 1 })

    expect(result.out.duration).toBe(maxPresetDuration(1))
    expect(result.out.duration).toBe(0.5)
    // The invariant the clamp exists for: an out-preset can never demand a
    // startTime before the clip's own start.
    expect(1 - result.out.duration).toBeGreaterThanOrEqual(0)
  })

  it("clamps a kept in-preset's duration the same way", () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 2, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {},
    }

    const result = trimAnimation(animation, { start: 0, end: 1 })

    expect(result.in.duration).toBe(maxPresetDuration(1))
  })

  it('leaves a preset duration that already fits the trimmed clip untouched', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.2, easing: 'ease-out' },
      out: { type: 'fade', duration: 0.2, easing: 'ease-in' },
      keyframes: {},
    }

    const result = trimAnimation(animation, { start: 0, end: 10 })

    expect(result.in.duration).toBe(0.2)
    expect(result.out.duration).toBe(0.2)
  })

  it('drops a keyframe past the new end and synthesises a boundary in its place (trim-from-the-end)', () => {
    // Same track and numbers as splitAnimation's "spans the cut" case: a 0-10s
    // clip trimmed down to 6s should treat 6 exactly like a split's first half.
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

    const result = trimAnimation(animation, { start: 0, end: 6 })

    expect(result.keyframes.x).toHaveLength(3)
    expect(result.keyframes.x?.[0]).toEqual({ time: 0, value: 0, easing: 'linear' })
    expect(result.keyframes.x?.[1]).toEqual({ time: 4, value: 0.5, easing: 'ease-in' })
    // Synthesised boundary at the new end, holding the interpolated value
    // (same 0.625 as the split test), with the easing of the keyframe it
    // stands in for (the one at 8, now dropped).
    expect(result.keyframes.x?.[2].time).toBe(6)
    expect(result.keyframes.x?.[2].value).toBeCloseTo(0.625, 5)
    expect(result.keyframes.x?.[2].easing).toBe('linear')
  })

  it('shifts keyframes back and synthesises a boundary at 0 (trim-from-the-start)', () => {
    // Cutting the first 6s off the same 0-10s clip: everything before 6 is
    // gone, the keyframe at 8 shifts to 2, and a boundary is synthesised at 0
    // holding the value the parent track had at the cut (0.625, as above)
    // with the easing of the keyframe it stands in for (the one at 4).
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

    const result = trimAnimation(animation, { start: 6, end: 10 })

    expect(result.keyframes.x).toHaveLength(2)
    expect(result.keyframes.x?.[0].time).toBe(0)
    expect(result.keyframes.x?.[0].value).toBeCloseTo(0.625, 5)
    expect(result.keyframes.x?.[0].easing).toBe('ease-in')
    expect(result.keyframes.x?.[1]).toEqual({ time: 2, value: 1, easing: 'linear' })
  })

  it('is the identity when nothing is trimmed off either end', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'fade', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        opacity: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 10, value: 1, easing: 'linear' },
        ],
      },
    }

    const result = trimAnimation(animation, { start: 0, end: 10 })

    expect(result.keyframes.opacity).toEqual(animation.keyframes.opacity)
  })

  it('leaves a property with no keyframes out of the result', () => {
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: { opacity: [] },
    }

    const result = trimAnimation(animation, { start: 0, end: 5 })

    expect(result.keyframes.opacity).toBeUndefined()
  })

  it('shares no references with the parent', () => {
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
      out: { type: 'fade', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        opacity: [{ time: 0, value: 0, easing: 'linear' }],
      },
    }

    const result = trimAnimation(animation, { start: 0, end: 5 })

    expect(result).not.toBe(animation)
    expect(result.in).not.toBe(animation.in)
    expect(result.out).not.toBe(animation.out)
    expect(result.keyframes.opacity).not.toBe(animation.keyframes.opacity)
    expect(result.keyframes.opacity?.[0]).not.toBe(animation.keyframes.opacity?.[0])
  })

  it("does not clamp a 'none' preset's duration (review round 1, NIT 2)", () => {
    // A 'none' preset's duration does nothing — generateInPresetKeyframes and
    // generateOutPresetKeyframes both bail out before reading it — so
    // clamping it would report a number the UI never used, and would lose
    // whatever the field held if the preset were switched back on later.
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 5, easing: 'ease-out' },
      out: { type: 'none', duration: 5, easing: 'ease-in' },
      keyframes: {},
    }

    const result = trimAnimation(animation, { start: 0, end: 1 })

    expect(result.in.duration).toBe(5)
    expect(result.out.duration).toBe(5)
  })

  it('interpolates the start boundary against the ORIGINAL track, not the already end-cropped one (review round 1, NIT 1)', () => {
    // A single segment [0, 10] spans BOTH cuts: trimming to { start: 3, end: 7 }
    // crops the tail first (cutEnd, synthesising a point at 7) and then the
    // front (cutStart, synthesising a point at 0 from what was originally
    // t=3). For a non-linear easing, interpolating the front boundary against
    // the tail-cropped track (segment [0,7]) re-eases the [0,3] stretch a
    // second time over the wrong span and gives a different answer than
    // interpolating the original, uncropped segment [0,10] once, directly, at
    // t=3 — which is what the clip's picture actually showed there before the
    // trim.
    const animation: ClipAnimation = {
      in: { type: 'none', duration: 0.5, easing: 'ease-out' },
      out: { type: 'none', duration: 0.5, easing: 'ease-in' },
      keyframes: {
        opacity: [
          { time: 0, value: 0, easing: 'ease-out' },
          { time: 10, value: 1, easing: 'linear' },
        ],
      },
    }

    const result = trimAnimation(animation, { start: 3, end: 7 })

    // Correct: interpolating [0,10] directly at t=3 with 'ease-out'
    // (t*(2-t)): eased(0.3) = 0.3*1.7 = 0.51.
    // The order-dependent bug this pins would instead read the re-cropped
    // segment [0,7] at t=3 (eased(3/7) applied to the tail-cropped value at
    // 7), giving roughly 0.61 — a different, wrong answer.
    expect(result.keyframes.opacity).toHaveLength(2)
    expect(result.keyframes.opacity?.[0].time).toBe(0)
    expect(result.keyframes.opacity?.[0].value).toBeCloseTo(0.51, 5)
    expect(result.keyframes.opacity?.[0].easing).toBe('ease-out')
    // The tail boundary (at the new end, now shifted to 4) is unaffected —
    // it was always computed against the original track.
    expect(result.keyframes.opacity?.[1].time).toBe(4)
    expect(result.keyframes.opacity?.[1].value).toBeCloseTo(0.91, 5)
  })
})

// ESCSUITE-139: a transition owns the entrance of its incoming clip and the
// exit of its outgoing clip, so the renderer asks for one of those sides'
// animated state with that clip's own preset dropped. Dropping it IS the
// steady state the ruling asks for, with no second interpolation path and no
// special values: every in-preset's LAST keyframe and every out-preset's FIRST
// keyframe hold the clip's own base transform/effects, so an ignored in-preset
// reads exactly as "already finished" and an ignored out-preset exactly as
// "not started yet".
describe('getAnimatedValues with a preset side suppressed (ESCSUITE-139)', () => {
  const fadeBothWays: ClipAnimation = {
    in: { type: 'fade', duration: 0.5, easing: 'linear' },
    out: { type: 'fade', duration: 0.5, easing: 'linear' },
    keyframes: {},
  }

  it('reads a suppressed in-preset as complete at the very start of the clip', () => {
    // Without the option, the same instant is the fade's own opacity 0.
    expect(getAnimatedValues(0, 2, fadeBothWays, baseTransform, baseEffects).opacity).toBe(0)

    const suppressed = getAnimatedValues(0, 2, fadeBothWays, baseTransform, baseEffects, {
      suppressPreset: 'in',
    })

    expect(suppressed.opacity).toBe(baseTransform.opacity)
  })

  it('leaves the out-preset applied while the in-preset is suppressed', () => {
    const atEnd = getAnimatedValues(2, 2, fadeBothWays, baseTransform, baseEffects, {
      suppressPreset: 'in',
    })

    expect(atEnd.opacity).toBe(0)
  })

  it('reads a suppressed out-preset as not started at the very end of the clip', () => {
    expect(getAnimatedValues(2, 2, fadeBothWays, baseTransform, baseEffects).opacity).toBe(0)

    const suppressed = getAnimatedValues(2, 2, fadeBothWays, baseTransform, baseEffects, {
      suppressPreset: 'out',
    })

    expect(suppressed.opacity).toBe(baseTransform.opacity)
  })

  it('leaves the in-preset applied while the out-preset is suppressed', () => {
    const atStart = getAnimatedValues(0, 2, fadeBothWays, baseTransform, baseEffects, {
      suppressPreset: 'out',
    })

    expect(atStart.opacity).toBe(0)
  })

  it('still applies the clip own keyframes', () => {
    // The ruling suppresses a preset, not the animation: a keyframe track the
    // user authored is what they authored, transition or no transition.
    const animation: ClipAnimation = {
      in: { type: 'fade', duration: 0.5, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {
        x: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 2, value: 0.8, easing: 'linear' },
        ],
      },
    }

    const suppressed = getAnimatedValues(1, 2, animation, baseTransform, baseEffects, {
      suppressPreset: 'in',
    })

    expect(suppressed.x).toBeCloseTo(0.4, 10)
    expect(suppressed.opacity).toBe(baseTransform.opacity)
  })

  it('suppresses every property the preset drives, not only opacity', () => {
    // `blur` is the in-preset that writes two tracks, so it is the one that
    // would expose a suppression written per property instead of per side.
    const animation: ClipAnimation = {
      in: { type: 'blur', duration: 0.5, easing: 'linear' },
      out: { type: 'none', duration: 0, easing: 'linear' },
      keyframes: {},
    }

    const plain = getAnimatedValues(0, 2, animation, baseTransform, baseEffects)
    expect(plain.blur).toBe(20)
    expect(plain.opacity).toBe(0)

    const suppressed = getAnimatedValues(0, 2, animation, baseTransform, baseEffects, {
      suppressPreset: 'in',
    })

    expect(suppressed.blur).toBe(baseEffects.blur)
    expect(suppressed.opacity).toBe(baseTransform.opacity)
  })

  it('applies both presets when the options say nothing', () => {
    // The empty-options case, so the suppression can only ever be opt-in.
    const atStart = getAnimatedValues(0, 2, fadeBothWays, baseTransform, baseEffects, {})
    const atEnd = getAnimatedValues(2, 2, fadeBothWays, baseTransform, baseEffects, {})

    expect(atStart.opacity).toBe(0)
    expect(atEnd.opacity).toBe(0)
  })
})
