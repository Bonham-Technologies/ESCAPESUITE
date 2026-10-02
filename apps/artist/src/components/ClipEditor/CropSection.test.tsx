// The "Crop" section of the clip inspector, rendered on its own (ESCSUITE-6).
//
// Same shape as `MaskSection.test.tsx`: the real component, `vi.fn()` callbacks,
// and the section opened first because `CollapsibleSection` renders no children
// while it is closed. Deciding what gets *stored* is the hook's job and is
// tested in `useClipEditorActions.test.ts`; this file asserts what the user did.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CropSection } from './CropSection'
import { inertSliderGesture } from '../../test/fixtures/clipFixtures'
import type { ClipCrop } from '../../store/types'

const NO_CROP = { left: 0, top: 0, right: 0, bottom: 0 }

function renderClosed({
  crop,
  sourceWidth = 400,
  sourceHeight = 200,
  disabled,
}: { crop?: ClipCrop; sourceWidth?: number; sourceHeight?: number; disabled?: boolean } = {}) {
  const user = userEvent.setup()
  const onCropChange = vi.fn()
  render(
    <CropSection
      crop={crop}
      sourceWidth={sourceWidth}
      sourceHeight={sourceHeight}
      onCropChange={onCropChange}
      sliderGesture={inertSliderGesture}
      disabled={disabled}
    />
  )
  return { user, onCropChange }
}

async function renderOpen(options: Parameters<typeof renderClosed>[0] = {}) {
  const handles = renderClosed(options)
  await handles.user.click(screen.getByRole('button', { name: 'Crop' }))
  return handles
}

describe('CropSection', () => {
  it('starts collapsed, showing only its title', () => {
    renderClosed()

    expect(screen.getByRole('button', { name: 'Crop' })).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('shows a clip with no crop as four zeroes', async () => {
    await renderOpen()

    for (const edge of ['Left', 'Top', 'Right', 'Bottom']) {
      expect(screen.getByLabelText(edge)).toHaveValue('0')
    }
  })

  it('shows a stored crop as whole percentages', async () => {
    await renderOpen({ crop: { left: 0.25, top: 0.1, right: 0, bottom: 0.05 } })

    expect(screen.getByLabelText('Left')).toHaveValue('25')
    expect(screen.getByLabelText('Top')).toHaveValue('10')
    expect(screen.getByLabelText('Bottom')).toHaveValue('5')
  })

  it('reports the whole crop when one slider moves, as fractions', async () => {
    const { onCropChange } = await renderOpen({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 } })

    fireEvent.change(screen.getByLabelText('Top'), { target: { value: '40' } })

    expect(onCropChange).toHaveBeenCalledWith({ left: 0.25, top: 0.4, right: 0, bottom: 0 })
  })

  it('reports the same thing from the number field beside the slider', async () => {
    const { onCropChange } = await renderOpen()

    fireEvent.change(screen.getByLabelText('Right crop percent'), { target: { value: '30' } })

    expect(onCropChange).toHaveBeenCalledWith({ left: 0, top: 0, right: 0.3, bottom: 0 })
  })

  it('caps each slider and number field at 90%', async () => {
    await renderOpen()

    for (const edge of ['Left', 'Top', 'Right', 'Bottom']) {
      expect(screen.getByLabelText(edge)).toHaveAttribute('max', '90')
      expect(screen.getByLabelText(`${edge} crop percent`)).toHaveAttribute('max', '90')
    }
  })

  it('reports centred insets for an aspect preset', async () => {
    const { user, onCropChange } = await renderOpen()

    await user.click(screen.getByRole('button', { name: '1:1' }))

    // A 1:1 region of a 400x200 source is 200x200, centred: 25% off each side.
    expect(onCropChange).toHaveBeenCalledWith({ left: 0.25, top: 0, right: 0.25, bottom: 0 })
  })

  it('computes a preset from the crop the clip already has', async () => {
    const { user, onCropChange } = await renderOpen({
      crop: { left: 0.5, top: 0, right: 0, bottom: 0 },
    })

    await user.click(screen.getByRole('button', { name: '16:9' }))

    // The clip shows the right half — 200x200 at x 200. A 16:9 region of that is
    // 200x112.5, centred on (300, 100).
    expect(onCropChange).toHaveBeenCalledWith({
      left: 0.5,
      top: expect.closeTo(0.21875, 6),
      right: 0,
      bottom: expect.closeTo(0.21875, 6),
    })
  })

  it('reports four zeroes for the None preset', async () => {
    const { user, onCropChange } = await renderOpen({
      crop: { left: 0.25, top: 0, right: 0, bottom: 0 },
    })

    await user.click(screen.getByRole('button', { name: 'None' }))

    expect(onCropChange).toHaveBeenCalledWith(NO_CROP)
  })

  it('reports four zeroes for the header Reset', async () => {
    const { user, onCropChange } = await renderOpen({
      crop: { left: 0.25, top: 0, right: 0, bottom: 0 },
    })

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    // The same write as the None preset, deliberately: "no crop" has one
    // meaning, and `normaliseCrop` turns it into `crop: undefined`.
    expect(onCropChange).toHaveBeenCalledWith(NO_CROP)
  })

  it('freezes every control on a locked track, Reset included', async () => {
    await renderOpen({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 }, disabled: true })

    // The four sliders, the four number fields and the five presets go inert
    // through `CollapsibleSection`'s disabled fieldset; Reset needs its own
    // flag, because `headerRight` sits outside that fieldset.
    expect(screen.getByLabelText('Left')).toBeDisabled()
    expect(screen.getByLabelText('Left crop percent')).toBeDisabled()
    expect(screen.getByRole('button', { name: '1:1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })
})
