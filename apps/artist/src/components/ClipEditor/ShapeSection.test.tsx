// The "Shape" section of the clip inspector, rendered on its own with explicit
// data so every control's onChange payload can be read directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShapeSection } from './ShapeSection'
import { useClipEditorActions } from './useClipEditorActions'
import { BURST_PAUSE_MS } from './useBurstGesture'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { inertSliderGesture } from '../../test/fixtures/clipFixtures'
import { rowControl, rowColor } from '../../test/domQueries'
import type { ShapeOverlayData } from '../../store/types'
import styles from './ClipEditor.module.css'

const baseShape: ShapeOverlayData = {
  type: 'rectangle',
  x: 0.5,
  y: 0.5,
  width: 0.2,
  height: 0.4,
  fillColor: '#000000ff',
  strokeColor: '#ffffff',
  strokeWidth: 2,
  rotation: 0,
}

function renderSection(overrides: Partial<ShapeOverlayData> = {}) {
  const onChange = vi.fn()
  render(
    <ShapeSection
      shapeData={{ ...baseShape, ...overrides }}
      onChange={onChange}
      sliderGesture={inertSliderGesture}
    />
  )
  return { onChange }
}

function slide(input: HTMLInputElement, value: number | string) {
  fireEvent.change(input, { target: { value: String(value) } })
}

/**
 * The no-fill toggle, which is the only button in the section body.
 *
 * Addressed by name, which since ESCSUITE-89 is its `aria-label` — "No fill"
 * or "Enable fill", whichever it would do next — rather than the ⊗/⊘ glyph it
 * draws. The glyph is still asserted where it matters, below.
 */
const fillToggle = () => screen.getByRole('button', { name: /^(No|Enable) fill$/ })

describe('ShapeSection', () => {
  it('sits inside a Shape section showing the shape type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection()

    expect(screen.getByText('Shape')).toBeInTheDocument()
    const typeSelect = screen.getByRole('combobox') as HTMLSelectElement
    expect(typeSelect).toHaveValue('rectangle')

    await user.selectOptions(typeSelect, 'ellipse')

    expect(onChange).toHaveBeenCalledWith({ type: 'ellipse' })
  })

  it('offers all five shape types', () => {
    renderSection()

    expect(
      Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent)
    ).toEqual(['Rectangle', 'Ellipse', 'Line', 'Arrow', 'Blur Region'])
  })

  describe('a blur region', () => {
    it('replaces the fill and stroke controls with one blur amount, defaulting to 10', () => {
      const { onChange } = renderSection({ type: 'blur' })

      expect(screen.queryByText('Fill')).not.toBeInTheDocument()
      expect(screen.queryByText('Stroke')).not.toBeInTheDocument()
      expect(screen.getByText('Blurs the video underneath this region')).toBeInTheDocument()

      const amount = rowControl('Blur Amount')
      expect(amount).toHaveValue('10')
      expect(screen.getByText('10px')).toBeInTheDocument()

      slide(amount, 25)

      expect(onChange).toHaveBeenCalledWith({ blurAmount: 25 })
    })

    it('shows the blur amount it already has', () => {
      renderSection({ type: 'blur', blurAmount: 32 })

      expect(rowControl('Blur Amount')).toHaveValue('32')
      // Two sliders write `blurAmount` for a blur region — "Blur Amount" here
      // and the general "Blur" row below — so the same value is displayed
      // twice. Pins the behaviour as it is, not as it should be.
      expect(screen.getAllByText('32px')).toHaveLength(2)
      expect(rowControl('Blur')).toHaveValue('32')
    })

    it('keeps the size, rotation and blur sliders', () => {
      renderSection({ type: 'blur' })

      expect(rowControl('Size W')).toHaveValue('0.2')
      expect(rowControl('Rotation')).toHaveValue('0')
      expect(screen.getByText('Blur the region underneath (set fill to transparent)')).toBeInTheDocument()
    })
  })

  describe('fill', () => {
    it('shows the fill colour without its alpha and keeps that alpha when it changes', () => {
      const { onChange } = renderSection({ fillColor: '#00000080' })

      expect(rowColor('Fill')).toHaveValue('#000000')
      fireEvent.change(rowColor('Fill'), { target: { value: '#abcdef' } })

      expect(onChange).toHaveBeenCalledWith({ fillColor: '#abcdef80' })
    })

    it('turns a visible fill transparent', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ fillColor: '#112233ff' })

      const toggle = fillToggle()
      expect(toggle).toHaveTextContent('⊗')
      expect(toggle).toHaveAttribute('title', 'No fill (transparent)')
      expect(toggle).not.toHaveClass(styles.active)
      expect(rowColor('Fill')).not.toBeDisabled()

      await user.click(toggle)

      expect(onChange).toHaveBeenCalledWith({ fillColor: '#11223300' })
    })

    it('brings a transparent fill back at half opacity, and locks the picker meanwhile', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ fillColor: '#11223300' })

      const toggle = fillToggle()
      expect(toggle).toHaveTextContent('⊘')
      expect(toggle).toHaveAttribute('title', 'Enable fill')
      expect(toggle).toHaveClass(styles.active)
      expect(rowColor('Fill')).toBeDisabled()

      await user.click(toggle)

      expect(onChange).toHaveBeenCalledWith({ fillColor: '#11223380' })
    })

    it('treats a missing fill colour as opaque black', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ fillColor: '' })

      expect(fillToggle()).toHaveTextContent('⊗')
      expect(fillToggle()).toHaveAttribute('title', 'No fill (transparent)')
      expect(screen.getByText('100%')).toBeInTheDocument()

      fireEvent.change(rowColor('Fill'), { target: { value: '#abcdef' } })
      expect(onChange).toHaveBeenLastCalledWith({ fillColor: '#abcdefff' })

      slide(rowControl('Fill opacity'), 25)
      expect(onChange).toHaveBeenLastCalledWith({ fillColor: '#00000040' })

      await user.click(fillToggle())
      expect(onChange).toHaveBeenLastCalledWith({ fillColor: '#00000000' })
    })

    it('shows the fill opacity as a percentage and writes a new alpha back', () => {
      const { onChange } = renderSection({ fillColor: '#00000080' })

      const opacity = rowControl('Fill opacity')
      expect(opacity).toHaveValue('50')
      expect(screen.getByText('50%')).toBeInTheDocument()

      slide(opacity, 100)

      expect(onChange).toHaveBeenCalledWith({ fillColor: '#000000ff' })
    })

    it('hides the fill opacity row while there is no fill', () => {
      renderSection({ fillColor: '#00000000' })

      expect(screen.queryByText('Fill opacity')).not.toBeInTheDocument()
    })
  })

  it('changes the stroke colour and width', () => {
    const { onChange } = renderSection()

    expect(rowColor('Stroke')).toHaveValue('#ffffff')
    fireEvent.change(rowColor('Stroke'), { target: { value: '#00ff00' } })
    expect(onChange).toHaveBeenCalledWith({ strokeColor: '#00ff00' })

    const width = rowControl('Stroke')
    expect(width).toHaveValue('2')
    expect(screen.getByText('2px')).toBeInTheDocument()
    slide(width, 5)
    expect(onChange).toHaveBeenCalledWith({ strokeWidth: 5 })
  })

  it('resizes the shape as a fraction of the frame', () => {
    const { onChange } = renderSection()

    expect(rowControl('Size W')).toHaveValue('0.2')
    expect(screen.getByText('20%')).toBeInTheDocument()
    slide(rowControl('Size W'), 0.5)
    expect(onChange).toHaveBeenCalledWith({ width: 0.5 })

    expect(rowControl('Size H')).toHaveValue('0.4')
    expect(screen.getByText('40%')).toBeInTheDocument()
    slide(rowControl('Size H'), 0.75)
    expect(onChange).toHaveBeenCalledWith({ height: 0.75 })
  })

  it('rotates the shape in degrees', () => {
    const { onChange } = renderSection({ rotation: 45 })

    expect(rowControl('Rotation')).toHaveValue('45')
    expect(screen.getByText('45°')).toBeInTheDocument()

    slide(rowControl('Rotation'), 90)

    expect(onChange).toHaveBeenCalledWith({ rotation: 90 })
  })

  it('blurs underneath a shape that is not a blur region, defaulting to none', () => {
    const { onChange } = renderSection()

    const blur = rowControl('Blur')
    expect(blur).toHaveValue('0')
    expect(screen.getByText('0px')).toBeInTheDocument()

    slide(blur, 12)

    expect(onChange).toHaveBeenCalledWith({ blurAmount: 12 })
    expect(screen.getByText('Blur the region underneath (set fill to transparent)')).toBeInTheDocument()
  })

  it('shows the blur it already has', () => {
    renderSection({ blurAmount: 8 })

    expect(rowControl('Blur')).toHaveValue('8')
    expect(screen.getByText('8px')).toBeInTheDocument()
  })
})

// ESCSUITE-242: one sweep of a colour picker is one undo step.
//
// `<input type="color">` reports continuously while the user sweeps the picker,
// and each write used to push an undo entry. A sweep is a burst
// (`useBurstGesture`): it opens on the first edit and closes on blur or after
// `BURST_PAUSE_MS` with none, while the store is written on every event. The
// sliders keep `useSliderGesture`, and the selects and the no-fill toggle keep
// one entry per change. Run against the real store, wired the way `ClipEditor`
// wires it.
describe('ShapeSection and the undo stack', () => {
  const past = () => store().history.past.length
  const shapeNow = () => store().project.timeline.clips[0].shapeData!

  function renderLive() {
    const writes = vi.spyOn(useEditorStore.getState(), 'updateShapeOverlayData')
    function LiveSection() {
      const { selectedClip, handleShapeDataChange, sliderGesture, burstGesture } = useClipEditorActions()
      return (
        <ShapeSection
          shapeData={selectedClip!.shapeData!}
          onChange={handleShapeDataChange}
          sliderGesture={sliderGesture}
          burstGesture={burstGesture}
        />
      )
    }
    const view = render(<LiveSection />)
    return { writes, unmount: view.unmount }
  }

  /** `count` picker reports, each a different red, then the picker's closing `change`. */
  function sweep(swatch: HTMLInputElement, count: number) {
    let last = ''
    for (let i = 0; i < count; i++) {
      last = `#${(i * 8).toString(16).padStart(2, '0')}0000`
      fireEvent.input(swatch, { target: { value: last } })
    }
    fireEvent.change(swatch, { target: { value: last } })
    return last
  }

  beforeEach(() => {
    resetStoreForTest()
    store().addShapeOverlayClip({ type: 'rectangle', fillColor: '#000000ff', strokeWidth: 2 })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records one entry for a thirty-report sweep of the fill picker, writing on every report', () => {
    const { writes } = renderLive()
    const before = past()

    const last = sweep(rowColor('Fill'), 30)

    expect(writes).toHaveBeenCalledTimes(30)
    expect(shapeNow().fillColor).toBe(`${last}ff`)
    expect(past() - before).toBe(1)
  })

  it('undoes the whole sweep in one step', () => {
    renderLive()

    sweep(rowColor('Fill'), 30)
    store().undo()

    expect(shapeNow().fillColor).toBe('#000000ff')
  })

  it('records one entry for a sweep of the stroke picker', () => {
    renderLive()
    const before = past()

    sweep(rowColor('Stroke'), 30)

    expect(past() - before).toBe(1)
  })

  it('starts a new entry for a sweep after blur, and for one after a pause', () => {
    renderLive()
    const before = past()

    sweep(rowColor('Fill'), 5)
    fireEvent.blur(rowColor('Fill'))
    sweep(rowColor('Fill'), 5)
    vi.advanceTimersByTime(BURST_PAUSE_MS)
    sweep(rowColor('Fill'), 5)

    expect(past() - before).toBe(3)
  })

  it('keeps one entry per press of the no-fill toggle and per shape-type choice', () => {
    renderLive()
    const before = past()

    fireEvent.click(screen.getByRole('button', { name: 'No fill' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable fill' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Shape type' }), { target: { value: 'ellipse' } })

    expect(past() - before).toBe(3)
  })

  it('still records one entry for a slider drag', () => {
    renderLive()
    const before = past()
    const width = rowControl('Size W')

    fireEvent.pointerDown(width)
    for (const value of [0.3, 0.4, 0.5]) fireEvent.input(width, { target: { value: String(value) } })
    fireEvent.pointerUp(width)

    expect(shapeNow().width).toBe(0.5)
    expect(past() - before).toBe(1)
  })

  it('ends an open sweep and clears its timer when the panel unmounts', () => {
    const { unmount } = renderLive()

    fireEvent.input(rowColor('Fill'), { target: { value: '#123456' } })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
