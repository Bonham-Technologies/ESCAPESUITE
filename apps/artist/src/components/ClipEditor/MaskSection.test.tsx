// The "Mask & Stroke" section of the clip inspector, rendered on its own
// (ESCSUITE-65).
//
// Same shape as `BlendModeSection.test.tsx`: the real component, `vi.fn()`
// callbacks, and the section opened first because `CollapsibleSection` renders
// no children while it is closed. Normalising what gets *stored* is the hook's
// job and is tested in `useClipEditorActions.test.ts`; this file asserts what
// the user did.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaskSection } from './MaskSection'
import { CLIP_MASK_KINDS } from './clipEditorOptions'
import { rowControl, rowColor } from '../../test/domQueries'
import { inertSliderGesture } from '../../test/fixtures/clipFixtures'
import { DEFAULT_CLIP_MASK_RADIUS, DEFAULT_CLIP_STROKE_COLOR } from '../../store/types'
import type { ClipMask, ClipStroke } from '../../store/types'

/** ESCAPECRAFT's own border: white at 80%, three pixels of a 1280-wide frame. */
const HANDOVER_STROKE: ClipStroke = { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 }

async function renderOpen({
  mask,
  stroke,
  frameWidth = 1280,
}: { mask?: ClipMask; stroke?: ClipStroke; frameWidth?: number } = {}) {
  const user = userEvent.setup()
  const onMaskChange = vi.fn()
  const onStrokeChange = vi.fn()
  render(
    <MaskSection
      mask={mask}
      stroke={stroke}
      frameWidth={frameWidth}
      onMaskChange={onMaskChange}
      onStrokeChange={onStrokeChange}
      sliderGesture={inertSliderGesture}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Mask & Stroke' }))
  return { user, onMaskChange, onStrokeChange }
}

describe('MaskSection', () => {
  it('starts collapsed, showing only its title', () => {
    render(
      <MaskSection
        mask={undefined}
        stroke={undefined}
        frameWidth={1280}
        onMaskChange={vi.fn()}
        onStrokeChange={vi.fn()}
        sliderGesture={inertSliderGesture}
      />
    )

    expect(screen.getByRole('button', { name: 'Mask & Stroke' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers every mask kind, in the table order', async () => {
    await renderOpen()

    expect(
      Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => [
        (o as HTMLOptionElement).value,
        o.textContent,
      ])
    ).toEqual(CLIP_MASK_KINDS.map((k) => [k.value, k.label]))
  })

  it('shows None for a clip with no mask', async () => {
    await renderOpen()

    // Absent is how a clip says it has no mask; `'none'` exists so the dropdown
    // has something to display.
    expect(screen.getByRole('combobox')).toHaveValue('none')
  })

  it('reports the kind the user picked, with a radius to start from', async () => {
    const { user, onMaskChange } = await renderOpen()

    await user.selectOptions(screen.getByRole('combobox'), 'circle')

    expect(onMaskChange).toHaveBeenCalledWith({
      kind: 'circle',
      radius: DEFAULT_CLIP_MASK_RADIUS,
    })
  })

  it('offers the corner radius for a rounded mask and nothing else', async () => {
    await renderOpen({ mask: { kind: 'rounded', radius: 0.2 } })

    const radius = rowControl('Corner Radius')
    expect(radius).toHaveValue('0.2')
    expect(radius).toHaveAttribute('min', '0')
    expect(radius).toHaveAttribute('max', '0.5')
    // A fraction of the clip's shorter side, shown as a percentage of it — the
    // stored number is meaningless to read and 20% is not.
    expect(screen.getByText('20%')).toBeInTheDocument()
  })

  it.each([
    ['no mask', undefined],
    ['a circle', { kind: 'circle' as const }],
  ])('hides the corner radius for %s', async (_label, mask) => {
    await renderOpen({ mask })

    expect(screen.queryByText('Corner Radius')).not.toBeInTheDocument()
  })

  it('reports a new corner radius as a fraction', async () => {
    const { onMaskChange } = await renderOpen({ mask: { kind: 'rounded', radius: 0.2 } })

    fireEvent.change(rowControl('Corner Radius'), { target: { value: '0.35' } })

    expect(onMaskChange).toHaveBeenCalledWith({ kind: 'rounded', radius: 0.35 })
  })

  it('labels the stroke width in pixels at the project resolution', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE, frameWidth: 1280 })

    // 3/1280 of a 1280-wide frame is the 3px ESCAPECRAFT drew. Reading
    // "0.0023" would tell the user nothing they could act on.
    expect(screen.getByText('3px')).toBeInTheDocument()
  })

  it('shows the same fraction as more pixels on a larger project', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE, frameWidth: 1920 })

    // The fraction is the point: the same border is half again as thick on a
    // 1080p project, so it looks the same rather than measuring the same.
    expect(screen.getByText('4.5px')).toBeInTheDocument()
  })

  it('shows no stroke as 0px', async () => {
    await renderOpen()

    expect(rowControl('Stroke Width')).toHaveValue('0')
    expect(screen.getByText('0px')).toBeInTheDocument()
  })

  it('steps the stroke width in whole pixels at a typical resolution', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE })

    const width = rowControl('Stroke Width')
    expect(width).toHaveAttribute('min', '0')
    expect(width).toHaveAttribute('max', '0.02')
    // 0.001 of a 1280-wide frame is ~1.3px per arrow press. A tenth of that —
    // which this slider had — moves the border by an eighth of a pixel and reads
    // as a dead control.
    expect(width).toHaveAttribute('step', '0.001')
  })

  it('reports a new stroke width, keeping the colour it had', async () => {
    const { onStrokeChange } = await renderOpen({ stroke: { color: '#ff0000', width: 0.004 } })

    fireEvent.change(rowControl('Stroke Width'), { target: { value: '0.008' } })

    expect(onStrokeChange).toHaveBeenCalledWith({ color: '#ff0000', width: 0.008 })
  })

  it('starts a first stroke white', async () => {
    const { onStrokeChange } = await renderOpen()

    fireEvent.change(rowControl('Stroke Width'), { target: { value: '0.004' } })

    expect(onStrokeChange).toHaveBeenCalledWith({
      color: DEFAULT_CLIP_STROKE_COLOR,
      width: 0.004,
    })
  })

  it('reports a new stroke colour, keeping the width it had', async () => {
    const { onStrokeChange } = await renderOpen({ stroke: { color: '#ffffff', width: 0.004 } })

    fireEvent.change(rowColor('Stroke Color'), { target: { value: '#00ff00' } })

    expect(onStrokeChange).toHaveBeenCalledWith({ color: '#00ff00', width: 0.004 })
  })

  it('shows white in the swatch for a colour the input cannot represent', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE })

    // `<input type="color">` accepts #rrggbb only, and the ESCAPECRAFT handoff
    // stores `rgba(255, 255, 255, 0.8)`. It shows as white — which it is — and
    // the stored string is replaced only when the user actually picks.
    expect(rowColor('Stroke Color')).toHaveValue(DEFAULT_CLIP_STROKE_COLOR)
  })

  it('shows white in the swatch for a three-digit hex too', async () => {
    await renderOpen({ stroke: { color: '#f00', width: 0.004 } })

    // `#f00` is valid CSS and the renderer draws it red, but the swatch's regex
    // is six-digit-only on purpose: an `<input type="color">` normalises what it
    // accepts, so a colour it cannot represent exactly falls back to white and
    // the stored string survives until the user actually picks.
    expect(rowColor('Stroke Color')).toHaveValue(DEFAULT_CLIP_STROKE_COLOR)
  })

  it('disables the colour picker while there is no stroke to colour', async () => {
    await renderOpen()

    // The same choice `ShapeSection` makes for its fill picker when there is no
    // fill: a control whose value cannot matter should not invite a click.
    expect(rowColor('Stroke Color')).toBeDisabled()
  })

  it('enables the colour picker once the stroke has width', async () => {
    await renderOpen({ stroke: { color: '#ffffff', width: 0.004 } })

    expect(rowColor('Stroke Color')).toBeEnabled()
  })
})
