// Where the inline editor lands on the preview.
//
// The component tests prove the editor opens on the right clip and writes the
// right text back. What they cannot vary cheaply is the shape of the canvas'
// layout box, and that is the whole of the maths here: a canvas letterboxed
// top and bottom pushes the editor down, one pillarboxed left and right pushes
// it across, and the font shrinks with the canvas either way.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { InlineTextEditorAnchor } from './InlineTextEditorAnchor'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import { setRect, type Box } from '../../test/doubles/layout'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import type { Clip, TextOverlayData } from '../../store/types'

beforeEach(() => {
  installCanvasDouble()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  uninstallCanvasDouble()
})

/**
 * A default text overlay: 'Text' at 48px, centre-aligned at the middle of the
 * canvas. The canvas double reports every string as 100px wide and the line
 * height is fontSize * 1.2, so the box is 100x57.6 canvas pixels — its left
 * edge at 960 - 50 and its top at 540 - 28.8 on a 1920x1080 canvas.
 */
const TEXT_LEFT = 910
const TEXT_TOP = 511.2

/** The editor insets itself by 15% of its rendered font size. */
const padding = (fontSize: number) => fontSize * 0.15

const textClip = (data: Partial<TextOverlayData> = {}): Clip =>
  store().addTextOverlayClip(data, undefined, 0, 4)

/** Mount the anchor over a 1920x1080 canvas laid out in the given box. */
function anchor(clip: Clip | undefined, rect: Box): HTMLTextAreaElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1920
  canvas.height = 1080
  setRect(canvas, rect)
  const view = render(
    <InlineTextEditorAnchor
      clip={clip}
      canvas={canvas}
      onCommit={() => {}}
      onCancel={() => {}}
    />
  )
  return view.container.querySelector('textarea')
}

describe('InlineTextEditorAnchor', () => {
  it('places the editor over text on a letterboxed canvas', () => {
    // 960x600 box, 16:9 content: 960x540 rendered, 30px of letterbox above it.
    const textarea = anchor(textClip(), { left: 0, top: 0, width: 960, height: 600 })!

    expect(textarea.style.left).toBe(`${TEXT_LEFT * 0.5 - padding(24)}px`)
    expect(textarea.style.top).toBe(`${30 + TEXT_TOP * 0.5 - padding(24)}px`)
    expect(textarea.style.fontSize).toBe('24px')
  })

  it('places the editor over text on a pillarboxed canvas', () => {
    // 1200x540 box, 16:9 content: 960x540 rendered, 120px of pillarbox each side.
    const textarea = anchor(textClip(), { left: 0, top: 0, width: 1200, height: 540 })!

    expect(textarea.style.left).toBe(`${120 + TEXT_LEFT * 0.5 - padding(24)}px`)
    expect(textarea.style.top).toBe(`${TEXT_TOP * 0.5 - padding(24)}px`)
    expect(textarea.style.fontSize).toBe('24px')
  })

  it('hangs right-aligned text to the left of its anchor point', () => {
    const textarea = anchor(textClip({ textAlign: 'right' }), { left: 0, top: 0, width: 960, height: 540 })!

    // The anchor is the text's right edge: the whole 100px box sits left of 960.
    expect(textarea.style.left).toBe(`${(960 - 100) * 0.5 - padding(24)}px`)
  })

  it('scales the editor with the clip', () => {
    const textarea = anchor(textClip({ scale: 2 }), { left: 0, top: 0, width: 960, height: 540 })!

    // Twice the text: 200x115.2 canvas pixels, and a 48px font on screen.
    expect(textarea.style.left).toBe(`${(960 - 200 / 2) * 0.5 - padding(48)}px`)
    expect(textarea.style.top).toBe(`${(540 - 115.2 / 2) * 0.5 - padding(48)}px`)
    expect(textarea.style.fontSize).toBe('48px')
  })

  it('renders nothing for a clip that is not there', () => {
    expect(anchor(undefined, { left: 0, top: 0, width: 960, height: 540 })).toBeNull()
  })

  it('renders nothing for a clip that carries no text', () => {
    const shape = store().addShapeOverlayClip({}, undefined, 0, 4)

    expect(anchor(shape, { left: 0, top: 0, width: 960, height: 540 })).toBeNull()
  })

  it('renders nothing when the canvas has no 2D context to measure with', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1920
    canvas.height = 1080
    canvas.getContext = () => null
    setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })

    const view = render(
      <InlineTextEditorAnchor
        clip={textClip()}
        canvas={canvas}
        onCommit={() => {}}
        onCancel={() => {}}
      />
    )

    expect(view.container.querySelector('textarea')).toBeNull()
  })
})
