// The measurements a pointer gesture takes, with no pointer in sight.
//
// `dragGeometry` is pure — canvas, clips and a time in, numbers out — so it is
// exercised directly here rather than through the hook that calls it. The
// canvas double stands in for the 2D context jsdom does not implement, and
// reports every string as 100px wide from measureText().
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clipsIntersectingMarquee, measureDragStart, textClipAtPoint } from './dragGeometry'
import {
  makeAnimation,
  makeClip,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
  makeTrack,
  makeTransitionInfo,
} from '../../test/fixtures/clipFixtures'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import type { AnimationPresetType, Clip } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

beforeEach(() => {
  installCanvasDouble()
})

afterEach(() => {
  uninstallCanvasDouble()
})

/**
 * A canvas at the project resolution, laid out at exactly half that size, so
 * canvas pixels are client pixels doubled and nothing is letterboxed.
 * `withContext: false` leaves getContext() uncalled for failNextGetContext().
 */
function makeCanvas({ withContext = true }: { withContext?: boolean } = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  setRect(canvas, { left: 0, top: 0, width: CANVAS_W / 2, height: CANVAS_H / 2 })
  if (withContext) canvas.getContext('2d')
  return canvas
}

const shapeClip = (overrides: Partial<Clip> = {}): Clip =>
  makeClip({
    id: 'shape1',
    sourceVideoId: '',
    overlayType: 'shape',
    shapeData: makeShapeData(),
    ...overrides,
  })

/** A marquee swept across the whole canvas, in the element's own CSS pixels. */
const WHOLE_CANVAS = {
  start: { x: 0, y: 0 },
  current: { x: CANVAS_W / 2, y: CANVAS_H / 2 },
}

const textClip = (data = {}): Clip =>
  makeClip({
    id: 'text1',
    sourceVideoId: '',
    overlayType: 'text',
    textData: makeTextData(data),
  })

describe('measureDragStart', () => {
  it('leaves the context’s font as it found it', () => {
    // The context belongs to the preview, which draws through it on the very
    // next frame: a measurement must not leave its own font behind.
    const canvas = makeCanvas()
    const ctx = getCanvasContext(canvas)!
    ctx.font = '12px Courier'

    measureDragStart(textClip({ fontSize: 40, fontFamily: 'Georgia' }), 'text', canvas, 0, true, [])

    expect(ctx.font).toBe('12px Courier')
  })

  it('falls back to the text’s own scale when the canvas has no 2D context', () => {
    // getOverlayBounds needs the context to measure with; the scale the drag
    // starts from is worked out from a second measurement, and a context that
    // has gone by then leaves the clip's own scale as the answer.
    const canvas = makeCanvas()
    const live = canvas.getContext('2d')
    const getContext = vi.spyOn(canvas, 'getContext')
    getContext.mockReturnValueOnce(live).mockReturnValueOnce(null)

    const measured = measureDragStart(textClip({ scale: 3 }), 'text', canvas, 0, true, [])

    expect(measured.startScaleX).toBe(3)
    expect(measured.startScaleY).toBe(3)
  })
})

/**
 * A clip whose last second slides out to the left under a transition that owns
 * that exit (ESCSUITE-147), and the 400x200 source it draws.
 *
 * At 3.5s the out-preset is exactly halfway, so the clip's own animation reads
 * x 0.25 while the renderer — which suppresses the preset the transition owns —
 * draws it at the base 0.5.
 */
const TRANSITION_SOURCE = makeSourceVideo({ width: 400, height: 200 })

const slidingOut = (preset: AnimationPresetType = 'slide-left'): Clip =>
  makeClip({
    id: 'out1',
    duration: 4,
    animation: makeAnimation({ out: { type: preset, duration: 1, easing: 'linear' } }),
  })

const owningTransition = (clip: Clip) =>
  makeTransitionInfo({ outgoingClip: clip, incomingClip: makeClip({ id: 'in1', timelinePosition: 4 }) })

describe('measureDragStart during a transition (ESCSUITE-147)', () => {
  it('seeds a keyframe-mode drag where the picture is, not where the out-preset would put it', () => {
    const clip = slidingOut()

    const measured = measureDragStart(
      clip, 'video', makeCanvas(), 3.5, true, [TRANSITION_SOURCE], undefined, owningTransition(clip)
    )

    expect(measured.startX).toBe(0.5)
  })

  it('seeds it from the preset position when no transition owns that side', () => {
    const measured = measureDragStart(
      slidingOut(), 'video', makeCanvas(), 3.5, true, [TRANSITION_SOURCE]
    )

    expect(measured.startX).toBe(0.25)
  })

  it('seeds the scale the same way', () => {
    // A scale-down out-preset halves the clip over its last second, so halfway
    // through it the clip's own animation reads 0.5 and the drawn scale is 1.
    const clip = slidingOut('scale-down')

    expect(
      measureDragStart(
        clip, 'video', makeCanvas(), 3.5, true, [TRANSITION_SOURCE], undefined, owningTransition(clip)
      ).startScaleX
    ).toBe(1)
    expect(
      measureDragStart(clip, 'video', makeCanvas(), 3.5, true, [TRANSITION_SOURCE]).startScaleX
    ).toBe(0.5)
  })
})

describe('clipsIntersectingMarquee during a transition (ESCSUITE-147)', () => {
  // The canvas is laid out at half size, so these client coordinates are canvas
  // x 900-1000: inside the drawn box (x 760-1160, centred) and clear of the one
  // the out-preset alone would put at x 280-680.
  const strip = { start: { x: 450, y: 250 }, current: { x: 500, y: 290 } }

  it('sweeps up the clip where the picture is', () => {
    const clip = slidingOut()

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), strip.start, strip.current, [clip], [makeTrack()], 3.5, [TRANSITION_SOURCE],
        undefined, owningTransition(clip)
      )
    ).toEqual(['out1'])
  })

  it('sweeps the preset’s own box when no transition owns that side', () => {
    expect(
      clipsIntersectingMarquee(
        makeCanvas(), strip.start, strip.current, [slidingOut()], [makeTrack()], 3.5, [TRANSITION_SOURCE]
      )
    ).toEqual([])
  })
})

describe('clipsIntersectingMarquee', () => {
  it('sweeps up the clips under the rectangle', () => {
    const clip = shapeClip()

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], [makeTrack()], 0, []
      )
    ).toEqual(['shape1'])
  })

  it('passes over a clip the playhead is not inside', () => {
    // The marquee covers the whole canvas; the clip runs from 10s to 15s.
    const clip = shapeClip({ timelinePosition: 10, duration: 5 })

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], [makeTrack()], 0, []
      )
    ).toEqual([])
  })

  it('passes over a clip whose media is not loaded', () => {
    // A media clip with no source in the list has no size, so it has no box
    // for the marquee to intersect.
    const clip = makeClip({ id: 'orphan', sourceVideoId: 'missing' })

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], [makeTrack()], 0, [
          makeSourceVideo(),
        ]
      )
    ).toEqual([])
  })

  it('passes over a strip only the uncropped picture reached (ESCSUITE-6)', () => {
    // The canvas is laid out at half size, so these client coordinates are
    // canvas x 760-840. A 400x200 source centred on the canvas covers x 760-1160
    // and would be swept up; cropped to its right half it covers x 860-1060 and
    // is not.
    const source = makeSourceVideo({ width: 400, height: 200 })
    const strip = { start: { x: 380, y: 250 }, current: { x: 420, y: 290 } }

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), strip.start, strip.current, [makeClip({ id: 'c1' })], [makeTrack()], 0, [source]
      )
    ).toEqual(['c1'])

    expect(
      clipsIntersectingMarquee(
        makeCanvas(),
        strip.start,
        strip.current,
        [makeClip({ id: 'c1', crop: { left: 0.5, top: 0, right: 0, bottom: 0 } })],
        [makeTrack()],
        0,
        [source]
      )
    ).toEqual([])
  })

  // ESCSUITE-178: a clip on a hidden track takes no picture in the frame, so
  // the marquee cannot sweep it up either — the same question getClipsAtTime
  // asks before drawing a clip at all.
  it('passes over a clip on a hidden track', () => {
    const clip = shapeClip({ trackId: 'hidden' })

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip],
        [makeTrack({ id: 'hidden', visible: false })], 0, []
      )
    ).toEqual([])
  })

  it('passes over a clip whose track is gone', () => {
    const clip = shapeClip({ trackId: 'missing' })

    expect(
      clipsIntersectingMarquee(
        makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], [makeTrack()], 0, []
      )
    ).toEqual([])
  })
})

describe('textClipAtPoint', () => {
  const tracks = [makeTrack()]

  it('finds the text under the point', () => {
    const clip = textClip()

    expect(textClipAtPoint(CANVAS_W / 2, CANVAS_H / 2, makeCanvas(), [clip], tracks, 0, [])).toBe(
      clip
    )
  })

  it('finds nothing when the text cannot be measured', () => {
    // No 2D context, so no bounds, so nothing to be inside.
    const canvas = makeCanvas({ withContext: false })
    failNextGetContext()

    expect(
      textClipAtPoint(CANVAS_W / 2, CANVAS_H / 2, canvas, [textClip()], tracks, 0, [])
    ).toBeNull()
  })
})
