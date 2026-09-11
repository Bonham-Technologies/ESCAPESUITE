// The selection chrome, drawn straight onto a recording canvas.
//
// The expected rectangles are built out of HANDLE_SIZE and the clip's own box
// rather than pasted in, so a change to either constant shows up here as a
// deliberate edit instead of a mystery number.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  drawMultiSelectHandles,
  drawSelectionHandles,
  type MultiSelectOverlayContext,
  type SelectionOverlayContext,
} from './selectionOverlay'
import { HANDLE_SIZE, ROTATION_HANDLE_OFFSET } from './previewGeometry'
import { makeAnimation, makeClip, makeSourceVideo } from '../../test/fixtures/exportPipeline'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../../test/doubles/canvas'
import type { Clip, Keyframe, SourceVideo } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

/** A 400x200 source centred on the canvas: local corners at (±200, ±100). */
const source: SourceVideo = makeSourceVideo({ width: 400, height: 200 })
const HALF_W = 200
const HALF_H = 100

/** Corner handles are full size; side handles are 80% of it. */
const HALF_HANDLE = HANDLE_SIZE / 2
const SIDE_HANDLE = HANDLE_SIZE * 0.8
const HALF_SIDE = SIDE_HANDLE / 2

let canvas: HTMLCanvasElement
let ctx: RecordingCanvasRenderingContext2D

beforeEach(() => {
  installCanvasDouble()
  canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  canvas.getContext('2d')
  ctx = getCanvasContext(canvas)!
})

afterEach(() => {
  uninstallCanvasDouble()
})

/** A canvas whose next getContext('2d') hands back null, as a failed one does. */
function contextlessCanvas(): HTMLCanvasElement {
  const el = document.createElement('canvas')
  el.width = CANVAS_W
  el.height = CANVAS_H
  failNextGetContext()
  return el
}

const kf = (time: number, value: number): Keyframe => ({ time, value, easing: 'linear' })

const mediaClip = (overrides: Partial<Clip> = {}): Clip =>
  makeClip({ id: 'clip1', duration: 4, ...overrides })

function selection(overrides: Partial<SelectionOverlayContext> = {}): SelectionOverlayContext {
  return {
    clips: [mediaClip()],
    sourceVideos: [source],
    selectedClipId: 'clip1',
    isPlaying: false,
    keyframePanelOpen: false,
    ...overrides,
  }
}

function multiSelection(
  overrides: Partial<MultiSelectOverlayContext> = {}
): MultiSelectOverlayContext {
  return {
    clips: [mediaClip()],
    sourceVideos: [source],
    selectedClipId: null,
    selectedClipIds: new Set(['clip1', 'clip2']),
    isPlaying: false,
    ...overrides,
  }
}

describe('drawSelectionHandles', () => {
  it('draws the bounding box, eight resize handles and the rotation handle', () => {
    drawSelectionHandles(canvas, 1, selection())

    // Into the clip's frame first: its centre, then its rotation.
    expect(ctx.argsFor('translate')).toEqual([[CANVAS_W / 2, CANVAS_H / 2]])
    expect(ctx.argsFor('rotate')).toEqual([[0]])

    const strokeRects = ctx.argsFor('strokeRect')
    const fillRects = ctx.argsFor('fillRect')
    expect(strokeRects[0]).toEqual([-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2])

    // Four corners, full size, then four sides at 80% — each filled white and
    // outlined, so the same rectangle appears in both lists.
    const corners = [
      [-HALF_W, -HALF_H],
      [HALF_W, -HALF_H],
      [-HALF_W, HALF_H],
      [HALF_W, HALF_H],
    ]
    const sides = [
      [0, -HALF_H],
      [0, HALF_H],
      [-HALF_W, 0],
      [HALF_W, 0],
    ]
    const expected = [
      ...corners.map(([x, y]) => [x - HALF_HANDLE, y - HALF_HANDLE, HANDLE_SIZE, HANDLE_SIZE]),
      ...sides.map(([x, y]) => [x - HALF_SIDE, y - HALF_SIDE, SIDE_HANDLE, SIDE_HANDLE]),
    ]
    expect(fillRects).toEqual(expected)
    expect(strokeRects.slice(1)).toEqual(expected)

    // The rotation handle hangs above the top border on a dashed leader line.
    const rotationY = -HALF_H - ROTATION_HANDLE_OFFSET
    expect(ctx.argsFor('moveTo')).toEqual([[0, -HALF_H]])
    expect(ctx.argsFor('lineTo')).toEqual([[0, rotationY]])
    expect(ctx.argsFor('arc')).toEqual([[0, rotationY, HANDLE_SIZE, 0, Math.PI * 2]])
    expect(ctx.argsFor('setLineDash')).toEqual([[[]], [[4, 4]], [[]]])

    // And the whole thing is drawn inside one save/restore pair.
    expect(ctx.argsFor('save')).toHaveLength(1)
    expect(ctx.argsFor('restore')).toHaveLength(1)
  })

  it('draws in blue on a 2px stroke', () => {
    drawSelectionHandles(canvas, 1, selection())

    const box = ctx.stateFor('strokeRect')[0]
    expect(box.strokeStyle).toBe('#2196F3')
    expect(box.lineWidth).toBe(2)
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#ffffff')
  })

  it('turns the whole overlay by the clip’s rotation', () => {
    const clip = mediaClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
    })

    drawSelectionHandles(canvas, 1, selection({ clips: [clip] }))

    expect(ctx.argsFor('rotate')).toEqual([[Math.PI / 2]])
  })

  it('uses the animated box at the given time', () => {
    const clip = mediaClip({
      animation: makeAnimation({ keyframes: { x: [kf(0, 0)], scaleX: [kf(0, 2)] } }),
    })

    drawSelectionHandles(canvas, 1, selection({ clips: [clip], keyframePanelOpen: true }))

    expect(ctx.argsFor('translate')).toEqual([[0, CANVAS_H / 2]])
    expect(ctx.argsFor('strokeRect')[0]).toEqual([-HALF_W * 2, -HALF_H, HALF_W * 4, HALF_H * 2])
  })

  it('draws nothing during playback', () => {
    drawSelectionHandles(canvas, 1, selection({ isPlaying: true }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('draws nothing with no selection', () => {
    drawSelectionHandles(canvas, 1, selection({ selectedClipId: null }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('draws nothing when the selected id matches no clip', () => {
    drawSelectionHandles(canvas, 1, selection({ selectedClipId: 'gone' }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('draws nothing around an audio clip', () => {
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })

    drawSelectionHandles(
      canvas,
      1,
      selection({
        clips: [mediaClip({ sourceVideoId: 'audio1' })],
        sourceVideos: [source, audio],
      })
    )

    expect(ctx.calls).toHaveLength(0)
  })

  it('draws nothing when the clip is not on screen at that time', () => {
    drawSelectionHandles(canvas, 1, selection({ clips: [mediaClip({ timelinePosition: 10 })] }))
    drawSelectionHandles(canvas, 10, selection({ clips: [mediaClip({ duration: 4 })] }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('draws nothing when the clip’s bounds cannot be worked out', () => {
    drawSelectionHandles(canvas, 1, selection({ clips: [mediaClip({ sourceVideoId: 'missing' })] }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('hides the handles of a keyframed clip until the keyframe panel is open', () => {
    const clip = mediaClip({ animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }) })

    drawSelectionHandles(canvas, 1, selection({ clips: [clip] }))
    expect(ctx.calls).toHaveLength(0)

    drawSelectionHandles(canvas, 1, selection({ clips: [clip], keyframePanelOpen: true }))
    expect(ctx.argsFor('strokeRect')[0]).toEqual([-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2])
  })

  it('gives up on a canvas with no 2D context', () => {
    const el = contextlessCanvas()

    expect(() => drawSelectionHandles(el, 1, selection())).not.toThrow()
    expect(getCanvasContext(el)).toBeUndefined()
  })
})

describe('drawMultiSelectHandles', () => {
  it('draws a dashed box for every multi-selected clip', () => {
    const second = mediaClip({ id: 'clip2' })

    drawMultiSelectHandles(canvas, 1, multiSelection({ clips: [mediaClip(), second] }))

    expect(ctx.argsFor('setLineDash')).toEqual([[[6, 4]], [[6, 4]]])
    expect(ctx.argsFor('strokeRect')).toEqual([
      [-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2],
      [-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2],
    ])
    expect(ctx.stateFor('strokeRect')[0].strokeStyle).toBe('#2196F3')
    // No resize handles: a multi-selection is a box and nothing else.
    expect(ctx.argsFor('fillRect')).toHaveLength(0)
    expect(ctx.argsFor('arc')).toHaveLength(0)
  })

  it('leaves the primary selection to drawSelectionHandles', () => {
    const second = mediaClip({ id: 'clip2' })

    drawMultiSelectHandles(
      canvas,
      1,
      multiSelection({ clips: [mediaClip(), second], selectedClipId: 'clip1' })
    )

    expect(ctx.argsFor('strokeRect')).toHaveLength(1)
  })

  it('draws nothing for a selection of one or none', () => {
    drawMultiSelectHandles(canvas, 1, multiSelection({ selectedClipIds: new Set(['clip1']) }))
    drawMultiSelectHandles(canvas, 1, multiSelection({ selectedClipIds: new Set<string>() }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('draws nothing during playback', () => {
    drawMultiSelectHandles(canvas, 1, multiSelection({ isPlaying: true }))

    expect(ctx.calls).toHaveLength(0)
  })

  it('skips ids with no clip, audio clips, off-screen clips and unmeasurable ones', () => {
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })

    drawMultiSelectHandles(
      canvas,
      1,
      multiSelection({
        clips: [
          mediaClip({ id: 'audio', sourceVideoId: 'audio1' }),
          mediaClip({ id: 'later', timelinePosition: 10 }),
          mediaClip({ id: 'unloaded', sourceVideoId: 'missing' }),
        ],
        sourceVideos: [source, audio],
        selectedClipIds: new Set(['gone', 'audio', 'later', 'unloaded']),
      })
    )

    expect(ctx.argsFor('strokeRect')).toHaveLength(0)
  })

  it('gives up on a canvas with no 2D context', () => {
    const el = contextlessCanvas()

    expect(() => drawMultiSelectHandles(el, 1, multiSelection())).not.toThrow()
    expect(getCanvasContext(el)).toBeUndefined()
  })
})
