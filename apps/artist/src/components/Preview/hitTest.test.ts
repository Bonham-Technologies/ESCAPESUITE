// What the preview reports under the pointer, asked directly.
//
// Every point below is given in canvas pixels and divided down into the 0-1
// space hitTestHandles takes, so the arithmetic that matters — the box a clip
// occupies, the tolerance around a handle — stays visible in the test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hitHandlesOnClip, hitTestHandles, type HitTestContext } from './hitTest'
import { HANDLE_SIZE, ROTATION_HANDLE_OFFSET } from './previewGeometry'
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
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
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

  // ESCSUITE-3: a keyframed clip is not manipulable from the canvas while the
  // keyframe panel is closed, but it is not empty space either — it is picked
  // like any other clip, just not moved from here (useTransformHandles.ts
  // refuses the gesture the way it refuses one on a locked track).
  it('treats a keyframed clip as opaque, not as nothing, while the keyframe panel is closed', () => {
    const clip = mediaClip({ animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }) })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'move',
    })
  })

  it('one keyframe on one property is enough to make a clip opaque', () => {
    const clip = mediaClip({ animation: makeAnimation({ keyframes: { opacity: [kf(0, 0.5)] } }) })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))?.clipId).toBe('clip1')
  })

  it('skips a clip whose kind it cannot name', () => {
    // An overlay type this build does not know — a project written by a later
    // one — is manipulable in principle but has no handles to offer.
    const unknown = mediaClip({
      overlayType: 'hologram' as Clip['overlayType'],
      sourceVideoId: 'not-in-the-project',
    })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [unknown] }))).toBeNull()
  })

  it('skips a clip it cannot measure', () => {
    // Text is measured through the canvas' own 2D context; without one there
    // are no bounds to test the point against.
    const text = makeClip({ id: 'text1', duration: 4, overlayType: 'text', textData: makeTextData() })
    failNextGetContext()

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [text] }))).toBeNull()
  })

  it('misses a point the crop took out of the picture (ESCSUITE-6)', () => {
    // The 400x200 source normally covers x 760-1160. Cropped to its right half
    // the drawn box is 200 wide and still centred, so it covers x 860-1060 — and
    // x 800 is now bare canvas even though the uncropped clip reached it.
    const clip = mediaClip({ crop: { left: 0.5, top: 0, right: 0, bottom: 0 } })

    expect(hitAt(800, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })

  it('still reports a move on the body of a cropped clip', () => {
    // The control: without this the case above would pass just as well for a
    // clip that had become unhittable altogether.
    const clip = mediaClip({ crop: { left: 0.5, top: 0, right: 0, bottom: 0 } })

    expect(hitAt(CENTER_X, CENTER_Y, scene({ clips: [clip] }))).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'move',
    })
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

  // ESCSUITE-3: the bug this regression pins was a bare `continue` past a
  // keyframed clip in the z-order loop, which landed the click on whatever
  // was underneath it instead.
  it('does not fall through a keyframed clip to the plain one beneath it', () => {
    const upper = makeTrack({ id: 'track2', index: 5 })
    const plain = mediaClip({ id: 'plain', trackId: track.id })
    const keyframed = mediaClip({
      id: 'keyframed',
      trackId: upper.id,
      animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }),
    })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [plain, keyframed], tracks: [track, upper] }))
        ?.clipId
    ).toBe('keyframed')
  })

  // The converse of the case above: the same loop, the same ordering, so a
  // plain clip on top of a keyframed one still wins. Not a regression this
  // ticket could cause, but worth pinning beside its mirror.
  it('still picks a plain clip on top of a keyframed one beneath it', () => {
    const upper = makeTrack({ id: 'track2', index: 5 })
    const plain = mediaClip({ id: 'plain', trackId: upper.id })
    const keyframed = mediaClip({
      id: 'keyframed',
      trackId: track.id,
      animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }),
    })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [plain, keyframed], tracks: [track, upper] }))
        ?.clipId
    ).toBe('plain')
  })

  // ESCSUITE-155: a clip evaluated fully transparent at the current time does
  // not catch the click — the point falls through to whatever is underneath,
  // the same `continue` the loop already gives a clip of an unknown kind.
  it('falls through a clip animated to opacity 0 to the plain one beneath it', () => {
    const upper = makeTrack({ id: 'track2', index: 5 })
    const plain = mediaClip({ id: 'plain', trackId: track.id })
    const transparent = mediaClip({
      id: 'transparent',
      trackId: upper.id,
      animation: makeAnimation({ keyframes: { opacity: [kf(0, 0)] } }),
    })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [plain, transparent], tracks: [track, upper] }))
        ?.clipId
    ).toBe('plain')
  })

  // The control for the case above: opacity 0 is the only value that falls
  // through — anything above it, however faint, is still picked.
  it('still hits a clip animated to a barely-visible opacity', () => {
    const upper = makeTrack({ id: 'track2', index: 5 })
    const plain = mediaClip({ id: 'plain', trackId: track.id })
    const barelyVisible = mediaClip({
      id: 'barely-visible',
      trackId: upper.id,
      animation: makeAnimation({ keyframes: { opacity: [kf(0, 0.01)] } }),
    })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [plain, barelyVisible], tracks: [track, upper] }))
        ?.clipId
    ).toBe('barely-visible')
  })

  // The static case: pre-existing, not introduced by ESCSUITE-3's keyframed
  // extension — a clip with no animation at all set to opacity 0.
  it('falls through a statically-transparent clip to the plain one beneath it', () => {
    const upper = makeTrack({ id: 'track2', index: 5 })
    const plain = mediaClip({ id: 'plain', trackId: track.id })
    const transparent = mediaClip({
      id: 'transparent',
      trackId: upper.id,
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0 },
    })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [plain, transparent], tracks: [track, upper] }))
        ?.clipId
    ).toBe('plain')
  })

  // ESCSUITE-3 review round 1, MAJOR-1: every case above keyframes a property
  // to its own default value, so the animated position and the base position
  // are the same number and never distinguish "evaluated at the animated
  // position" from "evaluated at the base transform". These two do: each is
  // red if hitTest.ts's `getOverlayBounds(clip, canvas, currentTime, …)` has
  // its `currentTime` argument swapped for `undefined` (which is how
  // getOverlayBounds is told to ignore the animation entirely).
  it('picks a keyframed clip where it is drawn, not where its base transform puts it', () => {
    // x ramps 0.25 -> 0.75 over the 4s clip; at currentTime 1 (a quarter of
    // the way through) it is a quarter of the way there: 0.375. The box is
    // 400px wide (HALF_W 200), so the base position (0.25 * 1920 = 480) is
    // well clear of the animated one (0.375 * 1920 = 720).
    const clip = mediaClip({
      transform: { x: 0.25, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      animation: makeAnimation({ keyframes: { x: [kf(0, 0.25), kf(4, 0.75)] } }),
    })

    expect(hitAt(0.375 * CANVAS_W, CENTER_Y, scene({ clips: [clip] }))?.clipId).toBe('clip1')
    expect(hitAt(0.25 * CANVAS_W, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })

  it('rotates the pointer into a keyframed clip’s animated frame, not its base one', () => {
    // The same 90-degree case as "rotates the pointer into the clip's own
    // frame" above, with the rotation coming from a keyframe (the clip's own
    // transform is unrotated) instead of from the static transform.
    const clip = mediaClip({ animation: makeAnimation({ keyframes: { rotation: [kf(0, 90)] } }) })

    expect(hitAt(CENTER_X, CENTER_Y + 150, scene({ clips: [clip] }))?.mode).toBe('move')
    expect(hitAt(CENTER_X + 150, CENTER_Y, scene({ clips: [clip] }))).toBeNull()
  })
})

describe('hitTestHandles during a transition (ESCSUITE-147)', () => {
  // The clip's last second slides out to the left, so at 3.5s its own animation
  // puts it at x 0.25 (box 280-680) while the renderer — which suppresses the
  // preset the transition owns — draws it at the base 0.5 (box 760-1160).
  const sliding = mediaClip({
    animation: makeAnimation({ out: { type: 'slide-left', duration: 1, easing: 'linear' } }),
  })
  const transition = makeTransitionInfo({
    outgoingClip: sliding,
    incomingClip: mediaClip({ id: 'next', timelinePosition: 4 }),
  })

  it('picks the clip where the transition draws it, not where its out-preset would', () => {
    const inTransition = scene({ clips: [sliding], currentTime: 3.5, transition })

    expect(hitAt(CENTER_X, CENTER_Y, inTransition)?.clipId).toBe('clip1')
    expect(hitAt(0.25 * CANVAS_W, CENTER_Y, inTransition)).toBeNull()
  })

  it('accepts the click on a clip the transition is fading in', () => {
    // A cross-track transition whose incoming clip starts at this very instant,
    // so its clip time is 0 — where a `fade` in-preset's first keyframe reads
    // opacity 0. The renderer suppresses that preset and draws the clip at the
    // transition's own rising alpha, so the opacity gate (ESCSUITE-155) has to
    // read it suppressed too or the clip the viewer can see arriving is
    // unclickable for the whole window.
    const upper = makeTrack({ id: 'track2', index: 5 })
    const arriving = mediaClip({
      id: 'arriving',
      trackId: upper.id,
      timelinePosition: 3.5,
      animation: makeAnimation({ in: { type: 'fade', duration: 1, easing: 'linear' } }),
    })
    const crossTrack = makeTransitionInfo({ outgoingClip: sliding, incomingClip: arriving })
    const scene3 = scene({
      clips: [sliding, arriving],
      tracks: [track, upper],
      currentTime: 3.5,
      transition: crossTrack,
    })

    expect(hitAt(CENTER_X, CENTER_Y, scene3)?.clipId).toBe('arriving')
  })

  it('still refuses the click on a transparent clip with no transition over it', () => {
    // The ESCSUITE-155 gate itself, unchanged: the same clip at the same instant
    // with no transition handed over keeps its in-preset, evaluates to 0 and is
    // passed over for the clip beneath it.
    const upper = makeTrack({ id: 'track2', index: 5 })
    const arriving = mediaClip({
      id: 'arriving',
      trackId: upper.id,
      timelinePosition: 3.5,
      animation: makeAnimation({ in: { type: 'fade', duration: 1, easing: 'linear' } }),
    })
    const plain = mediaClip({ id: 'beneath' })

    expect(
      hitAt(CENTER_X, CENTER_Y, scene({
        clips: [plain, arriving],
        tracks: [track, upper],
        currentTime: 3.5,
      }))?.clipId
    ).toBe('beneath')
  })

  it('picks it at the preset’s own position when no transition owns that side', () => {
    const outsideTransition = scene({ clips: [sliding], currentTime: 3.5 })

    expect(hitAt(0.25 * CANVAS_W, CENTER_Y, outsideTransition)?.clipId).toBe('clip1')
    expect(hitAt(CENTER_X, CENTER_Y, outsideTransition)).toBeNull()
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

  // ESCSUITE-178: a clip on a hidden track takes no picture in the frame, so
  // the selected clip's own handle cascade — the one pass hitHandlesOnClip
  // feeds directly, with no z-order filtering of its own — has to ask the
  // same question the second pass' getClipsAtTime already does. Nothing
  // underneath it either, since there is only the one clip in this scene.
  it('offers no handles, and no body hit, on a selected clip whose track is hidden', () => {
    const hiddenTrack = makeTrack({ id: 'track2', visible: false })
    const onHiddenTrack = scene({
      clips: [mediaClip({ trackId: 'track2' })],
      tracks: [track, hiddenTrack],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, onHiddenTrack)).toBeNull()
    expect(hitAt(CENTER_X, CENTER_Y, onHiddenTrack)).toBeNull()
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

  it('offers no handles on a selected clip with custom keyframes, but still its body (ESCSUITE-3)', () => {
    const keyframed = scene({
      clips: [mediaClip({ animation: makeAnimation({ keyframes: { x: [kf(0, 0.5)] } }) })],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, keyframed)).toBeNull()
    // The first pass (handles on the selected clip) still declines it; the
    // body hit comes from the second pass, which now treats it like any other
    // clip rather than invisible to the pointer.
    expect(hitAt(CENTER_X, CENTER_Y, keyframed)).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'move',
    })
  })

  // ESCSUITE-155 review, MINOR-2: the opacity skip added to the second pass'
  // all-clips body loop must not leak into the first pass' handle cascade on
  // the *selected* clip — selectionOverlay.ts draws its chrome regardless of
  // opacity, so the resize/rotate handles it draws have to stay grabbable.
  it('still offers handles on a selected clip evaluated fully transparent', () => {
    const transparent = scene({
      clips: [
        mediaClip({
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0 },
        }),
      ],
      selectedClipId: 'clip1',
    })

    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, transparent)).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'rotate',
    })
    expect(hitAt(CENTER_X - HALF_W, CENTER_Y - HALF_H, transparent)?.mode).toBe('resize-nw')
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

  // ESCSUITE-178: this pass restricts interaction to the selected clip alone,
  // so a hidden track leaves nothing at all for the pointer to find here —
  // there is no second pass to fall through to while the panel is open.
  it('ignores a click when the selected clip’s track is hidden', () => {
    const hiddenTrack = makeTrack({ id: 'track2', visible: false })
    const onHiddenTrack = open({
      clips: [{ ...keyframed, trackId: 'track2' }],
      tracks: [track, hiddenTrack],
    })

    expect(hitAt(CENTER_X, CENTER_Y, onHiddenTrack)).toBeNull()
  })

  it('falls back to the normal passes when nothing is selected', () => {
    expect(
      hitAt(CENTER_X, CENTER_Y, scene({ clips: [mediaClip()], keyframePanelOpen: true }))?.mode
    ).toBe('move')
  })
})

describe('hitHandlesOnClip', () => {
  /** Run the cascade on a point given in canvas pixels. */
  const cascade = (
    x: number,
    y: number,
    context: HitTestContext,
    options: { skipKeyframed: boolean; includeBody: boolean }
  ) => hitHandlesOnClip('clip1', x, y, canvas, context, options)

  const both = { skipKeyframed: false, includeBody: true }
  const handlesOnly = { skipKeyframed: true, includeBody: false }

  it('finds nothing for a clip id that is not in the scene', () => {
    expect(cascade(CENTER_X, CENTER_Y, scene(), both)).toBeNull()
  })

  // ESCSUITE-178: a clip on a hidden track takes no picture in the frame, the
  // same question getClipsAtTime asks before drawing a clip at all.
  it('finds nothing for a clip on a hidden track', () => {
    const hiddenTrack = makeTrack({ id: 'track2', visible: false })
    const clip = mediaClip({ trackId: 'track2' })

    expect(cascade(CENTER_X, CENTER_Y, scene({ clips: [clip], tracks: [track, hiddenTrack] }), both))
      .toBeNull()
  })

  it('finds nothing for a clip whose track is gone', () => {
    const clip = mediaClip({ trackId: 'missing' })

    expect(cascade(CENTER_X, CENTER_Y, scene({ clips: [clip] }), both)).toBeNull()
  })

  it('finds nothing for a clip with no manipulable type', () => {
    // An audio clip has no box to put handles around.
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })
    const clip = mediaClip({ sourceVideoId: 'audio1' })

    expect(cascade(CENTER_X, CENTER_Y, scene({ clips: [clip], sourceVideos: [audio] }), both))
      .toBeNull()
  })

  it('finds nothing while the clip is off screen', () => {
    const clip = mediaClip({ timelinePosition: 10 })

    expect(cascade(CENTER_X, CENTER_Y, scene({ clips: [clip] }), both)).toBeNull()
  })

  it('finds nothing for a clip it cannot measure', () => {
    // Text needs the canvas' 2D context to measure; without one there is no box.
    const text = makeClip({ id: 'clip1', duration: 4, overlayType: 'text', textData: makeTextData() })
    failNextGetContext()

    expect(cascade(CENTER_X, CENTER_Y, scene({ clips: [text] }), both)).toBeNull()
  })

  it('walks rotation handle, corners and edges in that order', () => {
    const context = scene({ clips: [mediaClip()] })

    expect(cascade(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, context, both)?.mode)
      .toBe('rotate')
    expect(cascade(CENTER_X - HALF_W, CENTER_Y - HALF_H, context, both)?.mode).toBe('resize-nw')
    expect(cascade(CENTER_X + HALF_W, CENTER_Y + HALF_H, context, both)?.mode).toBe('resize-se')
    expect(cascade(CENTER_X, CENTER_Y - HALF_H, context, both)?.mode).toBe('resize-n')
    expect(cascade(CENTER_X + HALF_W, CENTER_Y, context, both)?.mode).toBe('resize-e')
  })

  it('names the clip and its type on every hit', () => {
    const context = scene({ clips: [mediaClip()] })

    expect(cascade(CENTER_X + HALF_W, CENTER_Y, context, both)).toEqual({
      clipId: 'clip1',
      clipType: 'video',
      mode: 'resize-e',
    })
  })

  it('counts the body as a move only when the caller asks for it', () => {
    const context = scene({ clips: [mediaClip()] })

    expect(cascade(CENTER_X, CENTER_Y, context, both)?.mode).toBe('move')
    expect(cascade(CENTER_X, CENTER_Y, context, handlesOnly)).toBeNull()
  })

  it('skips a keyframed clip only when the caller asks it to', () => {
    const clip = mediaClip({
      animation: makeAnimation({ keyframes: { x: [kf(0, 0.5), kf(4, 0.5)] } }),
    })
    const context = scene({ clips: [clip] })
    const edge = CENTER_X + HALF_W

    expect(cascade(edge, CENTER_Y, context, { skipKeyframed: false, includeBody: false })?.mode)
      .toBe('resize-e')
    expect(cascade(edge, CENTER_Y, context, handlesOnly)).toBeNull()
  })

  it('finds nothing when the point misses the box entirely', () => {
    const context = scene({ clips: [mediaClip()] })

    expect(cascade(CENTER_X + HALF_W + HANDLE_SIZE * 2, CENTER_Y, context, both)).toBeNull()
  })
})

// ESCSUITE-90: the handles are a constant size on screen, so the zones around
// them are the constants multiplied by the project pixels per CSS pixel the
// caller passes. The tolerances at the default scale are pinned by the
// "keeps the corner tolerance at 1.5 handles" test above.
describe('the handle zones at a screen scale', () => {
  const selected = scene({ clips: [mediaClip()], selectedClipId: 'clip1' })
  const SCALE = 4

  /** Hit-test a point in canvas pixels against a chrome drawn at `screenScale`. */
  const hitAtScale = (x: number, y: number, context: HitTestContext, screenScale: number) =>
    hitTestHandles(x / CANVAS_W, y / CANVAS_H, canvas, context, canvas, screenScale)

  it('widens the corner zone with the screen scale', () => {
    // 8 * 1.5 * 4 = 48 project px around the corner, where the default is 12.
    expect(hitAtScale(CENTER_X - HALF_W - 40, CENTER_Y - HALF_H, selected, SCALE)?.mode)
      .toBe('resize-nw')
    expect(hitAtScale(CENTER_X - HALF_W - 50, CENTER_Y - HALF_H, selected, SCALE)).toBeNull()
    expect(hitAt(CENTER_X - HALF_W - 40, CENTER_Y - HALF_H, selected)).toBeNull()
  })

  it('lifts the rotation grip with the screen scale', () => {
    expect(hitAtScale(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET * SCALE, selected, SCALE)
      ?.mode).toBe('rotate')
    // Where the grip sits at the default scale it is no longer the grip — 25
    // project px above the border is now well inside the top edge's zone.
    expect(hitAtScale(CENTER_X, CENTER_Y - HALF_H - ROTATION_HANDLE_OFFSET, selected, SCALE)?.mode)
      .toBe('resize-n')
  })

  it('widens the edge zone with the screen scale', () => {
    // 8 * 1.2 * 4 = 38.4 project px either side of the border, where the
    // default 9.6 leaves 12px above it in the gap below the grip's own zone.
    expect(hitAtScale(CENTER_X, CENTER_Y - HALF_H - 12, selected, SCALE)?.mode).toBe('resize-n')
    expect(hitAt(CENTER_X, CENTER_Y - HALF_H - 12, selected)).toBeNull()
  })

  it('reaches hitHandlesOnClip, which hitTestHandles’ own keyframe-mode pass calls first', () => {
    const context = scene({ clips: [mediaClip()] })
    const options = { skipKeyframed: false, includeBody: true }

    expect(
      hitHandlesOnClip(
        'clip1', CENTER_X - HALF_W - 40, CENTER_Y - HALF_H, canvas, context, options, canvas, SCALE
      )?.mode
    ).toBe('resize-nw')
    expect(
      hitHandlesOnClip(
        'clip1', CENTER_X - HALF_W - 40, CENTER_Y - HALF_H, canvas, context, options
      )
    ).toBeNull()
  })
})
