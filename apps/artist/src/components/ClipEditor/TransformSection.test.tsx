// The "Transform" section of the clip inspector, rendered on its own so the
// two Reset buttons, the scale lock and the asymmetric Pos X/Y wiring can each
// be read directly.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransformSection } from './TransformSection'
import { inertSliderGesture, makeClip } from '../../test/fixtures/clipFixtures'
import { rowControl } from '../../test/domQueries'
import { DEFAULT_TEXT_OVERLAY_DATA } from '../../store/types'
import type { Clip } from '../../store/types'
import styles from './ClipEditor.module.css'

type Props = React.ComponentProps<typeof TransformSection>

function renderSection(overrides: Partial<Props> = {}) {
  const handlers = {
    onScaleLockedChange: vi.fn(),
    onTransformChange: vi.fn(),
    onTextDataChange: vi.fn(),
    onShapeDataChange: vi.fn(),
    onFitToCanvas: vi.fn(),
    onResetToDefaults: vi.fn(),
    onReset: vi.fn(),
  }
  render(
    <TransformSection
      clip={makeClip()}
      isOverlay={false}
      isTextOverlay={false}
      isShapeOverlay={false}
      scaleLocked
      hasSourceVideo
      sliderGesture={inertSliderGesture}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

function slide(input: HTMLInputElement, value: number | string) {
  fireEvent.change(input, { target: { value: String(value) } })
}

/** The Reset in the section header — the only Reset button with no `title`. */
const headerReset = () => screen.getByRole('button', { name: 'Reset position, size and opacity' })

/** The Reset beside Fit to Canvas, which explains itself with a `title`. */
const defaultsReset = () => screen.getByRole('button', { name: 'Reset transform including rotation' })

const textClip = (x: number, y: number): Clip =>
  makeClip({
    overlayType: 'text',
    textData: { ...DEFAULT_TEXT_OVERLAY_DATA, x, y },
  })

const shapeClip = (x: number, y: number): Clip =>
  makeClip({
    overlayType: 'shape',
    shapeData: {
      type: 'rectangle',
      x,
      y,
      width: 0.2,
      height: 0.2,
      fillColor: '#000000ff',
      strokeColor: '#ffffff',
      strokeWidth: 2,
      rotation: 0,
    },
  })

describe('TransformSection', () => {
  it('shows the clip transform position as a percentage', () => {
    renderSection({ clip: makeClip({ transform: { x: 0.25, y: 0.75, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }) })

    expect(rowControl('Pos X')).toHaveValue('0.25')
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(rowControl('Pos Y')).toHaveValue('0.75')
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('moves a media clip through the transform', () => {
    const { onTransformChange, onTextDataChange, onShapeDataChange } = renderSection()

    slide(rowControl('Pos X'), 0.2)
    slide(rowControl('Pos Y'), 0.8)

    expect(onTransformChange).toHaveBeenCalledWith('x', 0.2)
    expect(onTransformChange).toHaveBeenCalledWith('y', 0.8)
    expect(onTextDataChange).not.toHaveBeenCalled()
    expect(onShapeDataChange).not.toHaveBeenCalled()
  })

  it('reads and writes a text overlay position through its own data', () => {
    const { onTextDataChange, onTransformChange } = renderSection({
      clip: textClip(0.1, 0.9),
      isOverlay: true,
      isTextOverlay: true,
    })

    expect(rowControl('Pos X')).toHaveValue('0.1')
    expect(rowControl('Pos Y')).toHaveValue('0.9')

    slide(rowControl('Pos X'), 0.3)
    slide(rowControl('Pos Y'), 0.7)

    expect(onTextDataChange).toHaveBeenNthCalledWith(1, { x: 0.3 })
    expect(onTextDataChange).toHaveBeenNthCalledWith(2, { y: 0.7 })
    expect(onTransformChange).not.toHaveBeenCalled()
  })

  it('reads and writes a shape overlay position through its own data', () => {
    const { onShapeDataChange, onTransformChange } = renderSection({
      clip: shapeClip(0.2, 0.4),
      isOverlay: true,
      isShapeOverlay: true,
    })

    expect(rowControl('Pos X')).toHaveValue('0.2')
    expect(rowControl('Pos Y')).toHaveValue('0.4')

    slide(rowControl('Pos X'), 0.6)
    slide(rowControl('Pos Y'), 0.5)

    expect(onShapeDataChange).toHaveBeenNthCalledWith(1, { x: 0.6 })
    expect(onShapeDataChange).toHaveBeenNthCalledWith(2, { y: 0.5 })
    expect(onTransformChange).not.toHaveBeenCalled()
  })

  it('falls back to the clip transform for an overlay carrying no data of its own', () => {
    // The display and the write path disagree on purpose: the value reads
    // whichever data the clip has, while the write path asks what kind of
    // overlay it is. An overlay flagged as text but holding no textData
    // therefore shows the transform and writes to the transform.
    const { onTransformChange, onTextDataChange } = renderSection({
      clip: makeClip({ overlayType: 'text', transform: { x: 0.4, y: 0.6, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
      isOverlay: true,
      isTextOverlay: true,
    })

    expect(rowControl('Pos X')).toHaveValue('0.4')

    slide(rowControl('Pos X'), 0.1)

    expect(onTransformChange).toHaveBeenCalledWith('x', 0.1)
    expect(onTextDataChange).not.toHaveBeenCalled()
  })

  describe('the scale controls', () => {
    /** The slider position a scale sits at: the sliders run over log10(scale). */
    const at = (scale: number) => Math.log10(scale)
    const sliderValue = (el: HTMLElement) => Number((el as HTMLInputElement).value)
    const lastWrite = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)!

    it('offers one Scale row while the aspect ratio is locked', () => {
      const { onTransformChange } = renderSection({
        clip: makeClip({ transform: { x: 0.5, y: 0.5, scaleX: 1.5, scaleY: 0.5, rotation: 0, opacity: 1 } }),
      })

      expect(screen.queryByText('Scale X')).not.toBeInTheDocument()
      expect(screen.queryByText('Scale Y')).not.toBeInTheDocument()
      const scale = rowControl('Scale')
      expect(sliderValue(scale)).toBeCloseTo(at(1.5), 3)
      expect(screen.getByText('1.50\u00d7')).toBeInTheDocument()

      slide(scale, at(1.2))

      expect(lastWrite(onTransformChange)[0]).toBe('scaleX')
      expect(lastWrite(onTransformChange)[1]).toBeCloseTo(1.2, 6)
    })

    it('runs the slider over log10 of 0.1 to 10 (ESCSUITE-256)', () => {
      renderSection()
      const scale = rowControl('Scale')
      expect(scale).toHaveAttribute('min', '-1')
      expect(scale).toHaveAttribute('max', '1')
      expect(scale).toHaveAttribute('step', '0.01')
    })

    it('shows a Fit-to-Canvas 6.0 as 6.00, and one step on is about 6.14, not 1.99', () => {
      const { onTransformChange } = renderSection({
        clip: makeClip({ transform: { x: 0.5, y: 0.5, scaleX: 6, scaleY: 6, rotation: 0, opacity: 1 } }),
      })
      const scale = rowControl('Scale')

      expect(screen.getByText('6.00\u00d7')).toBeInTheDocument()
      expect(sliderValue(scale)).toBeCloseTo(at(6), 3)

      slide(scale, at(6) + 0.01)

      expect(lastWrite(onTransformChange)[1]).toBeCloseTo(6.14, 2)
    })

    it('shows a scale beyond the range clamped on the slider, and writes nothing', () => {
      const { onTransformChange } = renderSection({
        clip: makeClip({ transform: { x: 0.5, y: 0.5, scaleX: 40, scaleY: 40, rotation: 0, opacity: 1 } }),
      })
      expect(sliderValue(rowControl('Scale'))).toBe(1)
      expect(screen.getByText('40.00\u00d7')).toBeInTheDocument()
      expect(onTransformChange).not.toHaveBeenCalled()
    })

    it('clamps a scale below the range to the slider minimum', () => {
      renderSection({
        clip: makeClip({ transform: { x: 0.5, y: 0.5, scaleX: 0.01, scaleY: 0.01, rotation: 0, opacity: 1 } }),
      })
      expect(sliderValue(rowControl('Scale'))).toBe(-1)
    })

    it('splits into Scale X and Scale Y once unlocked', () => {
      const { onTransformChange } = renderSection({
        scaleLocked: false,
        clip: makeClip({ transform: { x: 0.25, y: 0.75, scaleX: 1.5, scaleY: 0.5, rotation: 0, opacity: 1 } }),
      })

      expect(sliderValue(rowControl('Scale X'))).toBeCloseTo(at(1.5), 3)
      expect(sliderValue(rowControl('Scale Y'))).toBeCloseTo(at(0.5), 3)
      expect(screen.getByText('1.50\u00d7')).toBeInTheDocument()
      expect(screen.getByText('0.50\u00d7')).toBeInTheDocument()

      slide(rowControl('Scale Y'), at(0.8))

      expect(lastWrite(onTransformChange)[0]).toBe('scaleY')
      expect(lastWrite(onTransformChange)[1]).toBeCloseTo(0.8, 6)
    })

    it('toggles the lock, which is what the padlock button says it will do', async () => {
      const user = userEvent.setup()
      const { onScaleLockedChange } = renderSection()

      // Since ESCSUITE-89 the padlock's *name* is fixed and its state is
      // `aria-pressed`, so what it will do is the tooltip's job alone.
      const lock = screen.getByRole('button', { name: 'Lock aspect ratio', pressed: true })
      expect(lock).toHaveAttribute('title', 'Unlock aspect ratio')
      expect(lock.className).toContain(styles.locked)

      await user.click(lock)

      expect(onScaleLockedChange).toHaveBeenCalledWith(false)
    })

    it('offers to lock again while unlocked', async () => {
      const user = userEvent.setup()
      const { onScaleLockedChange } = renderSection({ scaleLocked: false })

      const lock = screen.getByRole('button', { name: 'Lock aspect ratio', pressed: false })
      expect(lock).toHaveAttribute('title', 'Lock aspect ratio')
      expect(lock.className).not.toContain(styles.locked)

      await user.click(lock)

      expect(onScaleLockedChange).toHaveBeenCalledWith(true)
    })

    it('is hidden entirely for an overlay', () => {
      renderSection({ clip: textClip(0.5, 0.5), isOverlay: true, isTextOverlay: true })

      expect(screen.queryByText('Scale')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Fit to Canvas' })).not.toBeInTheDocument()
      expect(rowControl('Opacity')).toBeInTheDocument()
    })
  })

  describe('the canvas buttons', () => {
    it('fits the clip to the canvas', async () => {
      const user = userEvent.setup()
      const { onFitToCanvas } = renderSection()

      await user.click(screen.getByRole('button', { name: 'Fit to Canvas' }))

      expect(onFitToCanvas).toHaveBeenCalledTimes(1)
    })

    it('only exists when the clip has a source video', () => {
      renderSection({ hasSourceVideo: false })

      expect(screen.queryByRole('button', { name: 'Fit to Canvas' })).not.toBeInTheDocument()
      // The defaults Reset goes with it, leaving the header Reset alone.
      expect(screen.queryByRole('button', { name: 'Reset transform including rotation' })).not.toBeInTheDocument()
      expect(headerReset()).toBeInTheDocument()
    })
  })

  describe('the two Reset buttons', () => {
    it('read "Reset" but are named for what they reset (ESCSUITE-256)', () => {
      renderSection()

      expect(headerReset()).toHaveTextContent(/^Reset$/)
      expect(defaultsReset()).toHaveTextContent(/^Reset$/)
      expect(headerReset()).not.toBe(defaultsReset())
      expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    })

    it('run different handlers', async () => {
      const user = userEvent.setup()
      const { onReset, onResetToDefaults } = renderSection()

      await user.click(headerReset())

      expect(onReset).toHaveBeenCalledTimes(1)
      expect(onResetToDefaults).not.toHaveBeenCalled()

      await user.click(defaultsReset())

      expect(onResetToDefaults).toHaveBeenCalledTimes(1)
      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('leaves the section open when the header Reset is clicked', async () => {
      const user = userEvent.setup()
      renderSection()

      await user.click(headerReset())

      // Without stopPropagation the click would reach the section's own
      // header toggle and collapse everything under it.
      expect(rowControl('Opacity')).toBeInTheDocument()
    })
  })

  it('changes opacity', () => {
    const { onTransformChange } = renderSection({
      clip: makeClip({ transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.4 } }),
    })

    expect(rowControl('Opacity')).toHaveValue('0.4')
    expect(screen.getByText('40%')).toBeInTheDocument()

    slide(rowControl('Opacity'), 0.9)

    expect(onTransformChange).toHaveBeenCalledWith('opacity', 0.9)
  })
})
