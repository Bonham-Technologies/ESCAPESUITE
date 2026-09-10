import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { rowControl, rowColor } from '../../test/domQueries'
import type { ShapeOverlayData, TextOverlayData } from '../../store/types'
import styles from './ClipEditor.module.css'

function slide(input: HTMLInputElement, value: number | string) {
  fireEvent.change(input, { target: { value: String(value) } })
}

const clipNow = () => store().project.timeline.clips[0]
const textData = () => clipNow().textData as TextOverlayData
const shapeData = () => clipNow().shapeData as ShapeOverlayData

/** The panel's only textarea — the text overlay's content field. */
const textarea = () => screen.getByPlaceholderText('Enter text...') as HTMLTextAreaElement

describe('ClipEditor text overlay', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().addTextOverlayClip()
  })

  it('calls the clip a text overlay and shows its content', () => {
    render(<ClipEditor />)

    expect(screen.getByText('Text Overlay')).toBeInTheDocument()
    expect(textarea()).toHaveValue('Text')
  })

  it('rewrites the text and renames the clip with it', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.clear(textarea())
    await user.type(textarea(), 'Hi')

    expect(textData().text).toBe('Hi')
    expect(clipNow().name).toBe('Hi')
  })

  it('auto-expands the textarea when it takes focus', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    expect(textarea().style.height).toBe('')
    await user.click(textarea())

    // jsdom reports scrollHeight 0, so the height is set but measures nothing;
    // what matters is that focus triggers the resize at all.
    expect(textarea().style.height).toBe('0px')
  })

  it('changes the font family and size', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    const fontSelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'Arial')!
    await user.selectOptions(fontSelect, 'Georgia')
    expect(textData().fontFamily).toBe('Georgia')

    fireEvent.change(screen.getByTitle('Font size'), { target: { value: '72' } })
    expect(textData().fontSize).toBe(72)
  })

  it('floors the font size at 8 and falls back to 48 when the field is emptied', () => {
    render(<ClipEditor />)

    fireEvent.change(screen.getByTitle('Font size'), { target: { value: '4' } })
    expect(textData().fontSize).toBe(8)

    fireEvent.change(screen.getByTitle('Font size'), { target: { value: '' } })
    expect(textData().fontSize).toBe(48)
  })

  it('toggles bold on and back off', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(textData().fontWeight).toBe('bold')
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass(styles.active)

    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(textData().fontWeight).toBe('normal')
  })

  it('toggles italic on and back off', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.click(screen.getByRole('button', { name: 'I' }))
    expect(textData().fontStyle).toBe('italic')

    await user.click(screen.getByRole('button', { name: 'I' }))
    expect(textData().fontStyle).toBe('normal')
  })

  it('changes the text alignment', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    const align = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'center')!
    await user.selectOptions(align, 'right')

    expect(textData().textAlign).toBe('right')
  })

  it('changes the text and background colours, keeping the background translucent', () => {
    render(<ClipEditor />)

    fireEvent.change(rowColor('Text'), { target: { value: '#ff0000' } })
    fireEvent.change(rowColor('BG'), { target: { value: '#123456' } })

    expect(textData().color).toBe('#ff0000')
    expect(textData().backgroundColor).toBe('#123456cc')
  })

  it('moves the overlay through its own position data, not the clip transform', () => {
    render(<ClipEditor />)

    slide(rowControl('Pos X'), 0.2)
    slide(rowControl('Pos Y'), 0.8)

    expect(textData()).toMatchObject({ x: 0.2, y: 0.8 })
    expect(clipNow().transform).toMatchObject({ x: 0.5, y: 0.5 })
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('recentres the overlay when the transform is reset', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)
    slide(rowControl('Pos X'), 0.9)

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(textData()).toMatchObject({ x: 0.5, y: 0.5 })
  })
})

describe('ClipEditor shape overlay', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().addShapeOverlayClip({ type: 'rectangle' })
  })

  it('calls the clip a shape overlay', () => {
    render(<ClipEditor />)

    expect(screen.getByText('Shape Overlay')).toBeInTheDocument()
  })

  it('changes the shape type and renames the clip', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'ellipse')

    expect(shapeData().type).toBe('ellipse')
    expect(clipNow().name).toBe('Ellipse')
  })

  it('keeps the fill alpha when the fill colour changes', () => {
    store().updateShapeOverlayData(clipNow().id, { fillColor: '#00000080' })
    render(<ClipEditor />)

    fireEvent.change(rowColor('Fill'), { target: { value: '#abcdef' } })

    expect(shapeData().fillColor).toBe('#abcdef80')
  })

  it('changes the stroke colour and width', () => {
    render(<ClipEditor />)

    fireEvent.change(rowColor('Stroke'), { target: { value: '#00ff00' } })
    slide(rowControl('Stroke'), 6)

    expect(shapeData()).toMatchObject({ strokeColor: '#00ff00', strokeWidth: 6 })
  })

  it('turns the fill off and back on', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.click(screen.getByTitle('No fill (transparent)'))
    expect(shapeData().fillColor).toBe('#00000000')
    // With no fill there is nothing to set an opacity on
    expect(screen.queryByText('Fill opacity')).not.toBeInTheDocument()
    expect(rowColor('Fill')).toBeDisabled()

    await user.click(screen.getByTitle('Enable fill'))
    expect(shapeData().fillColor).toBe('#00000080')
  })

  it('sets the fill opacity as an alpha channel', () => {
    render(<ClipEditor />)

    slide(rowControl('Fill opacity'), 50)

    // 50% of 255 rounds to 128 = 0x80
    expect(shapeData().fillColor).toBe('#00000080')
    expect(rowControl('Fill opacity')).toHaveValue('50')
  })

  it('resizes and rotates the shape', () => {
    render(<ClipEditor />)

    slide(rowControl('Size W'), 0.6)
    slide(rowControl('Size H'), 0.4)
    slide(rowControl('Rotation'), 45)

    expect(shapeData()).toMatchObject({ width: 0.6, height: 0.4, rotation: 45 })
    expect(screen.getByText('45°')).toBeInTheDocument()
  })

  it('blurs the region underneath', () => {
    render(<ClipEditor />)

    slide(rowControl('Blur'), 20)

    expect(shapeData().blurAmount).toBe(20)
    expect(screen.getByText('20px')).toBeInTheDocument()
  })

  it('moves the shape through its own position data', () => {
    render(<ClipEditor />)

    slide(rowControl('Pos X'), 0.1)
    slide(rowControl('Pos Y'), 0.9)

    expect(shapeData()).toMatchObject({ x: 0.1, y: 0.9 })
  })

  it('restores position, size and rotation when the transform is reset', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)
    slide(rowControl('Size W'), 0.9)
    slide(rowControl('Rotation'), 90)

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(shapeData()).toMatchObject({ x: 0.5, y: 0.5, width: 0.2, height: 0.2, rotation: 0 })
  })

  it('offers only a blur amount for a blur region', async () => {
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'blur')

    expect(screen.getByText('Blurs the video underneath this region')).toBeInTheDocument()
    expect(screen.queryByTitle('No fill (transparent)')).not.toBeInTheDocument()

    slide(rowControl('Blur Amount'), 30)
    expect(shapeData().blurAmount).toBe(30)
  })

  it('shows no timing controls it cannot honour for an overlay', () => {
    render(<ClipEditor />)

    // Overlays have no source media, so splitting and blending are not offered
    expect(screen.queryByRole('button', { name: 'Split' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Blend Mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transition Out' })).not.toBeInTheDocument()
  })
})
