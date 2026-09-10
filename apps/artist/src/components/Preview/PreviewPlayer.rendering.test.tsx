// What PreviewPlayer actually paints: the ordered canvas calls of a composited
// frame, and the drawing state each call was made with.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import {
  audioSource,
  imageSource,
  installPreviewDoubles,
  last,
  renderPreview,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { getFrameCache, resetFrameCache } from '../../core/frameCache'
import { getVideoBlob } from '../../core/storage'
import type { Clip, ShapeOverlayData, TextOverlayData, TransitionType } from '../../store/types'
import { PreviewPlayer } from './PreviewPlayer'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** One animation frame at 60Hz. */
const FRAME = 16

/**
 * Adding an overlay selects it, and a selected clip is drawn with handles on
 * top. These tests are about the overlay itself, so they start from nothing
 * selected; the handles have their own file.
 */
const addText = (data: Partial<TextOverlayData>, duration = 4): Clip => {
  const clip = store().addTextOverlayClip(data, undefined, 0, duration)
  store().setSelectedClipId(null)
  return clip
}

const addShape = (data: Partial<ShapeOverlayData>, duration = 4): Clip => {
  const clip = store().addShapeOverlayClip(data, undefined, 0, duration)
  store().setSelectedClipId(null)
  return clip
}

/** Put a media clip of a non-video source on the first track. */
const addMediaClip = (id: string, sourceVideoId: string, duration = 4): void => {
  store().addClipToTimeline(
    { id, sourceVideoId, name: id, startTime: 0, endTime: duration, duration },
    store().project.timeline.tracks[0].id,
    0
  )
}

describe('PreviewPlayer drawing', () => {
  it('clears to black and draws the one active video clip at native size', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview()
    const frame = preview.frame()

    expect(frame.methods).toEqual(['setTransform', 'fillRect', 'save', 'drawImage', 'restore'])
    const [clear] = frame.of('fillRect')
    expect(clear.args).toEqual([0, 0, 1920, 1080])
    expect(clear.state.fillStyle).toBe('#000000')
    // Scale 1 means native source pixels, centred on the canvas.
    const [draw] = frame.of('drawImage')
    expect(draw.args.slice(1)).toEqual([0, 0, 1920, 1080])
    expect(draw.args[0]).toBe(doubles.media.videos[0])
  })

  it('draws an image clip from the <img> element at its natural size', async () => {
    store().addSourceVideo(imageSource)
    addMediaClip('pic', imageSource.id)

    const preview = await renderPreview()

    const [draw] = preview.frame().of('drawImage')
    expect(draw.args[0]).toBe(doubles.media.images[0])
    // 800x600 centred on a 1920x1080 canvas.
    expect(draw.args.slice(1)).toEqual([560, 240, 800, 600])
  })

  it('never draws an audio clip', async () => {
    store().addSourceVideo(audioSource)
    addMediaClip('song', audioSource.id)

    const preview = await renderPreview()

    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })

  it('draws stacked tracks bottom track first', async () => {
    const bottom = store().project.timeline.tracks[0].id
    const top = store().addTrack('Top').id
    addClip('lower', 0, 2, bottom)
    addClip('upper', 0, 2, top)
    // Distinguish the two draws by size.
    store().updateClipTransform('upper', { scaleX: 0.5, scaleY: 0.5 })

    const preview = await renderPreview()

    const widths = preview.frame().argsFor('drawImage').map((args) => args[3])
    expect(widths).toEqual([1920, 960])
  })

  it('skips clips on a hidden track', async () => {
    const trackId = store().project.timeline.tracks[0].id
    addClip('clip1', 0, 2, trackId)
    store().updateTrack(trackId, { visible: false })

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')).toHaveLength(0)
  })

  it('applies opacity, blend mode, blur and rotation to the clip it draws', async () => {
    addClip('clip1', 0, 2)
    store().updateClipTransform('clip1', { opacity: 0.4, rotation: 90, scaleX: 2, scaleY: 2 })
    store().updateClipBlendMode('clip1', 'multiply')
    store().updateClipEffects('clip1', { blur: 6 })

    const preview = await renderPreview()
    const frame = preview.frame()

    const [draw] = frame.of('drawImage')
    expect(draw.state.globalAlpha).toBe(0.4)
    expect(draw.state.globalCompositeOperation).toBe('multiply')
    expect(draw.state.filter).toBe('blur(6px)')
    // Rotation happens about the clip centre.
    expect(frame.argsFor('translate')).toEqual([
      [960, 540],
      [-960, -540],
    ])
    expect(frame.argsFor('rotate')).toEqual([[Math.PI / 2]])
    // scale 2 on a 1920x1080 source, still centred.
    expect(draw.args.slice(1)).toEqual([-960, -540, 3840, 2160])
  })

  it('leaves the filter off when the clip has no blur', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')[0].state.filter).toBe('none')
  })

  it('draws nothing but black when the playhead sits in a gap', async () => {
    addClip('clip1', 0, 2)
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(5)
    await settle(FRAME)

    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })
})

describe('PreviewPlayer overlay drawing', () => {
  it('draws a text overlay clip line by line with its font and colour', async () => {
    addText({ text: 'Hello\nWorld', color: '#ff0000', fontSize: 50 })

    const preview = await renderPreview()

    const [first, second] = preview.frame().of('fillText')
    expect(first.args).toEqual(['Hello', 960, 510])
    expect(second.args).toEqual(['World', 960, 570])
    expect(first.state.font).toBe('50px Arial')
    expect(first.state.fillStyle).toBe('#ff0000')
    expect(first.state.textAlign).toBe('center')
  })

  it('spells bold italic text into the font string', async () => {
    addText({ text: 'Loud', fontWeight: 'bold', fontStyle: 'italic', fontSize: 20 })

    const preview = await renderPreview()

    expect(preview.frame().of('fillText')[0].state.font).toBe('italic bold 20px Arial')
  })

  it('paints the text background box behind the lines when one is set', async () => {
    addText({ text: 'Hi', backgroundColor: '#00000080', fontSize: 100, textAlign: 'center' })

    const preview = await renderPreview()
    const frame = preview.frame()

    // The double measures every string at 100px; padding is fontSize * 0.3.
    const [, background] = frame.of('fillRect')
    expect(background.args).toEqual([880, 450, 160, 180])
    expect(background.state.fillStyle).toBe('#00000080')
    expect(frame.methods.indexOf('fillText')).toBeGreaterThan(frame.methods.lastIndexOf('fillRect'))
  })

  it('anchors the background box to the left or right edge of aligned text', async () => {
    addText({ text: 'Hi', backgroundColor: '#000000ff', fontSize: 100, textAlign: 'left' })

    const preview = await renderPreview()
    expect(preview.frame().of('fillRect')[1].args).toEqual([930, 450, 160, 180])

    store().updateTextOverlayData(store().project.timeline.clips[0].id, { textAlign: 'right' })
    preview.clearCalls()
    await settle(60)
    expect(preview.frame().of('fillRect')[1].args).toEqual([830, 450, 160, 180])
  })

  it('rotates and scales a text overlay about its own position', async () => {
    addText({ text: 'Spin', rotation: 180, scale: 2 })

    const preview = await renderPreview()
    const frame = preview.frame()

    expect(frame.argsFor('rotate')).toEqual([[Math.PI]])
    expect(frame.argsFor('scale')).toEqual([[2, 2]])
    expect(frame.argsFor('translate')).toEqual([
      [960, 540],
      [-960, -540],
    ])
  })

  it('blurs a text overlay whose blur effect is animated on', async () => {
    const clip = addText({ text: 'Fuzzy' })
    store().updateClipEffects(clip.id, { blur: 4 })

    const preview = await renderPreview()

    expect(preview.frame().of('fillText')[0].state.filter).toBe('blur(4px)')
  })

  it('draws a rectangle shape overlay with its fill and stroke', async () => {
    addShape({ type: 'rectangle', fillColor: '#123456ff', strokeColor: '#abcdef', strokeWidth: 4 })

    const preview = await renderPreview()
    const frame = preview.frame()

    const [, fill] = frame.of('fillRect')
    expect(fill.args).toEqual([768, 432, 384, 216])
    expect(fill.state.fillStyle).toBe('#123456ff')
    const [stroke] = frame.of('strokeRect')
    expect(stroke.args).toEqual([768, 432, 384, 216])
    expect(stroke.state.strokeStyle).toBe('#abcdef')
    expect(stroke.state.lineWidth).toBe(4)
  })

  it('skips the fill of a fully transparent shape but still strokes it', async () => {
    addShape({ type: 'rectangle', fillColor: '#12345600', strokeWidth: 2 })

    const preview = await renderPreview()
    const frame = preview.frame()

    // Only the frame's own black clear — no shape fill.
    expect(frame.of('fillRect')).toHaveLength(1)
    expect(frame.of('strokeRect')).toHaveLength(1)
  })

  it('draws an ellipse shape as a path', async () => {
    addShape({ type: 'ellipse', fillColor: '#ffffffff', strokeWidth: 1 })

    const preview = await renderPreview()
    const frame = preview.frame()

    expect(frame.argsFor('ellipse')).toEqual([[960, 540, 192, 108, 0, 0, Math.PI * 2]])
    expect(frame.of('fill')).toHaveLength(1)
    expect(frame.of('stroke')).toHaveLength(1)
  })

  it('draws a line shape as a single stroked segment', async () => {
    addShape({ type: 'line', strokeWidth: 3 })

    const preview = await renderPreview()
    const frame = preview.frame()

    expect(frame.argsFor('moveTo')).toEqual([[768, 540]])
    expect(frame.argsFor('lineTo')).toEqual([[1152, 540]])
  })

  it('draws an arrow shape as a shaft plus a filled head', async () => {
    addShape({ type: 'arrow', strokeWidth: 3 })

    const preview = await renderPreview()
    const frame = preview.frame()

    // arrowSize = min(384, 216) * 0.2 = 43.2
    expect(frame.argsFor('moveTo')).toEqual([
      [768, 540],
      [1152, 540],
    ])
    expect(frame.argsFor('lineTo')).toEqual([
      [1108.8, 540],
      [1108.8, 518.4],
      [1108.8, 561.6],
    ])
    expect(frame.of('closePath')).toHaveLength(1)
    expect(frame.of('fill')).toHaveLength(1)
  })

  it('blurs the frame underneath a blur shape through a clipped copy', async () => {
    addClip('clip1', 0, 4)
    addShape({ type: 'blur' })

    const preview = await renderPreview()
    const frame = preview.frame()

    // The offscreen copy is a separate canvas: the main context only sees the
    // clip path, the identity transform, and the blurred draw-back.
    expect(frame.of('clip')).toHaveLength(1)
    const drawBack = last(frame.of('drawImage'))
    expect(drawBack.args.slice(1)).toEqual([0, 0])
    expect(drawBack.state.filter).toBe('blur(10px)')
    expect(frame.argsFor('setTransform').slice(1)).toEqual([[1, 0, 0, 1, 0, 0]])
  })

  it('blurs behind a rectangle shape that asks for it, then fills over the top', async () => {
    addClip('clip1', 0, 4)
    addShape({ type: 'rectangle', blurAmount: 5, fillColor: '#ffffff40' })

    const preview = await renderPreview()
    const frame = preview.frame()

    expect(frame.argsFor('rect')).toEqual([[768, 432, 384, 216]])
    expect(frame.of('clip')).toHaveLength(1)
    expect(last(frame.of('drawImage')).state.filter).toBe('blur(5px)')
    expect(last(frame.of('fillRect')).state.fillStyle).toBe('#ffffff40')
  })

  it('blurs a shape overlay whose blur effect is animated on', async () => {
    const clip = addShape({ type: 'rectangle', fillColor: '#ffffffff' })
    store().updateClipEffects(clip.id, { blur: 7 })

    const preview = await renderPreview()

    expect(last(preview.frame().of('fillRect')).state.filter).toBe('blur(7px)')
  })

  it('honours a shape overlay rotation', async () => {
    addShape({ type: 'rectangle', rotation: 90 })

    const preview = await renderPreview()

    expect(preview.frame().argsFor('rotate')).toEqual([[Math.PI / 2]])
  })

  it('rotates the clip region of a blur shape but not the content it blurs', async () => {
    addClip('clip1', 0, 4)
    addShape({ type: 'blur', rotation: 45 })

    const preview = await renderPreview()
    const frame = preview.frame()

    // Once for the clip path, once for the (empty) fill pass that follows.
    expect(frame.argsFor('rotate')).toEqual([[Math.PI / 4], [Math.PI / 4]])
    // The transform is reset to the identity after the clip path is set, so the
    // blurred copy goes back unrotated.
    expect(frame.methods.indexOf('setTransform', 1)).toBeGreaterThan(
      frame.methods.indexOf('clip')
    )
  })

  it('animates an overlay with its keyframes', async () => {
    const clip = addShape({ type: 'rectangle' })
    store().setClipKeyframe(clip.id, 'x', { time: 0, value: 0.25, easing: 'linear' })
    store().setClipKeyframe(clip.id, 'x', { time: 4, value: 0.75, easing: 'linear' })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(2)
    await settle(FRAME)

    // Halfway through a linear x tween: centre back at 0.5 → 960px.
    expect(last(preview.frame().of('fillRect')).args).toEqual([768, 432, 384, 216])
  })

  it('scales a shape overlay by its animated scale', async () => {
    const clip = addShape({ type: 'rectangle' })
    store().setClipKeyframe(clip.id, 'scaleX', { time: 0, value: 2, easing: 'linear' })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)
    await settle(FRAME)

    expect(last(preview.frame().of('fillRect')).args).toEqual([576, 432, 768, 216])
  })

  it('leaves the text being inline-edited out of the frame', async () => {
    addText({ text: 'Editing' })

    const preview = await renderPreview()
    expect(preview.frame().of('fillText')).toHaveLength(1)

    fireEvent.doubleClick(preview.canvas, preview.at(960, 540))
    await settle(FRAME)
    preview.clearCalls()
    store().setCurrentTime(1)
    await settle(FRAME)

    expect(preview.frame().of('fillText')).toHaveLength(0)
  })
})

describe('PreviewPlayer legacy overlay arrays', () => {
  it('draws a legacy text overlay while the playhead is inside its window', async () => {
    addClip('clip1', 0, 4)
    store().addTextOverlay({ text: 'Legacy', startTime: 0, endTime: 2, x: 0.25, y: 0.5, opacity: 0.5 })

    const preview = await renderPreview()

    const [text] = preview.frame().of('fillText')
    expect(text.args[0]).toBe('Legacy')
    expect(text.args[1]).toBe(480)
    expect(text.state.globalAlpha).toBe(0.5)
  })

  it('gives a legacy text overlay its background box', async () => {
    addClip('clip1', 0, 4)
    store().addTextOverlay({
      text: 'Legacy',
      startTime: 0,
      endTime: 2,
      backgroundColor: '#112233ff',
      fontSize: 100,
      textAlign: 'right',
    })

    const preview = await renderPreview()
    expect(preview.frame().of('fillRect')[1].args).toEqual([830, 450, 160, 180])
    expect(preview.frame().of('fillRect')[1].state.fillStyle).toBe('#112233ff')

    store().updateTextOverlay(store().project.timeline.textOverlays[0].id, { textAlign: 'center' })
    preview.clearCalls()
    await settle(60)
    expect(preview.frame().of('fillRect')[1].args).toEqual([880, 450, 160, 180])
  })

  it('drops a legacy text overlay once the playhead passes its end', async () => {
    addClip('clip1', 0, 4)
    store().addTextOverlay({ text: 'Legacy', startTime: 0, endTime: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(2)
    await settle(FRAME)

    expect(preview.frame().of('fillText')).toHaveLength(0)
  })

  it('draws every legacy shape type', async () => {
    addClip('clip1', 0, 8)
    const shape = store().addShapeOverlay({ type: 'ellipse', startTime: 0, endTime: 8, strokeWidth: 2 })

    const preview = await renderPreview()
    expect(preview.frame().of('ellipse')).toHaveLength(1)
    expect(preview.frame().of('stroke')).toHaveLength(1)

    for (const type of ['rectangle', 'line', 'arrow'] as const) {
      store().updateShapeOverlay(shape.id, { type })
      preview.clearCalls()
      await settle(60)
      const frame = preview.frame()
      if (type === 'rectangle') expect(frame.of('strokeRect')).toHaveLength(1)
      if (type === 'line') expect(frame.argsFor('lineTo')).toHaveLength(1)
      if (type === 'arrow') expect(frame.of('closePath')).toHaveLength(1)
    }
  })

  it('rotates a legacy shape overlay', async () => {
    addClip('clip1', 0, 4)
    store().addShapeOverlay({ type: 'rectangle', startTime: 0, endTime: 4, rotation: 90 })

    const preview = await renderPreview()

    expect(preview.frame().argsFor('rotate')).toEqual([[Math.PI / 2]])
  })
})

describe('PreviewPlayer transitions', () => {
  /** Two adjacent clips on one track, the first transitioning into the second. */
  const twoClips = (type: TransitionType) => {
    const trackId = store().project.timeline.tracks[0].id
    addClip('a', 0, 2, trackId)
    addClip('b', 2, 2, trackId)
    store().updateClipTransition('a', { type, duration: 1 })
  }

  it('crossfades the outgoing and incoming clips over the transition window', async () => {
    twoClips('fade')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([0.5, 0.5])
  })

  it('runs the crossfade from fully outgoing to fully incoming', async () => {
    twoClips('fade')

    const preview = await renderPreview()

    preview.clearCalls()
    store().setCurrentTime(1)
    await settle(FRAME)
    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([1, 0])

    preview.clearCalls()
    store().setCurrentTime(1.999)
    await settle(FRAME)
    const [out, incoming] = preview.frame().of('drawImage').map((c) => c.state.globalAlpha)
    expect(out).toBeCloseTo(0.001, 3)
    expect(incoming).toBeCloseTo(0.999, 3)
  })

  it('wraps a dissolve in its own blurred save/restore', async () => {
    twoClips('dissolve')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)
    const frame = preview.frame()

    // sin(0.5π) * 3 = 3px, set on the outer save() that wraps both draws.
    expect(frame.of('save')).toHaveLength(3)
    expect(frame.of('restore')).toHaveLength(3)
    expect(frame.of('drawImage').map((c) => c.state.globalAlpha)).toEqual([0.5, 0.5])
  })

  it('splits the canvas between the clips for a wipe', async () => {
    twoClips('wipe-left')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.25)
    await settle(FRAME)
    const frame = preview.frame()

    expect(frame.argsFor('rect')).toEqual([
      [0, 0, 1440, 1080],
      [1440, 0, 480, 1080],
    ])
    expect(frame.of('clip')).toHaveLength(2)
  })

  it('splits the canvas the other way for wipe-right', async () => {
    twoClips('wipe-right')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.25)
    await settle(FRAME)

    expect(preview.frame().argsFor('rect')).toEqual([
      [480, 0, 1440, 1080],
      [0, 0, 480, 1080],
    ])
  })

  it('wipes vertically for wipe-up and wipe-down', async () => {
    twoClips('wipe-up')
    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.25)
    await settle(FRAME)
    expect(preview.frame().argsFor('rect')).toEqual([
      [0, 0, 1920, 810],
      [0, 810, 1920, 270],
    ])

    store().updateClipTransition('a', { type: 'wipe-down' })
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME)
    expect(preview.frame().argsFor('rect')).toEqual([
      [0, 540, 1920, 540],
      [0, 0, 1920, 540],
    ])
  })

  it('offsets both clips horizontally for a slide', async () => {
    twoClips('slide-left')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    // offsetX -960 for the outgoing clip, +960 for the incoming one.
    expect(preview.frame().argsFor('drawImage').map((args) => args[1])).toEqual([-960, 960])
  })

  it('offsets both clips vertically for slide-up', async () => {
    twoClips('slide-up')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    expect(preview.frame().argsFor('drawImage').map((args) => args[2])).toEqual([-540, 540])
  })

  it('slides the other way for slide-right and slide-down', async () => {
    twoClips('slide-right')
    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME)
    expect(preview.frame().argsFor('drawImage').map((args) => args[1])).toEqual([960, -960])

    store().updateClipTransition('a', { type: 'slide-down' })
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME)
    expect(preview.frame().argsFor('drawImage').map((args) => args[2])).toEqual([540, -540])
  })

  it('draws both clips untouched when the transition type is unknown', async () => {
    twoClips('none')
    store().updateClipTransition('a', { type: 'iris' as TransitionType, duration: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    const draws = preview.frame().of('drawImage')
    expect(draws).toHaveLength(2)
    expect(draws.map((d) => d.state.globalAlpha)).toEqual([1, 1])
  })

  it('transitions into the top-most clip on another track when the track has none', async () => {
    const lower = store().project.timeline.tracks[0].id
    const upper = store().addTrack('Upper').id
    addClip('a', 0, 2, upper)
    addClip('b', 0, 4, lower)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([0.5, 0.5])
  })

  it('takes the earliest of the clips queued behind the outgoing one', async () => {
    const track = store().project.timeline.tracks[0].id
    addClip('a', 0, 2, track)
    addClip('b', 2, 2, track)
    addClip('c', 4, 2, track)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })
    store().updateClipTransform('b', { scaleX: 0.5, scaleY: 0.5 })

    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME)

    // b, drawn at half size, is the incoming clip — not the later c.
    expect(preview.frame().argsFor('drawImage').map((args) => args[3])).toEqual([1920, 960])
  })

  it('takes the top-most of the clips visible on other tracks', async () => {
    const low = store().project.timeline.tracks[0].id
    const mid = store().addTrack('Mid').id
    const high = store().addTrack('High').id
    addClip('a', 0, 2, high)
    addClip('low', 0, 4, low)
    addClip('mid', 0, 4, mid)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })
    store().updateClipTransform('mid', { scaleX: 0.5, scaleY: 0.5 })

    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME)

    // The clip on the higher of the two remaining tracks wins the transition,
    // and is the half-size one drawn last.
    expect(last(preview.frame().argsFor('drawImage'))[3]).toBe(960)
  })

  it('ignores a transition with no clip to transition into', async () => {
    addClip('a', 0, 2)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([1])
  })
})

describe('PreviewPlayer letterboxing', () => {
  it('maps a click through the pillarbox when the element is wider than the frame', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 1000, height: 540 } })

    // 40px of pillarbox split either side of a 960px-wide rendered frame.
    expect(preview.at(0, 0)).toEqual({ clientX: 20, clientY: 0 })
    expect(preview.at(1920, 1080)).toEqual({ clientX: 980, clientY: 540 })
  })

  it('maps a click through the letterbox when the element is taller than the frame', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 960, height: 600 } })

    expect(preview.at(0, 0)).toEqual({ clientX: 0, clientY: 30 })
    expect(preview.at(1920, 1080)).toEqual({ clientX: 960, clientY: 570 })
  })
})

describe('PreviewPlayer frame cache', () => {
  const fakeBitmap = () => ({ width: 1920, height: 1080, close: vi.fn() }) as unknown as ImageBitmap

  it('serves a cached frame instead of recomposing it', async () => {
    addText({ text: 'Cached' })

    const preview = await renderPreview()
    getFrameCache().set(0, fakeBitmap())

    // Renaming a track re-runs the redraw effects without changing anything the
    // cache key covers, so the debounced redraw finds the frame still cached.
    preview.clearCalls()
    store().updateTrack(store().project.timeline.tracks[0].id, { name: 'Renamed' })
    await settle()
    expect(preview.frame().of('fillText')).toHaveLength(1)

    preview.clearCalls()
    await settle(60)

    expect(preview.methods()).toEqual(['drawImage'])
    expect(preview.calls('drawImage')[0].args).toEqual([
      getFrameCache().get(0),
      0,
      0,
      1920,
      1080,
    ])
  })

  it('drops cached frames when the timeline content changes', async () => {
    addClip('clip1', 0, 4)

    await renderPreview()
    getFrameCache().set(0, fakeBitmap())
    expect(getFrameCache().has(0)).toBe(true)

    store().updateClipTransform('clip1', { x: 0.25 })
    await settle(FRAME)

    expect(getFrameCache().has(0)).toBe(false)
  })
})

describe('PreviewPlayer media loading', () => {
  it('shows the spinner until the media blobs resolve', async () => {
    addClip('clip1', 0, 2)
    let release: (blob: Blob) => void = () => {}
    vi.mocked(getVideoBlob).mockReturnValueOnce(
      new Promise<Blob>((resolve) => {
        release = resolve
      })
    )

    render(<PreviewPlayer />)
    await settle()

    expect(screen.getByText('Loading videos...')).toBeInTheDocument()

    await act(async () => {
      release(new Blob(['v'], { type: 'video/mp4' }))
      await vi.advanceTimersByTimeAsync(60)
    })

    expect(screen.queryByText('Loading videos...')).not.toBeInTheDocument()
  })

  it('keeps going when a source blob is missing', async () => {
    addClip('clip1', 0, 2)
    vi.mocked(getVideoBlob).mockResolvedValueOnce(undefined)

    const preview = await renderPreview()

    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })

  it('reports a failed media load and still draws the frame', async () => {
    addClip('clip1', 0, 2)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getVideoBlob).mockRejectedValueOnce(new Error('quota'))

    const preview = await renderPreview()

    expect(consoleError).toHaveBeenCalledWith('Failed to load media:', expect.any(Error))
    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
    consoleError.mockRestore()
  })

  it('reuses the element it already made for a source when a clip is added', async () => {
    addClip('clip1', 0, 2)
    const preview = await renderPreview()
    const firstVideo = doubles.media.videos[0]

    addClip('clip2', 2, 2)
    await settle(60)

    expect(doubles.media.videos).toHaveLength(1)
    expect(doubles.media.videos[0]).toBe(firstVideo)
    expect(preview.frame().of('drawImage')).toHaveLength(1)
  })

  it('keeps the image it already loaded when another image joins the timeline', async () => {
    store().addSourceVideo(imageSource)
    addMediaClip('pic', imageSource.id)

    await renderPreview()
    const firstImage = doubles.media.images[0]

    const second = { ...imageSource, id: 'image2', name: 'other.png' }
    store().addSourceVideo(second)
    store().addClipToTimeline(
      { id: 'pic2', sourceVideoId: second.id, name: 'pic2', startTime: 0, endTime: 4, duration: 4 },
      store().addTrack('Second').id,
      0
    )
    await settle(60)

    expect(doubles.media.images).toHaveLength(2)
    expect(doubles.media.images[0]).toBe(firstImage)

    // Dropping the newcomer revokes only its URL, and leaves the first alone.
    store().removeClipFromTimeline('pic2')
    await settle(60)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(doubles.media.images).toHaveLength(2)
  })

  it('keeps the audio it already loaded and releases the one it drops', async () => {
    store().addSourceVideo(audioSource)
    addMediaClip('song', audioSource.id)

    await renderPreview()
    const firstAudio = doubles.media.audios[0]

    const second = { ...audioSource, id: 'audio2', name: 'other.mp3' }
    store().addSourceVideo(second)
    store().addClipToTimeline(
      { id: 'song2', sourceVideoId: second.id, name: 'song2', startTime: 0, endTime: 4, duration: 4 },
      store().addTrack('Second').id,
      0
    )
    await settle(60)

    expect(doubles.media.audios).toHaveLength(2)
    expect(doubles.media.audios[0]).toBe(firstAudio)

    store().removeClipFromTimeline('song2')
    await settle(60)

    expect(doubles.media.audios[1].src).toBe('')
    expect(doubles.media.audios[1].pause).toHaveBeenCalled()
  })

  it('keeps the video it already loaded when another video joins the timeline', async () => {
    addClip('clip1', 0, 2)

    await renderPreview()
    const firstVideo = doubles.media.videos[0]

    store().addSourceVideo({ ...video, id: 'video2', name: 'second.mp4' })
    store().addClipToTimeline(
      { id: 'clip2', sourceVideoId: 'video2', name: 'clip2', startTime: 0, endTime: 2, duration: 2 },
      store().addTrack('Second').id,
      0
    )
    await settle(60)

    expect(doubles.media.videos).toHaveLength(2)
    expect(doubles.media.videos[0]).toBe(firstVideo)
  })

  it('releases the element of a source no clip uses any more', async () => {
    addClip('clip1', 0, 2)
    await renderPreview()
    const element = doubles.media.videos[0]

    store().removeClipFromTimeline('clip1')
    await settle(60)

    expect(element.src).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})

describe('PreviewPlayer info bar', () => {
  it('names the top-most active clip and counts the clips at the playhead', async () => {
    const bottom = store().project.timeline.tracks[0].id
    const top = store().addTrack('Top').id
    addClip('lower', 0, 2, bottom)
    addClip('upper', 0, 2, top)

    const preview = await renderPreview()

    expect(preview.view.getByText('2 clips • upper')).toBeInTheDocument()
  })

  it('says Gap when the timeline has clips but none at the playhead', async () => {
    addClip('clip1', 0, 2)
    const preview = await renderPreview()

    store().setCurrentTime(5)
    await settle(FRAME)

    expect(preview.view.getByText('Gap')).toBeInTheDocument()
  })

  it('shows the running timecode', async () => {
    addClip('clip1', 0, 4)
    const preview = await renderPreview()

    store().setCurrentTime(1.5)
    await settle(FRAME)

    expect(preview.view.getByText('00:01.500')).toBeInTheDocument()
  })
})

describe('PreviewPlayer clip visibility', () => {
  it('draws nothing for a video whose element has no dimensions yet', async () => {
    doubles.media.script({ video: { videoWidth: 0, videoHeight: 0 } })
    addClip('clip1', 0, 2)

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')).toHaveLength(0)
  })

  it('draws nothing for a video that has not loaded metadata', async () => {
    doubles.media.script({ video: { readyState: 0 } })
    addClip('clip1', 0, 2)

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')).toHaveLength(0)
  })
})
