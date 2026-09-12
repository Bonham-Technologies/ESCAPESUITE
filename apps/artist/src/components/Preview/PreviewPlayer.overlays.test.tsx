// The overlays PreviewPlayer draws on top of the media: text and shape overlay
// clips with their animated transforms, and the legacy overlay arrays a project
// saved before overlays became clips still carries.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  FRAME_MS,
  installPreviewDoubles,
  last,
  renderPreview,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'
import type { Clip, ShapeOverlayData, TextOverlayData } from '../../store/types'

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
    await settle(FRAME_MS)

    // Halfway through a linear x tween: centre back at 0.5 → 960px.
    expect(last(preview.frame().of('fillRect')).args).toEqual([768, 432, 384, 216])
  })

  it('scales a shape overlay by its animated scale', async () => {
    const clip = addShape({ type: 'rectangle' })
    store().setClipKeyframe(clip.id, 'scaleX', { time: 0, value: 2, easing: 'linear' })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)
    await settle(FRAME_MS)

    expect(last(preview.frame().of('fillRect')).args).toEqual([576, 432, 768, 216])
  })

  it('leaves the text being inline-edited out of the frame', async () => {
    addText({ text: 'Editing' })

    const preview = await renderPreview()
    expect(preview.frame().of('fillText')).toHaveLength(1)

    fireEvent.doubleClick(preview.canvas, preview.at(960, 540))
    await settle(FRAME_MS)
    preview.clearCalls()
    store().setCurrentTime(1)
    await settle(FRAME_MS)

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
    await settle(FRAME_MS)

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

  it('drops a legacy shape overlay once the playhead passes its end', async () => {
    addClip('clip1', 0, 4)
    store().addShapeOverlay({ type: 'rectangle', startTime: 0, endTime: 1, strokeWidth: 2 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(2)
    await settle(FRAME_MS)

    expect(preview.frame().of('strokeRect')).toHaveLength(0)
  })

  it('rotates a legacy shape overlay', async () => {
    addClip('clip1', 0, 4)
    store().addShapeOverlay({ type: 'rectangle', startTime: 0, endTime: 4, rotation: 90 })

    const preview = await renderPreview()

    expect(preview.frame().argsFor('rotate')).toEqual([[Math.PI / 2]])
  })
})
