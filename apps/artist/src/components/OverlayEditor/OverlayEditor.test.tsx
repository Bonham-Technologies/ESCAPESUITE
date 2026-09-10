import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverlayEditor } from './OverlayEditor'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { rowControl, rowColor, rowNumber } from '../../test/domQueries'
import type { ShapeOverlayData, TextOverlayData } from '../../store/types'
import styles from './OverlayEditor.module.css'

function slide(input: HTMLInputElement, value: number | string) {
  fireEvent.change(input, { target: { value: String(value) } })
}

const clipNow = () => store().project.timeline.clips[0]
const textData = () => clipNow().textData as TextOverlayData
const shapeData = () => clipNow().shapeData as ShapeOverlayData

/** Add an overlay through the store and then step back out to the list view. */
function addTextOverlayAndDeselect(text?: string) {
  const clip = store().addTextOverlayClip(text ? { text } : undefined)
  store().setSelectedClipId(null)
  return clip
}

describe('OverlayEditor list', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('says there is nothing to edit yet', () => {
    render(<OverlayEditor />)

    expect(screen.getByText('No overlays yet')).toBeInTheDocument()
    expect(screen.queryByText('Text Overlays')).not.toBeInTheDocument()
  })

  it('adds a text overlay and drops straight into its editor', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByRole('button', { name: 'Add Text' }))

    expect(clipNow().overlayType).toBe('text')
    expect(screen.getByRole('heading', { name: 'Text Overlay' })).toBeInTheDocument()
  })

  it.each([
    ['Rectangle', 'rectangle'],
    ['Ellipse', 'ellipse'],
    ['Arrow', 'arrow'],
    ['Blur', 'blur'],
  ])('adds a %s overlay and drops straight into its editor', async (button, type) => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByRole('button', { name: button }))

    expect(clipNow().shapeData?.type).toBe(type)
    expect(screen.getByRole('heading', { name: 'Shape Overlay' })).toBeInTheDocument()
  })

  it('lists a text overlay with its span on the timeline', () => {
    store().setCurrentTime(2)
    addTextOverlayAndDeselect('Hello')
    render(<OverlayEditor />)

    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('2.0s - 7.0s')).toBeInTheDocument()
    expect(screen.getByText('No shape overlays')).toBeInTheDocument()
  })

  it('truncates a long overlay label', () => {
    addTextOverlayAndDeselect('This label is very definitely longer than twenty characters')
    render(<OverlayEditor />)

    expect(screen.getByText(/^This label is very d\.\.\.$/)).toBeInTheDocument()
  })

  it('selects an overlay from the list', async () => {
    const user = userEvent.setup()
    const clip = addTextOverlayAndDeselect('Pick me')
    render(<OverlayEditor />)

    await user.click(screen.getByText('Pick me'))

    expect(store().selectedClipId).toBe(clip.id)
    expect(screen.getByRole('heading', { name: 'Text Overlay' })).toBeInTheDocument()
  })

  it('opens a shape overlay from the list', async () => {
    const user = userEvent.setup()
    const clip = store().addShapeOverlayClip({ type: 'ellipse' })
    store().setSelectedClipId(null)
    render(<OverlayEditor />)

    await user.click(screen.getByText('ellipse'))

    expect(store().selectedClipId).toBe(clip.id)
    expect(screen.getByRole('heading', { name: 'Shape Overlay' })).toBeInTheDocument()
  })

  it('lists every overlay clip with an icon for its shape', () => {
    for (const type of ['rectangle', 'ellipse', 'line', 'arrow'] as const) {
      store().addShapeOverlayClip({ type })
    }
    store().setSelectedClipId(null)
    render(<OverlayEditor />)

    const list = screen.getByText('Shape Overlays').parentElement as HTMLElement
    expect(list.querySelectorAll(`.${styles.overlayItem}`)).toHaveLength(4)
    for (const icon of ['\u25a2', '\u25cb', '\u2014', '\u2192']) {
      expect(screen.getByText(icon)).toBeInTheDocument()
    }
  })

  it('lists shape overlays and reports the missing text ones', () => {
    store().addShapeOverlayClip({ type: 'rectangle' })
    store().setSelectedClipId(null)
    render(<OverlayEditor />)

    expect(screen.getByText('No text overlays')).toBeInTheDocument()
    expect(screen.getByText('rectangle')).toBeInTheDocument()
  })
})

describe('OverlayEditor text overlay clip', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().addTextOverlayClip()
  })

  it('steps back to the list', async () => {
    const user = userEvent.setup()
    const { container } = render(<OverlayEditor />)

    await user.click(container.querySelector(`.${styles.backButton}`) as HTMLElement)

    expect(store().selectedClipId).toBeNull()
    expect(screen.getByRole('heading', { name: 'Overlays' })).toBeInTheDocument()
  })

  it('deletes the overlay and clears the selection', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByTitle('Delete overlay'))

    expect(store().project.timeline.clips).toHaveLength(0)
    expect(store().selectedClipId).toBeNull()
  })

  it('rewrites the text', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    const field = screen.getByRole('textbox')
    await user.clear(field)
    await user.type(field, 'Ok')

    expect(textData().text).toBe('Ok')
  })

  it('changes the font family and size', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.selectOptions(
      screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'Arial')!,
      'Impact'
    )
    fireEvent.change(rowNumber('Font'), { target: { value: '96' } })

    expect(textData()).toMatchObject({ fontFamily: 'Impact', fontSize: 96 })
  })

  it('floors the font size at 8 and falls back to 48 on an empty field', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Font'), { target: { value: '2' } })
    expect(textData().fontSize).toBe(8)

    fireEvent.change(rowNumber('Font'), { target: { value: '' } })
    expect(textData().fontSize).toBe(48)
  })

  it('toggles bold and italic', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.click(screen.getByRole('button', { name: 'I' }))
    expect(textData()).toMatchObject({ fontWeight: 'bold', fontStyle: 'italic' })

    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.click(screen.getByRole('button', { name: 'I' }))
    expect(textData()).toMatchObject({ fontWeight: 'normal', fontStyle: 'normal' })
  })

  it('changes the alignment', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.selectOptions(
      screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'center')!,
      'left'
    )

    expect(textData().textAlign).toBe('left')
  })

  it('changes the colours', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowColor('Text'), { target: { value: '#ff00ff' } })
    fireEvent.change(rowColor('Background'), { target: { value: '#010203' } })

    expect(textData()).toMatchObject({ color: '#ff00ff', backgroundColor: '#010203cc' })
  })

  it('moves, scales and rotates the overlay', () => {
    render(<OverlayEditor />)

    slide(rowControl('X'), 0.25)
    slide(rowControl('Y'), 0.75)
    slide(rowControl('Scale'), 2)
    slide(rowControl('Rotate'), -90)

    expect(textData()).toMatchObject({ x: 0.25, y: 0.75, scale: 2, rotation: -90 })
    expect(screen.getByText('200%')).toBeInTheDocument()
    expect(screen.getByText('-90°')).toBeInTheDocument()
  })

  it('changes the clip length', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Length'), { target: { value: '8' } })

    expect(clipNow()).toMatchObject({ duration: 8, endTime: 8 })
  })

  it('never lets the clip length fall below a tenth of a second', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Length'), { target: { value: '0' } })

    expect(clipNow().duration).toBe(0.1)
  })

  it('changes the clip opacity', () => {
    render(<OverlayEditor />)

    slide(rowControl('Opacity'), 0.25)

    expect(clipNow().transform.opacity).toBeCloseTo(0.25)
    expect(screen.getByText('25%')).toBeInTheDocument()
  })
})

describe('OverlayEditor shape overlay clip', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().addShapeOverlayClip({ type: 'rectangle' })
  })

  it('steps back to the list', async () => {
    const user = userEvent.setup()
    const { container } = render(<OverlayEditor />)

    await user.click(container.querySelector(`.${styles.backButton}`) as HTMLElement)

    expect(store().selectedClipId).toBeNull()
  })

  it('deletes the overlay', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByTitle('Delete overlay'))

    expect(store().project.timeline.clips).toHaveLength(0)
  })

  it('changes the shape type', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.selectOptions(screen.getByRole('combobox'), 'line')

    expect(shapeData().type).toBe('line')
  })

  it('changes the fill, stroke colour and stroke width', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowColor('Fill'), { target: { value: '#112233' } })
    fireEvent.change(rowColor('Stroke'), { target: { value: '#445566' } })
    slide(rowControl('Stroke Width'), 9)

    expect(shapeData()).toMatchObject({
      fillColor: '#11223380',
      strokeColor: '#445566',
      strokeWidth: 9,
    })
    expect(screen.getByText('9px')).toBeInTheDocument()
  })

  it('moves and resizes the shape', () => {
    render(<OverlayEditor />)

    slide(rowControl('X'), 0.1)
    slide(rowControl('Y'), 0.2)
    slide(rowControl('Width'), 0.6)
    slide(rowControl('Height'), 0.4)
    slide(rowControl('Rotation'), 135)

    expect(shapeData()).toMatchObject({ x: 0.1, y: 0.2, width: 0.6, height: 0.4, rotation: 135 })
    expect(screen.getByText('135°')).toBeInTheDocument()
  })

  it('changes the clip length and opacity', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Length'), { target: { value: '3.5' } })
    slide(rowControl('Opacity'), 0.5)

    expect(clipNow()).toMatchObject({ duration: 3.5, endTime: 3.5 })
    expect(clipNow().transform.opacity).toBeCloseTo(0.5)
  })

  it('never lets the clip length fall below a tenth of a second', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Length'), { target: { value: 'nonsense' } })

    expect(clipNow().duration).toBe(0.1)
  })
})
