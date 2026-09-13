// The "Text Content" section of the clip inspector, rendered on its own with
// explicit data so every control's onChange payload can be read directly.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextContentSection } from './TextContentSection'
import { rowColor } from '../../test/domQueries'
import type { TextOverlayData } from '../../store/types'
import styles from './ClipEditor.module.css'

const baseText: TextOverlayData = {
  text: 'Hello',
  x: 0.5,
  y: 0.5,
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#ffffff',
  backgroundColor: '#00000080',
  textAlign: 'center',
}

function renderSection(overrides: Partial<TextOverlayData> = {}) {
  const onChange = vi.fn()
  render(<TextContentSection textData={{ ...baseText, ...overrides }} onChange={onChange} />)
  return { onChange }
}

/** The section's only textarea. */
const textarea = () => screen.getByPlaceholderText('Enter text...') as HTMLTextAreaElement

/** The font-family <select> (the align <select> is the other one). */
const fontSelect = () =>
  screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'Arial')!

describe('TextContentSection', () => {
  it('sits inside a Text Content section showing the current text', () => {
    renderSection()

    expect(screen.getByText('Text Content')).toBeInTheDocument()
    expect(textarea()).toHaveValue('Hello')
    expect(textarea()).toHaveAttribute('rows', '2')
  })

  it('reports rewritten text', () => {
    const { onChange } = renderSection()

    fireEvent.change(textarea(), { target: { value: 'Goodbye' } })

    expect(onChange).toHaveBeenCalledWith({ text: 'Goodbye' })
  })

  it('auto-expands the textarea on focus and on every edit', async () => {
    const user = userEvent.setup()
    renderSection()

    expect(textarea().style.height).toBe('')

    await user.click(textarea())
    // jsdom reports scrollHeight 0, so the height is set but measures nothing;
    // what matters is that focus triggers the resize at all.
    expect(textarea().style.height).toBe('0px')

    textarea().style.height = ''
    fireEvent.change(textarea(), { target: { value: 'Two\nlines' } })
    expect(textarea().style.height).toBe('0px')
  })

  it('changes the font family', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection()

    await user.selectOptions(fontSelect(), 'Georgia')

    expect(onChange).toHaveBeenCalledWith({ fontFamily: 'Georgia' })
  })

  it('takes a font size within the input bounds', () => {
    const { onChange } = renderSection()
    const size = screen.getByTitle('Font size')

    expect(size).toHaveAttribute('min', '8')
    expect(size).toHaveAttribute('max', '200')

    fireEvent.change(size, { target: { value: '72' } })

    expect(onChange).toHaveBeenCalledWith({ fontSize: 72 })
  })

  it('floors a too-small font size at 8 and falls back to 48 for nonsense', () => {
    const { onChange } = renderSection()

    fireEvent.change(screen.getByTitle('Font size'), { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith({ fontSize: 8 })

    fireEvent.change(screen.getByTitle('Font size'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ fontSize: 48 })
  })

  it('turns bold on, and marks the button while it is on', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection()

    const boldButton = screen.getByRole('button', { name: 'B' })
    expect(boldButton).not.toHaveClass(styles.active)

    await user.click(boldButton)

    expect(onChange).toHaveBeenCalledWith({ fontWeight: 'bold' })
  })

  it('turns bold back off', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection({ fontWeight: 'bold' })

    const boldButton = screen.getByRole('button', { name: 'B' })
    expect(boldButton).toHaveClass(styles.active)

    await user.click(boldButton)

    expect(onChange).toHaveBeenCalledWith({ fontWeight: 'normal' })
  })

  it('turns italic on, and marks the button while it is on', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection()

    const italicButton = screen.getByRole('button', { name: 'I' })
    expect(italicButton).not.toHaveClass(styles.active)

    await user.click(italicButton)

    expect(onChange).toHaveBeenCalledWith({ fontStyle: 'italic' })
  })

  it('turns italic back off', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection({ fontStyle: 'italic' })

    const italicButton = screen.getByRole('button', { name: 'I' })
    expect(italicButton).toHaveClass(styles.active)

    await user.click(italicButton)

    expect(onChange).toHaveBeenCalledWith({ fontStyle: 'normal' })
  })

  it('changes the alignment', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection()
    const alignSelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'center')!

    await user.selectOptions(alignSelect, 'right')

    expect(onChange).toHaveBeenCalledWith({ textAlign: 'right' })
  })

  it('changes the text colour', () => {
    const { onChange } = renderSection()

    expect(rowColor('Text')).toHaveValue('#ffffff')
    fireEvent.change(rowColor('Text'), { target: { value: '#ff0000' } })

    expect(onChange).toHaveBeenCalledWith({ color: '#ff0000' })
  })

  it('shows the background colour without its alpha and writes one back at 80%', () => {
    const { onChange } = renderSection()

    expect(rowColor('BG')).toHaveValue('#000000')
    fireEvent.change(rowColor('BG'), { target: { value: '#123456' } })

    expect(onChange).toHaveBeenCalledWith({ backgroundColor: '#123456cc' })
  })
})
