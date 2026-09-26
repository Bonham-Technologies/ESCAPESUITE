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
const headerReset = () =>
  screen.getAllByRole('button', { name: 'Reset' }).find((b) => !b.getAttribute('title'))!

/** The Reset beside Fit to Canvas, which explains itself with a `title`. */
const defaultsReset = () =>
  screen.getAllByRole('button', { name: 'Reset' }).find((b) => b.getAttribute('title'))!

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
    it('offers one Scale row while the aspect ratio is locked', () => {
      const { onTransformChange } = renderSection({
        clip: makeClip({ transform: { x: 0.5, y: 0.5, scaleX: 1.5, scaleY: 0.5, rotation: 0, opacity: 1 } }),
      })

      expect(screen.queryByText('Scale X')).not.toBeInTheDocument()
      expect(screen.queryByText('Scale Y')).not.toBeInTheDocument()
      const scale = rowControl('Scale')
      expect(scale).toHaveValue('1.5')
      expect(screen.getByText('150%')).toBeInTheDocument()

      slide(scale, 1.2)

      expect(onTransformChange).toHaveBeenCalledWith('scaleX', 1.2)
    })

    it('splits into Scale X and Scale Y once unlocked', () => {
      const { onTransformChange } = renderSection({
        scaleLocked: false,
        clip: makeClip({ transform: { x: 0.25, y: 0.75, scaleX: 1.5, scaleY: 0.5, rotation: 0, opacity: 1 } }),
      })

      expect(rowControl('Scale X')).toHaveValue('1.5')
      expect(rowControl('Scale Y')).toHaveValue('0.5')
      expect(screen.getByText('150%')).toBeInTheDocument()
      expect(screen.getByText('50%')).toBeInTheDocument()

      slide(rowControl('Scale Y'), 0.8)

      expect(onTransformChange).toHaveBeenCalledWith('scaleY', 0.8)
    })

    it('toggles the lock, which is what the padlock button says it will do', async () => {
      const user = userEvent.setup()
      const { onScaleLockedChange } = renderSection()

      const lock = screen.getByRole('button', { name: 'Unlock aspect ratio' })
      expect(lock.className).toContain(styles.locked)

      await user.click(lock)

      expect(onScaleLockedChange).toHaveBeenCalledWith(false)
    })

    it('offers to lock again while unlocked', async () => {
      const user = userEvent.setup()
      const { onScaleLockedChange } = renderSection({ scaleLocked: false })

      const lock = screen.getByRole('button', { name: 'Lock aspect ratio' })
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
      expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(1)
      expect(headerReset()).toBeInTheDocument()
    })
  })

  describe('the two Reset buttons', () => {
    it('are told apart by the title only the defaults one carries', () => {
      renderSection()

      const resets = screen.getAllByRole('button', { name: 'Reset' })
      expect(resets).toHaveLength(2)
      expect(resets.map((b) => b.getAttribute('title'))).toEqual([
        null,
        'Reset position, scale, and rotation to defaults',
      ])
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
