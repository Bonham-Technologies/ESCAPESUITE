// The one transform that carries project space onto an output raster
// (ESCSUITE-94). Asserted through the recording 2D context, because the two
// context calls *are* the behaviour: a caller cannot use the scale without the
// clear, and the clear's rectangle is what says whether the bars were painted.
import { describe, it, expect } from 'vitest'
import { createRecordingContext } from '../test/doubles/canvas'
import { openOutputFrame, projectToOutputScale, setOutputTransform } from './outputTransform'

describe('projectToOutputScale', () => {
  it('is 1 when the raster is the project', () => {
    expect(projectToOutputScale({ width: 1280, height: 720 }, { width: 1280, height: 720 })).toBe(1)
  })

  it('scales up and down by the same ratio on both axes', () => {
    const project = { width: 1280, height: 720 }
    expect(projectToOutputScale(project, { width: 1920, height: 1080 })).toBe(1.5)
    expect(projectToOutputScale(project, { width: 640, height: 360 })).toBe(0.5)
  })

  it('takes the smaller ratio when the aspects differ, so nothing is stretched', () => {
    // 4:3 raster, 16:9 project: the width would allow 0.5, the height 0.667.
    expect(projectToOutputScale({ width: 1280, height: 720 }, { width: 640, height: 480 })).toBe(0.5)
    // And the other way round — 16:9 raster, 4:3 project.
    expect(projectToOutputScale({ width: 640, height: 480 }, { width: 1280, height: 720 })).toBe(1.5)
  })

  it('refuses to divide by a degenerate project size', () => {
    expect(projectToOutputScale({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBe(1)
    expect(projectToOutputScale({ width: 1920, height: 0 }, { width: 1920, height: 1080 })).toBe(1)
  })
})

describe('setOutputTransform', () => {
  it('is a pure scale, and returns it, when the fit is exact', () => {
    const ctx = createRecordingContext()

    const scale = setOutputTransform(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 }
    )

    expect(scale).toBe(1.5)
    expect(ctx.argsFor('setTransform')).toEqual([[1.5, 0, 0, 1.5, 0, 0]])
    // The transform alone: nothing is cleared, because the one caller that wants
    // it without a clear is about to paint over the whole raster.
    expect(ctx.argsFor('fillRect')).toEqual([])
  })

  it('carries the translation, so both entry points place the picture identically', () => {
    // A raster one pixel short of the project's aspect — `previewRaster` rounds
    // the height, so this is the preview's own rounding, not a contrived case.
    // 960x539 of a 1920x1080 project fits at 539/1080, which leaves a sub-pixel
    // pillar bar. The cache-hit path used to write `(k, 0, 0, k, 0, 0)` here and
    // disagree with the frame path by exactly that bar.
    const direct = createRecordingContext()
    const viaFrame = createRecordingContext()
    const project = { width: 1920, height: 1080 }
    const raster = { width: 960, height: 539 }

    setOutputTransform(direct as unknown as CanvasRenderingContext2D, project, raster)
    openOutputFrame(viaFrame as unknown as CanvasRenderingContext2D, project, raster)

    const [matrix] = direct.argsFor('setTransform')
    expect(viaFrame.argsFor('setTransform')).toEqual([matrix])
    // Meaningful only if there really is a translation to agree about.
    expect(matrix[4]).not.toBe(0)
    expect(matrix[5]).toBe(0)
  })
})

describe('openOutputFrame', () => {
  it('sets a pure scale and clears the project rect when the fit is exact', () => {
    const ctx = createRecordingContext()

    const scale = openOutputFrame(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 }
    )

    expect(scale).toBe(1.5)
    expect(ctx.argsFor('setTransform')).toEqual([[1.5, 0, 0, 1.5, 0, 0]])
    expect(ctx.argsFor('fillRect')).toEqual([[0, 0, 1280, 720]])
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#000000')
  })

  it('is the identity, and the call it always was, for a raster that is the project', () => {
    const ctx = createRecordingContext()

    openOutputFrame(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 1280, height: 720 },
      { width: 1280, height: 720 }
    )

    expect(ctx.argsFor('setTransform')).toEqual([[1, 0, 0, 1, 0, 0]])
    expect(ctx.argsFor('fillRect')).toEqual([[0, 0, 1280, 720]])
  })

  it('centres the project inside a taller raster and clears the bars with it', () => {
    const ctx = createRecordingContext()

    openOutputFrame(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 1280, height: 720 },
      { width: 640, height: 480 }
    )

    // 0.5 uniform, so 640x360 of picture in a 640x480 raster: 60 output pixels
    // of bar above and below.
    expect(ctx.argsFor('setTransform')).toEqual([[0.5, 0, 0, 0.5, 0, 60]])
    // One fill covers the picture and both bars, in project coordinates.
    expect(ctx.argsFor('fillRect')).toEqual([[0, -120, 1280, 960]])
  })

  it('centres the project inside a wider raster', () => {
    const ctx = createRecordingContext()

    openOutputFrame(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 640, height: 480 },
      { width: 1280, height: 720 }
    )

    // 1.5 uniform, so 960x720 of picture: 160 output pixels of bar each side.
    expect(ctx.argsFor('setTransform')).toEqual([[1.5, 0, 0, 1.5, 160, 0]])
    expect(ctx.argsFor('fillRect')).toEqual([[-320 / 3, 0, 1280 / 1.5, 480]])
  })

  it('writes +0 rather than -0 into a clear rect with no bar on that axis', () => {
    // `-0 / scale` is `-0`, and `-0` is a different number from `0` to anything
    // comparing with Object.is — which is every assertion on these arguments.
    const ctx = createRecordingContext()

    openOutputFrame(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 1280, height: 720 },
      { width: 640, height: 480 }
    )

    expect(Object.is(ctx.argsFor('fillRect')[0][0], 0)).toBe(true)
  })

  it('leaves a degenerate project drawn 1:1 rather than dividing by zero', () => {
    const ctx = createRecordingContext()

    const scale = openOutputFrame(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 0, height: 0 },
      { width: 1920, height: 1080 }
    )

    expect(scale).toBe(1)
    expect(ctx.argsFor('setTransform')).toEqual([[1, 0, 0, 1, 960, 540]])
    expect(ctx.argsFor('fillRect')).toEqual([[-960, -540, 1920, 1080]])
  })
})
