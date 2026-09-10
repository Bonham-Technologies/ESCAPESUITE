// The legacy (pre-clip) overlay editors.
//
// Projects saved before overlays became timeline clips still carry
// timeline.textOverlays / timeline.shapeOverlays, and OverlayEditor keeps a
// whole second set of panels for them. They are only reachable through
// setSelectedOverlay, which is what these tests drive.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverlayEditor } from './OverlayEditor'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { rowControl, rowColor, rowNumber } from '../../test/domQueries'
import styles from './OverlayEditor.module.css'

function slide(input: HTMLInputElement, value: number | string) {
  fireEvent.change(input, { target: { value: String(value) } })
}

const textOverlay = () => store().project.timeline.textOverlays![0]
const shapeOverlay = () => store().project.timeline.shapeOverlays![0]

const backButton = (container: HTMLElement) =>
  container.querySelector(`.${styles.backButton}`) as HTMLElement

describe('OverlayEditor legacy list', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('lists legacy text and shape overlays alongside the clip ones', () => {
    store().addTextOverlay({ text: 'Legacy caption' })
    store().addShapeOverlay({ type: 'ellipse' })
    store().setSelectedOverlay(null, null)
    render(<OverlayEditor />)

    expect(screen.getByText('Legacy caption')).toBeInTheDocument()
    expect(screen.getByText('ellipse')).toBeInTheDocument()
    expect(screen.queryByText('No overlays yet')).not.toBeInTheDocument()
  })

  it('truncates a long legacy label', () => {
    store().addTextOverlay({ text: 'A legacy caption that runs well past twenty characters' })
    store().setSelectedOverlay(null, null)
    render(<OverlayEditor />)

    expect(screen.getByText(/^A legacy caption tha\.\.\.$/)).toBeInTheDocument()
  })

  it('opens the legacy text editor from the list', async () => {
    const user = userEvent.setup()
    const overlay = store().addTextOverlay({ text: 'Legacy caption' })
    store().setSelectedOverlay(null, null)
    render(<OverlayEditor />)

    await user.click(screen.getByText('Legacy caption'))

    expect(store().selectedOverlayId).toBe(overlay.id)
    expect(screen.getByRole('heading', { name: 'Text Overlay (Legacy)' })).toBeInTheDocument()
  })

  it('opens the legacy shape editor from the list', async () => {
    const user = userEvent.setup()
    store().addShapeOverlay({ type: 'arrow' })
    store().setSelectedOverlay(null, null)
    render(<OverlayEditor />)

    await user.click(screen.getByText('arrow'))

    expect(store().selectedOverlayType).toBe('shape')
    expect(screen.getByRole('heading', { name: 'Shape Overlay (Legacy)' })).toBeInTheDocument()
  })
})

describe('OverlayEditor legacy text overlay', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().addTextOverlay()
  })

  it('steps back to the list', async () => {
    const user = userEvent.setup()
    const { container } = render(<OverlayEditor />)

    await user.click(backButton(container))

    expect(store().selectedOverlayId).toBeNull()
    expect(store().selectedOverlayType).toBeNull()
    expect(screen.getByRole('heading', { name: 'Overlays' })).toBeInTheDocument()
  })

  it('deletes the overlay', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByTitle('Delete overlay'))

    expect(store().project.timeline.textOverlays).toHaveLength(0)
  })

  it('rewrites the text', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    const field = screen.getByRole('textbox')
    await user.clear(field)
    await user.type(field, 'Hi')

    expect(textOverlay().text).toBe('Hi')
  })

  it('changes the font family and size, flooring the size at 8', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.selectOptions(
      screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'Arial')!,
      'Verdana'
    )
    fireEvent.change(rowNumber('Font'), { target: { value: '120' } })
    expect(textOverlay()).toMatchObject({ fontFamily: 'Verdana', fontSize: 120 })

    fireEvent.change(rowNumber('Font'), { target: { value: '1' } })
    expect(textOverlay().fontSize).toBe(8)

    fireEvent.change(rowNumber('Font'), { target: { value: '' } })
    expect(textOverlay().fontSize).toBe(48)
  })

  it('toggles bold and italic', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.click(screen.getByRole('button', { name: 'I' }))
    expect(textOverlay()).toMatchObject({ fontWeight: 'bold', fontStyle: 'italic' })

    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.click(screen.getByRole('button', { name: 'I' }))
    expect(textOverlay()).toMatchObject({ fontWeight: 'normal', fontStyle: 'normal' })
  })

  it('changes the alignment and colours', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.selectOptions(
      screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'center')!,
      'right'
    )
    fireEvent.change(rowColor('Text'), { target: { value: '#00ff00' } })
    fireEvent.change(rowColor('Background'), { target: { value: '#334455' } })

    expect(textOverlay()).toMatchObject({
      textAlign: 'right',
      color: '#00ff00',
      backgroundColor: '#334455cc',
    })
  })

  it('moves the overlay', () => {
    render(<OverlayEditor />)

    slide(rowControl('X'), 0.3)
    slide(rowControl('Y'), 0.7)

    expect(textOverlay()).toMatchObject({ x: 0.3, y: 0.7 })
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('changes the timing, keeping the start at or after zero', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Start'), { target: { value: '2' } })
    fireEvent.change(rowNumber('End'), { target: { value: '9' } })
    expect(textOverlay()).toMatchObject({ startTime: 2, endTime: 9 })

    fireEvent.change(rowNumber('Start'), { target: { value: '-4' } })
    expect(textOverlay().startTime).toBe(0)
  })

  it('never lets the end fall back past the start', () => {
    render(<OverlayEditor />)
    fireEvent.change(rowNumber('Start'), { target: { value: '3' } })

    fireEvent.change(rowNumber('End'), { target: { value: '1' } })

    expect(textOverlay().endTime).toBeCloseTo(3.1)
  })

  it('changes the opacity', () => {
    render(<OverlayEditor />)

    slide(rowControl('Opacity'), 0.4)

    expect(textOverlay().opacity).toBeCloseTo(0.4)
    expect(screen.getByText('40%')).toBeInTheDocument()
  })
})

describe('OverlayEditor legacy shape overlay', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().addShapeOverlay()
  })

  it('steps back to the list', async () => {
    const user = userEvent.setup()
    const { container } = render(<OverlayEditor />)

    await user.click(backButton(container))

    expect(store().selectedOverlayId).toBeNull()
  })

  it('deletes the overlay', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.click(screen.getByTitle('Delete overlay'))

    expect(store().project.timeline.shapeOverlays).toHaveLength(0)
  })

  it('changes the shape type', async () => {
    const user = userEvent.setup()
    render(<OverlayEditor />)

    await user.selectOptions(screen.getByRole('combobox'), 'blur')

    expect(shapeOverlay().type).toBe('blur')
  })

  it('changes the colours and stroke width', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowColor('Fill'), { target: { value: '#aabbcc' } })
    fireEvent.change(rowColor('Stroke'), { target: { value: '#ddeeff' } })
    slide(rowControl('Stroke Width'), 4)

    expect(shapeOverlay()).toMatchObject({
      fillColor: '#aabbcc80',
      strokeColor: '#ddeeff',
      strokeWidth: 4,
    })
  })

  it('moves, resizes and rotates the shape', () => {
    render(<OverlayEditor />)

    slide(rowControl('X'), 0.4)
    slide(rowControl('Y'), 0.6)
    slide(rowControl('Width'), 0.5)
    slide(rowControl('Height'), 0.3)
    slide(rowControl('Rotation'), 200)

    expect(shapeOverlay()).toMatchObject({ x: 0.4, y: 0.6, width: 0.5, height: 0.3, rotation: 200 })
    expect(screen.getByText('200°')).toBeInTheDocument()
  })

  it('changes the timing and opacity', () => {
    render(<OverlayEditor />)

    fireEvent.change(rowNumber('Start'), { target: { value: '1.5' } })
    fireEvent.change(rowNumber('End'), { target: { value: '6' } })
    slide(rowControl('Opacity'), 0.8)

    expect(shapeOverlay()).toMatchObject({ startTime: 1.5, endTime: 6 })
    expect(shapeOverlay().opacity).toBeCloseTo(0.8)
  })

  it('never lets the end fall back past the start', () => {
    render(<OverlayEditor />)
    fireEvent.change(rowNumber('Start'), { target: { value: '2' } })

    fireEvent.change(rowNumber('End'), { target: { value: '0' } })

    expect(shapeOverlay().endTime).toBeCloseTo(2.1)
  })
})
