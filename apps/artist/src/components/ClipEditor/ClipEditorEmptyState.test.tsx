// The inspector with nothing selected: a prompt, and the five buttons that
// create an overlay from scratch.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditorEmptyState } from './ClipEditorEmptyState'

function renderEmptyState() {
  const onAddText = vi.fn()
  const onAddShape = vi.fn()
  render(<ClipEditorEmptyState onAddText={onAddText} onAddShape={onAddShape} />)
  return { onAddText, onAddShape }
}

describe('ClipEditorEmptyState', () => {
  it('prompts for a selection and offers the overlays instead', () => {
    renderEmptyState()

    expect(screen.getByText('Select a clip to edit')).toBeInTheDocument()
    expect(screen.getByText('Or add an overlay:')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Add Text',
      'Rectangle',
      'Ellipse',
      'Arrow',
      'Blur',
    ])
  })

  it('asks for a text overlay', async () => {
    const user = userEvent.setup()
    const { onAddText, onAddShape } = renderEmptyState()

    await user.click(screen.getByRole('button', { name: 'Add Text' }))

    expect(onAddText).toHaveBeenCalledTimes(1)
    expect(onAddShape).not.toHaveBeenCalled()
  })

  it.each([
    ['Rectangle', 'rectangle'],
    ['Ellipse', 'ellipse'],
    ['Arrow', 'arrow'],
    ['Blur', 'blur'],
  ])('asks for a %s shape', async (label, type) => {
    const user = userEvent.setup()
    const { onAddText, onAddShape } = renderEmptyState()

    await user.click(screen.getByRole('button', { name: label }))

    expect(onAddShape).toHaveBeenCalledWith(type)
    expect(onAddText).not.toHaveBeenCalled()
  })
})
