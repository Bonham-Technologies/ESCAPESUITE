// What the preview reports under the pointer, asked directly.
//
// Every point below is given in canvas pixels and divided down into the 0-1
// space hitTestHandles takes, so the arithmetic that matters — the box a clip
// occupies, the tolerance around a handle — stays visible in the test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hitTestHandles, type HitTestContext } from './hitTest'
import { HANDLE_SIZE, ROTATION_HANDLE_OFFSET } from './previewGeometry'
import {
  makeAnimation,
  makeClip,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
  makeTrack,
} from '../../test/fixtures/exportPipeline'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import type { Clip, Keyframe, SourceVideo, Track } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

/**
 * A 400x200 source centred on the canvas: the clip's box runs x 760-1160 and
 * y 440-640, so there is room on every side to miss it.
 */
const source: SourceVideo = makeSourceVideo({ width: 400, height: 200 })
const HALF_W = 200
const HALF_H = 100
const CENTER_X = CANVAS_W / 2
const CENTER_Y = CANVAS_H / 2

const track: Track = makeTrack()

let canvas: HTMLCanvasElement

beforeEach(() => {
  installCanvasDouble()
  canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  canvas.getContext('2d')
})

afterEach(() => {
  uninstallCanvasDouble()
})

function scene(overrides: Partial<HitTestContext> = {}): HitTestContext {
  return {
    clips: [],
    tracks: [track],
    sourceVideos: [source],
    currentTime: 1,
    selectedClipId: null,
    keyframePanelOpen: false,
    ...overrides,
  }
}

/** Hit-test a point given in canvas pixels. */
function hitAt(x: number, y: number, context: HitTestContext) {
  return hitTestHandles(x / CANVAS_W, y / CANVAS_H, canvas, context)
}

const kf = (time: number, value: number): Keyframe => ({ time, value, easing: 'linear' })

const mediaClip = (overrides: Partial<Clip> = {}): Clip =>
  makeClip({ id: 'clip1', duration: 4, ...overrides })

describe('hitTestHandles body hits', () => {
  it('finds nothing on an empty scene', () => {
    expect(hitAt(CENTER_X, CENTER_Y, scene())).toBeNull()
  })

  it('reports a move on the body of an unselected clip', () => {
    const clip = mediaClip()

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'move',
    })
  })

  it('finds nothing outside the clip’s box', () => {
    const clip = mediaClip()

    expect(hitAt(CENTER_X + HALF_W + 1, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
    expect(hitAt(CENTER_X, CENTER_Y + HALF_H + 1, scene({ clips: [clip] }))).toBeNull()
  })

  it('rotates the pointer into the clip’s own frame', () => {
    // Turned 90 degrees, the 400x200 box covers x 860-1060 and y 340-740.
    const clip = mediaClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
    })

    expect(hitAt(CENTER_X, CENTER_Y + 150, scene({ clips: [clip] }))?.mode).toBe('move')
    expect(hitAt(CENTER_X + 150, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })

  it('skips clips that are not on screen at the current time', () => {
    const clip = mediaClip({ timelinePosition: 10 })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })

  it('skips clips on a hidden track', () => {
    const hidden = makeTrack({ id: 'track2', visible: false })
    const clip = mediaClip({ trackId: 'track2' })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip], tracks: [track, hidden] }))).toBeNull()
  })

  it('skips audio clips', () => {
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })
    const clip = mediaClip({ sourceVideoId: 'audio1' })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip], sourceVideos: [source, audio] }))
    ).toBeNull()
  })

  it('skips clips whose bounds cannot be worked out', () => {
    const clip = mediaClip({ sourceVideoId: 'missing' })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })

  it('skips clips with custom keyframes while the keyframe panel is closed', () => {
    const clip = mediaClip({ animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }) })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })
})

describe('hitTestHandles z-order', () => {
  const overlapping = (id: string, extra: Partial<Clip>): Clip =>
    makeClip({ id, duration: 4, sourceVideoId: '', ...extra })

  const text = overlapping('text1', { overlayType: 'text', textData: makeTextData() })
  const shape = overlapping('shape1', { overlayType: 'shape', shapeData: makeShapeData() })
  const media = mediaClip()

  it('puts overlays above media clips', () => {
    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [shape, media] }))?.clipId).toBe('shape1')
  })

  it('puts text overlays above shape overlays', () => {
    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [shape, text] }))?.clipId).toBe('text1')
    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [text, shape] }))?.clipId).toBe('text1')
  })

  it('falls back to track index between clips of the same kind', () => {
    const upper = makeTrack({ id: 'track2', index: 5 })
    const lower = mediaClip({ id: 'lower' })
    const higher = mediaClip({ id: 'higher', trackId: 'track2' })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [lower, higher], tracks: [track, upper] }))?.clipId
    ).toBe('higher')
  })

  it('falls through the top clip to the one below when the top one misses', () => {
    // The text overlay is only 100x48, so a point 200px out clears it.
    expect(hitAt(CENTER_X + 150, CENTER_Y, scene({ clips: [media, text] }))?.clipId).toBe('clip1')
  })
})

describe('hitTestHandles handles on the selected clip', () => {
  const selected = scene({ clips: [mediaClip()], selectedClipId: 'clip1' })

  it('finds the rotation handle above the box', () => {
    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, selected)).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'rotate',
    })
  })

  it('finds each corner', () => {
    const corners = [
      [CENTER_X - HALF_W, CENTER_Y - HALF_H, 'resize-nw'],
      [CENTER_X + HALF_W, CENTER_Y - HALF_H, 'resize-ne'],
      [CENTER_X - HALF_W, CENTER_Y + HALF_H, 'resize-sw'],
      [CENTER_X + HALF_W, CENTER_Y + HALF_H, 'resize-se'],
    ] as const

    for (const [x, y, mode] of corners) {
      expect(hitAt(x, y, selected)?.mode).toBe(mode)
    }
  })

  it('finds each edge along its whole length', () => {
    const edges = [
      [CENTER_X, CENTER_Y - HALF_H, 'resize-n'],
      [CENTER_X, CENTER_Y + HALF_H, 'resize-s'],
      [CENTER_X - HALF_W, CENTER_Y, 'resize-w'],
      [CENTER_X + HALF_W, CENTER_Y, 'resize-e'],
    ] as const

    for (const [x, y, mode] of edges) {
      expect(hitAt(x, y, selected)?.mode).toBe(mode)
    }
  })

  it('keeps the corner tolerance at 1.5 handles and the edge tolerance at 1.2', () => {
    const cornerTolerance = HANDLE_SIZE * 1.5
    const edgeTolerance = HANDLE_SIZE * 1.2

    // Just inside the corner zone is a corner; just outside it, the same point
    // is close enough to the top edge to be an edge instead.
    expect(hitAt(CENTER_X - HALF_W + cornerTolerance - 1, CENTER_Y - HALF_H, selected)?.mode).toBe(
      'resize-nw'
    )
    expect(hitAt(CENTER_X - HALF_W + cornerTolerance, CENTER_Y - HALF_H, selected)?.mode).toBe(
      'resize-n'
    )
    // Past the edge tolerance below the top border it is just the body again.
    expect(hitAt(CENTER_X, CENTER_Y - HALF_H + edgeTolerance, selected)?.mode).toBe('move')
  })

  it('only offers an edge along the span of that edge', () => {
    // Level with the left border but well below the box: nothing.
    expect(hitAt(CENTER_X - HALF_W, CENTER_Y + HALF_H + 50, selected)).toBeNull()
  })

  it('offers no handles on a clip that is merely selected but off screen', () => {
    const offScreen = scene({
      clips: [mediaClip({ timelinePosition: 10 })],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, offScreen)).toBeNull()
  })

  it('offers no handles on a clip whose bounds cannot be worked out', () => {
    const unloaded = scene({
      clips: [mediaClip({ sourceVideoId: 'missing' })],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, unloaded)).toBeNull()
  })

  it('offers no handles on an audio clip, which has no type to drag', () => {
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })
    const audioScene = scene({
      clips: [mediaClip({ sourceVideoId: 'audio1' })],
      sourceVideos: [source, audio],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y, audioScene)).toBeNull()
  })

  it('offers no handles on a selected clip with custom keyframes', () => {
    const keyframed = scene({
      clips: [mediaClip({ animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }) })],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, keyframed)).toBeNull()
    expect(hitAt(CENTER_X, CENTER_Y, keyframed)).toBeNull()
  })

  it('offers no handles on a clip that is not the selected one', () => {
    const other = scene({
      clips: [mediaClip(), mediaClip({ id: 'clip2' })],
      selectedClipId: 'clip2',
    })

    // clip2's handles are at the same place — the point is that the hit is
    // reported against the selected clip, not clip1 underneath it.
    expect(hitAt(CENTER_X - HALF_W, CENTER_Y - HALF_H, other)?.clipId).toBe('clip2')
  })

  it('still reports a body move when the pointer is inside but off every handle', () => {
    expect(hitAt(CENTER_X, CENTER_Y, selected)).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'move',
    })
  })
})

describe('hitTestHandles with the keyframe panel open', () => {
  const keyframed = mediaClip({ animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }) })
  const open = (overrides: Partial<HitTestContext> = {}) =>
    scene({ clips: [keyframed], selectedClipId: 'clip1', keyframePanelOpen: true, ...overrides })

  it('drives the selected clip’s handles even though it has keyframes', () => {
    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, open())?.mode).toBe('rotate')
    expect(hitAt(CENTER_X - HALF_W, CENTER_Y - HALF_H, open())?.mode).toBe('resize-nw')
    expect(hitAt(CENTER_X, CENTER_Y - HALF_H, open())?.mode).toBe('resize-n')
    expect(hitAt(CENTER_X, CENTER_Y + HALF_H, open())?.mode).toBe('resize-s')
    expect(hitAt(CENTER_X - HALF_W, CENTER_Y, open())?.mode).toBe('resize-w')
    expect(hitAt(CENTER_X + HALF_W, CENTER_Y, open())?.mode).toBe('resize-e')
    expect(hitAt(CENTER_X, CENTER_Y, open())?.mode).toBe('move')
  })

  it('ignores everything outside the selected clip', () => {
    const other = mediaClip({ id: 'clip2' })

    expect(hitAt(CENTER_X, CENTER_Y + HALF_H + 50, open({ clips: [keyframed, other] }))).toBeNull()
  })

  it('ignores a click when the selected clip is off screen', () => {
    expect(
      hitAt(CENTER_X, CENTER_Y, open({ clips: [mediaClip({ timelinePosition: 10 })] }))
    ).toBeNull()
  })

  it('ignores a click when the selected clip’s bounds cannot be worked out', () => {
    expect(
      hitAt(CENTER_X, CENTER_Y, open({ clips: [mediaClip({ sourceVideoId: 'missing' })] }))
    ).toBeNull()
  })

  it('ignores a click when the selected clip has no draggable type', () => {
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })

    expect(
      hitAt(
        CENTER_X,
        CENTER_Y,
        open({ clips: [mediaClip({ sourceVideoId: 'audio1' })], sourceVideos: [source, audio] })
      )
    ).toBeNull()
  })

  it('falls back to the normal passes when nothing is selected', () => {
    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [mediaClip()], keyframePanelOpen: true }))?.mode
    ).toBe('move')
  })
})
