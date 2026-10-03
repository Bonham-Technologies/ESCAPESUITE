import { describe, it, expect } from 'vitest'
import { KEYFRAME_TIME_EPSILON } from './animation'
import { occupiedWindows, clampToLegalTime, type OccupiedWindow } from './keyframeClamp'

// The margin is private to the module; these tests recompute the edge the same
// way the module does rather than importing it, so a change to the constant
// shows up here as a failing number instead of silently moving every
// expectation with it.
const MARGIN = 1e-9
const lo = (t: number) => t - KEYFRAME_TIME_EPSILON - MARGIN
const hi = (t: number) => t + KEYFRAME_TIME_EPSILON + MARGIN

describe('occupiedWindows', () => {
  it('has no windows for no occupied times', () => {
    expect(occupiedWindows([])).toEqual([])
  })

  it('brackets one occupied time with the epsilon window plus the rounding margin', () => {
    expect(occupiedWindows([3])).toEqual([{ lo: lo(3), hi: hi(3) }])
  })

  it('returns the windows sorted ascending, whatever order the times arrive in', () => {
    expect(occupiedWindows([9, 1, 5])).toEqual([
      { lo: lo(1), hi: hi(1) },
      { lo: lo(5), hi: hi(5) },
      { lo: lo(9), hi: hi(9) },
    ])
  })

  it('merges two windows that overlap — no legal landing exists between them', () => {
    // 0.0015 s apart: less than 2x the epsilon, so the midpoint is within
    // epsilon of both and nothing can land there.
    expect(occupiedWindows([1, 1.0015])).toEqual([{ lo: lo(1), hi: hi(1.0015) }])
  })

  it('keeps two windows apart when a legal landing does exist between them', () => {
    expect(occupiedWindows([1, 1.01])).toEqual([
      { lo: lo(1), hi: hi(1) },
      { lo: lo(1.01), hi: hi(1.01) },
    ])
  })

  it('merges a run of three into one window', () => {
    expect(occupiedWindows([1, 1.0015, 1.003])).toEqual([{ lo: lo(1), hi: hi(1.003) }])
  })

  it('keeps the widest end when a merged window is swallowed by its neighbour', () => {
    // 1.0015's window ends before 1.003's does; the merge must not shorten the
    // run back to the earlier `hi`.
    const [window] = occupiedWindows([1, 1.003, 1.0015])
    expect(window.hi).toBe(hi(1.003))
  })
})

describe('clampToLegalTime', () => {
  const windows = occupiedWindows([5])

  it('leaves a time that is inside no window alone', () => {
    expect(clampToLegalTime(2, 1, windows, 0, 10)).toBe(2)
  })

  it('stops at the left edge for a pointer approaching an interior neighbour from the left', () => {
    expect(clampToLegalTime(4.9995, 4.9, windows, 0, 10)).toBe(lo(5))
  })

  it('stops at the right edge for a pointer approaching an interior neighbour from the right', () => {
    expect(clampToLegalTime(5.0005, 5.1, windows, 0, 10)).toBe(hi(5))
  })

  // Both edges are equidistant from a pointer that lands bit-exactly on the
  // neighbour, so nothing but the direction of travel can decide the side: a
  // drag from the left that aims at its neighbour must stop short of it, not
  // be thrown past it and reorder the two keyframes.
  it('lands on the LEFT edge for an exact tie approached from the left', () => {
    expect(clampToLegalTime(5, 4.5, windows, 0, 10)).toBe(lo(5))
  })

  it('lands on the RIGHT edge for an exact tie approached from the right', () => {
    expect(clampToLegalTime(5, 5.5, windows, 0, 10)).toBe(hi(5))
  })

  it('leaves a pointer that jumped clean over a neighbour where it landed', () => {
    // One move from 4 to 6: crossing a neighbour is a legitimate reorder, and
    // only the epsilon window itself is forbidden.
    expect(clampToLegalTime(6, 4, windows, 0, 10)).toBe(6)
  })

  // The previous position of a gesture is always a legal time, so "inside the
  // window" is reachable only from the keyframe being dragged itself — which
  // sits exactly `KEYFRAME_TIME_EPSILON` from its neighbour, close enough to be
  // inside the window and far enough not to be filtered out of the occupied
  // list.
  it('takes the nearer edge when the previous position was inside the window', () => {
    expect(clampToLegalTime(5.0008, 5.001, windows, 0, 10)).toBe(hi(5))
    expect(clampToLegalTime(4.9992, 4.999, windows, 0, 10)).toBe(lo(5))
  })

  it('takes the left edge when the previous position was inside the window and the two edges tie', () => {
    expect(clampToLegalTime(5, 5.0005, windows, 0, 10)).toBe(lo(5))
  })

  // The bug this replaces: the side was chosen first and the result clamped to
  // the clip's bounds afterwards, so a neighbour sitting at the clip's end —
  // which every Animate Out = fade clip has, `generateOutPresetKeyframes`
  // putting an opacity handle at exactly `clipDuration` — pushed the point
  // right, past the end, and the bounds clamp pulled it straight back onto the
  // neighbour.
  it('pushes left when the only legal edge of a neighbour at the maximum is the left one', () => {
    const atMax = occupiedWindows([10])
    expect(clampToLegalTime(10, 5, atMax, 0, 10)).toBe(lo(10))
    // …and from the clip's end itself, where the pointer sits while the mouse
    // is off the right of the track.
    expect(clampToLegalTime(10, 10, atMax, 0, 10)).toBe(lo(10))
  })

  it('pushes right when the only legal edge of a neighbour at the minimum is the right one', () => {
    const atZero = occupiedWindows([0])
    expect(clampToLegalTime(0, 2, atZero, 0, 10)).toBe(hi(0))
    expect(clampToLegalTime(0, 0, atZero, 0, 10)).toBe(hi(0))
  })

  it('stops at the merged edge on the approach side for a cluster closer than two epsilons', () => {
    const cluster = occupiedWindows([1, 1.0015])
    // Nothing between 1 and 1.0015 is legal, so a pointer aimed between them
    // comes back out the side it came in by.
    expect(clampToLegalTime(1.0007, 0.5, cluster, 0, 10)).toBe(lo(1))
    expect(clampToLegalTime(1.0007, 2, cluster, 0, 10)).toBe(hi(1.0015))
  })

  it('refuses the move when neither edge of the window is inside the bounds', () => {
    // A 0.0015 s clip with a neighbour at 0.001: the window runs from just
    // below 0 to past the clip's end, so no legal time exists at all.
    const covering = occupiedWindows([0.001])
    expect(clampToLegalTime(0.0007, 0, covering, 0, 0.0015)).toBeNull()
  })

  // The whole point of the module, swept rather than sampled: every landing it
  // hands back is inside the clip and clear of every occupied time by at least
  // one epsilon, from four different approach directions. Collected and
  // asserted once rather than per step: 5,001 pointer positions x 4 previous
  // positions is 20,004 clamps, and an `expect` per occupied time inside the
  // loop timed out at 5 s under a parallel run.
  it('keeps every landing at least one epsilon from every occupied time', () => {
    const occupied = [0, 1, 1.0015, 5, 10]
    const built = occupiedWindows(occupied)
    const violations: { time: number; previous: number; landing: number }[] = []
    let landings = 0

    for (let step = 0; step <= 5000; step += 1) {
      const time = (step / 5000) * 10
      for (const previous of [0, 1.0005, 5, 10]) {
        const landing = clampToLegalTime(time, previous, built, 0, 10)
        if (landing === null) continue
        landings += 1
        const illegal =
          landing < 0 ||
          landing > 10 ||
          occupied.some((t) => Math.abs(landing - t) < KEYFRAME_TIME_EPSILON)
        if (illegal) violations.push({ time, previous, landing })
      }
    }

    expect(violations).toEqual([])
    // …and it did hand back landings, rather than refusing everything and
    // passing the sweep by doing nothing.
    expect(landings).toBeGreaterThan(20000)
  })

  it('reads an empty window list as "every time is legal"', () => {
    const none: readonly OccupiedWindow[] = occupiedWindows([])
    expect(clampToLegalTime(5, 1, none, 0, 10)).toBe(5)
  })
})
