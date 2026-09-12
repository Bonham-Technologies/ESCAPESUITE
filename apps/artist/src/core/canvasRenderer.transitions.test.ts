// Transitions. Both renderers draw the two clips twice per frame with the
// modifiers the transition type dictates, so the assertions here are on the
// recorded geometry: which source was drawn, with what alpha, clip region or
// offset, at a given progress.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { drawTransition, drawTransitionWithFrames } from './canvasRenderer'
import { clearAnimationCache } from '../utils/animation'
import {
  createRecordingContext,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { VideoFrameDouble, resetFrameRegistry } from '../test/doubles/webcodecs'
import { makeClip } from '../test/fixtures/exportPipeline'
import type { Clip, TransitionType } from '../store/types'
import type { DrawableMediaSource, TransitionInfo } from './exportTypes'

const W = 1920
const H = 1080
/** Half a second into the incoming clip, half a second before the outgoing ends. */
const NOW = 4.5

const outgoingClip: Clip = makeClip({
  id: 'out',
  sourceVideoId: 'v1',
  timelinePosition: 0,
  duration: 5,
  endTime: 5,
})
const incomingClip: Clip = makeClip({
  id: 'in',
  sourceVideoId: 'v2',
  timelinePosition: 4,
  duration: 5,
  endTime: 5,
})

const transitionOf = (type: TransitionType, progress: number): TransitionInfo => ({
  outgoingClip,
  incomingClip,
  progress,
  type,
})

let ctx: RecordingCanvasRenderingContext2D
let media: MediaDoubles
const asCtx = () => ctx as unknown as CanvasRenderingContext2D

beforeEach(() => {
  clearAnimationCache()
  resetFrameRegistry()
  ctx = createRecordingContext()
  media = installMediaElementDoubles()
})

afterEach(() => {
  media.uninstall()
  clearAnimationCache()
})

function video(width: number, height: number, readyState = 4): HTMLVideoElement {
  media.script({ video: { videoWidth: width, videoHeight: height, readyState } })
  return document.createElement('video')
}

function image(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  media.script({ image: { naturalWidth, naturalHeight } })
  return document.createElement('img')
}

/** Which source each drawImage call drew, in order. */
const drawnSources = () => ctx.argsFor('drawImage').map((args) => args[0])
const drawnAlphas = () => ctx.stateFor('drawImage').map((s) => s.globalAlpha)

describe('drawTransition', () => {
  let videos: Map<string, HTMLVideoElement>
  let images: Map<string, HTMLImageElement>
  let out: HTMLVideoElement
  let incoming: HTMLVideoElement

  beforeEach(() => {
    out = video(640, 360)
    incoming = video(800, 450)
    videos = new Map([
      ['v1', out],
      ['v2', incoming],
    ])
    images = new Map()
  })

  const draw = (type: TransitionType, progress: number) =>
    drawTransition(asCtx(), videos, images, transitionOf(type, progress), NOW, W, H)

  it('reports failure and draws nothing when neither clip has media', () => {
    expect(drawTransition(asCtx(), new Map(), new Map(), transitionOf('fade', 0.5), NOW, W, H))
      .toBe(false)
    expect(ctx.calls).toEqual([])
  })

  it('draws only the incoming clip, faded in, when the outgoing has no media', () => {
    videos.delete('v1')

    expect(draw('fade', 0.25)).toBe(true)
    expect(drawnSources()).toEqual([incoming])
    expect(drawnAlphas()).toEqual([0.25])
  })

  it('draws only the outgoing clip, faded out, when the incoming has no media', () => {
    videos.delete('v2')

    expect(draw('fade', 0.25)).toBe(true)
    expect(drawnSources()).toEqual([out])
    expect(drawnAlphas()).toEqual([0.75])
  })

  it('wipes with the incoming clip alone when the outgoing has no media', () => {
    // A one-sided transition is still that transition: a wipe clips the side
    // it does have to the region it would occupy, rather than fading it in.
    videos.delete('v1')

    expect(draw('wipe-left', 0.25)).toBe(true)
    expect(ctx.argsFor('rect')).toEqual([[W * 0.75, 0, W * 0.25, H]])
    expect(drawnAlphas()).toEqual([1])
  })

  it('slides the incoming clip in from below when the outgoing has no media', () => {
    videos.delete('v1')

    expect(draw('slide-up', 0.25)).toBe(true)
    // 800x450 centred at 540 is y=315, offset down by the slide's h * (1 - progress).
    expect(ctx.argsFor('drawImage').map((a) => a[2])).toEqual([315 + H * 0.75])
    expect(drawnAlphas()).toEqual([1])
  })

  it('counts an image-only source as media', () => {
    videos.delete('v2')
    const still = image(800, 450)
    images.set('v2', still)

    expect(draw('fade', 0.5)).toBe(true)
    expect(drawnSources()).toEqual([out, still])
  })

  it('warns when a video in the transition has not decoded a frame yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    videos.set('v1', video(640, 360, 0))
    videos.set('v2', video(800, 450, 0))

    draw('fade', 0.5)

    expect(warn).toHaveBeenCalledWith(
      `Transition: outgoing video not ready (readyState=0) at time ${NOW}`
    )
    expect(warn).toHaveBeenCalledWith(
      `Transition: incoming video not ready (readyState=0) at time ${NOW}`
    )
    warn.mockRestore()
  })

  it('says nothing about an unready video for a caller that asked for quiet', () => {
    // A preview redraws the frame on every animation frame; the exporter's
    // one warning per frame would be sixty a second here.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    videos.set('v1', video(640, 360, 0))
    videos.set('v2', video(800, 450, 0))

    drawTransition(asCtx(), videos, images, transitionOf('fade', 0.5), NOW, W, H, { quiet: true })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('crossfades outgoing out and incoming in', () => {
    draw('fade', 0.25)

    expect(drawnSources()).toEqual([out, incoming])
    expect(drawnAlphas()).toEqual([0.75, 0.25])
  })

  it('is fully outgoing at progress 0 and fully incoming at progress 1', () => {
    draw('fade', 0)
    expect(drawnAlphas()).toEqual([1, 0])

    ctx = createRecordingContext()
    draw('fade', 1)
    expect(drawnAlphas()).toEqual([0, 1])
  })

  it('dissolves with a blur that peaks mid-transition', () => {
    draw('dissolve', 0.5)

    expect(ctx.calls[0].method).toBe('save')
    expect(ctx.stateFor('drawImage')[0].filter).toBe(`blur(${Math.sin(Math.PI / 2) * 3}px)`)
    expect(drawnAlphas()).toEqual([0.5, 0.5])
    expect(ctx.calls[ctx.calls.length - 1].method).toBe('restore')
  })

  it('dissolves with no blur at the very start', () => {
    draw('dissolve', 0)

    expect(ctx.stateFor('drawImage')[0].filter).toBe('none')
  })

  it('passes the draw options down to both sides of the transition', () => {
    // resetFilter is the visible one: a caller that asks for it draws two
    // unblurred clips unfiltered, dissolve blur and all.
    drawTransition(asCtx(), videos, images, transitionOf('dissolve', 0.5), NOW, W, H, {
      uncachedAnimation: true,
      resetFilter: true,
    })

    expect(drawnSources()).toEqual([out, incoming])
    expect(ctx.stateFor('drawImage').map((state) => state.filter)).toEqual(['none', 'none'])
  })

  it('passes the draw options down when only one clip has media', () => {
    videos.delete('v1')
    ctx.filter = 'blur(3px)'

    drawTransition(asCtx(), videos, images, transitionOf('fade', 0.25), NOW, W, H, {
      resetFilter: true,
    })

    expect(ctx.stateFor('drawImage')[0].filter).toBe('none')
  })

  it('passes the draw options down for an unknown transition type', () => {
    ctx.filter = 'blur(3px)'

    drawTransition(
      asCtx(),
      videos,
      images,
      transitionOf('iris' as TransitionType, 0.5),
      NOW,
      W,
      H,
      { resetFilter: true }
    )

    // Both clips drawn untouched, and neither inherits the ambient filter.
    expect(ctx.stateFor('drawImage').map((state) => state.filter)).toEqual(['none', 'none'])
    expect(drawnAlphas()).toEqual([1, 1])
  })

  it('wipes left by shrinking the outgoing region from the right', () => {
    draw('wipe-left', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [0, 0, W * 0.75, H],
      [W * 0.75, 0, W * 0.25, H],
    ])
  })

  it('wipes right by shrinking the outgoing region from the left', () => {
    draw('wipe-right', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [W * 0.25, 0, W * 0.75, H],
      [0, 0, W * 0.25, H],
    ])
  })

  it('wipes up by revealing the incoming clip from the bottom', () => {
    draw('wipe-up', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [0, 0, W, H * 0.75],
      [0, H * 0.75, W, H * 0.25],
    ])
  })

  it('wipes down by revealing the incoming clip from the top', () => {
    draw('wipe-down', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [0, H * 0.25, W, H * 0.75],
      [0, 0, W, H * 0.25],
    ])
  })

  it('slides left: outgoing exits left, incoming enters from the right', () => {
    draw('slide-left', 0.25)

    // Native 640x360 centred at 960 is x=640; 800x450 centred is x=560.
    expect(ctx.argsFor('drawImage').map((a) => a[1])).toEqual([
      640 - W * 0.25,
      560 + W * 0.75,
    ])
  })

  it('slides right: outgoing exits right, incoming enters from the left', () => {
    draw('slide-right', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[1])).toEqual([
      640 + W * 0.25,
      560 - W * 0.75,
    ])
  })

  it('slides up: outgoing exits upward, incoming enters from below', () => {
    draw('slide-up', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[2])).toEqual([
      360 - H * 0.25,
      315 + H * 0.75,
    ])
  })

  it('slides down: outgoing exits downward, incoming enters from above', () => {
    draw('slide-down', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[2])).toEqual([
      360 + H * 0.25,
      315 - H * 0.75,
    ])
  })

  it('draws both clips untouched for a transition type it does not know', () => {
    draw('none', 0.25)

    expect(drawnSources()).toEqual([out, incoming])
    expect(drawnAlphas()).toEqual([1, 1])
    expect(ctx.argsFor('rect')).toEqual([])
  })
})

describe('drawTransitionWithFrames', () => {
  let outFrame: DrawableMediaSource
  let inFrame: DrawableMediaSource

  beforeEach(() => {
    outFrame = new VideoFrameDouble({
      displayWidth: 640,
      displayHeight: 360,
    }) as unknown as DrawableMediaSource
    inFrame = new VideoFrameDouble({
      displayWidth: 800,
      displayHeight: 450,
    }) as unknown as DrawableMediaSource
  })

  const draw = (
    type: TransitionType,
    progress: number,
    frames: [DrawableMediaSource | null, DrawableMediaSource | null] = [outFrame, inFrame]
  ) =>
    drawTransitionWithFrames(
      asCtx(),
      frames[0],
      frames[1],
      transitionOf(type, progress),
      NOW,
      W,
      H
    )

  it('reports failure and draws nothing when neither frame arrived', () => {
    expect(draw('fade', 0.5, [null, null])).toBe(false)
    expect(ctx.calls).toEqual([])
  })

  it('draws only the incoming frame, faded in, when the outgoing is missing', () => {
    expect(draw('fade', 0.25, [null, inFrame])).toBe(true)
    expect(drawnSources()).toEqual([inFrame])
    expect(drawnAlphas()).toEqual([0.25])
  })

  it('draws only the outgoing frame, faded out, when the incoming is missing', () => {
    expect(draw('fade', 0.25, [outFrame, null])).toBe(true)
    expect(drawnSources()).toEqual([outFrame])
    expect(drawnAlphas()).toEqual([0.75])
  })

  it('wipes with the incoming frame alone when the outgoing is missing', () => {
    expect(draw('wipe-left', 0.25, [null, inFrame])).toBe(true)
    expect(ctx.argsFor('rect')).toEqual([[W * 0.75, 0, W * 0.25, H]])
    expect(drawnAlphas()).toEqual([1])
  })

  it('slides the incoming frame in from below when the outgoing is missing', () => {
    expect(draw('slide-up', 0.25, [null, inFrame])).toBe(true)
    expect(ctx.argsFor('drawImage').map((a) => a[2])).toEqual([315 + H * 0.75])
    expect(drawnAlphas()).toEqual([1])
  })

  it('crossfades the two frames', () => {
    draw('fade', 0.25)

    expect(drawnSources()).toEqual([outFrame, inFrame])
    expect(drawnAlphas()).toEqual([0.75, 0.25])
  })

  it('dissolves with a blur that peaks mid-transition', () => {
    draw('dissolve', 0.5)

    expect(ctx.stateFor('drawImage')[0].filter).toBe(`blur(${Math.sin(Math.PI / 2) * 3}px)`)
    expect(drawnAlphas()).toEqual([0.5, 0.5])
  })

  it('dissolves with no blur at the very start', () => {
    draw('dissolve', 0)

    expect(ctx.stateFor('drawImage')[0].filter).toBe('none')
  })

  it('wipes left by shrinking the outgoing region from the right', () => {
    draw('wipe-left', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [0, 0, W * 0.75, H],
      [W * 0.75, 0, W * 0.25, H],
    ])
  })

  it('wipes right by shrinking the outgoing region from the left', () => {
    draw('wipe-right', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [W * 0.25, 0, W * 0.75, H],
      [0, 0, W * 0.25, H],
    ])
  })

  // wipe-up reveals from the bottom and wipe-down from the top, matching the
  // preview player and the element-based renderer above — the same clip must
  // not wipe one way in a WebM export and the other way in an MP4 export.
  it('wipes up by revealing the incoming clip from the bottom', () => {
    draw('wipe-up', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [0, 0, W, H * 0.75],
      [0, H * 0.75, W, H * 0.25],
    ])
  })

  it('wipes down by revealing the incoming clip from the top', () => {
    draw('wipe-down', 0.25)

    expect(ctx.argsFor('rect')).toEqual([
      [0, H * 0.25, W, H * 0.75],
      [0, 0, W, H * 0.25],
    ])
  })

  it('slides left: outgoing exits left, incoming enters from the right', () => {
    draw('slide-left', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[1])).toEqual([
      640 - W * 0.25,
      560 + W * 0.75,
    ])
  })

  it('slides right: outgoing exits right, incoming enters from the left', () => {
    draw('slide-right', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[1])).toEqual([
      640 + W * 0.25,
      560 - W * 0.75,
    ])
  })

  it('slides up: outgoing exits upward, incoming enters from below', () => {
    draw('slide-up', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[2])).toEqual([
      360 - H * 0.25,
      315 + H * 0.75,
    ])
  })

  it('slides down: outgoing exits downward, incoming enters from above', () => {
    draw('slide-down', 0.25)

    expect(ctx.argsFor('drawImage').map((a) => a[2])).toEqual([
      360 + H * 0.25,
      315 - H * 0.75,
    ])
  })

  it('crossfades for a transition type it does not know', () => {
    draw('none', 0.25)

    expect(drawnAlphas()).toEqual([0.75, 0.25])
  })
})
