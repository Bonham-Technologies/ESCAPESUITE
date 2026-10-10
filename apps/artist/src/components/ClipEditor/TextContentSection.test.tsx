// The "Text Content" section of the clip inspector, rendered on its own with
// explicit data so every control's onChange payload can be read directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextContentSection } from './TextContentSection'
import { useClipEditorActions } from './useClipEditorActions'
import { BURST_PAUSE_MS } from './useBurstGesture'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
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

// ESCSUITE-242: one typing burst, or one colour-picker sweep, is one undo step.
//
// The textarea, the font-size field and the two swatches write on every event,
// and each write used to push an undo entry — so a caption typed in full, or one
// sweep of a picker, evicted the user's whole 50-entry history. A burst opens on
// the first edit and closes on blur or after `BURST_PAUSE_MS` with no edit; the
// store is still written on every event. These run the section against the real
// store, wired the way `ClipEditor` wires it.
describe('TextContentSection and the undo stack', () => {
  const past = () => store().history.past.length
  const textNow = () => store().project.timeline.clips[0].textData!

  function renderLive() {
    const writes = vi.spyOn(useEditorStore.getState(), 'updateTextOverlayData')
    function LiveSection() {
      const { selectedClip, handleTextDataChange, burstGesture } = useClipEditorActions()
      return (
        <TextContentSection
          textData={selectedClip!.textData!}
          onChange={handleTextDataChange}
          burstGesture={burstGesture}
        />
      )
    }
    const view = render(<LiveSection />)
    return { writes, unmount: view.unmount }
  }

  /** One keystroke's worth of `input`, then the gap a typist leaves before the next. */
  function type(field: HTMLElement, value: string, gapMs = 80) {
    fireEvent.input(field, { target: { value } })
    vi.advanceTimersByTime(gapMs)
  }

  /** Twenty keystrokes appending to "Text" — a short caption typed in one go. */
  function typeTwenty(field: HTMLElement, from = 'Text') {
    let value = from
    for (let i = 0; i < 20; i++) {
      value += 'abcdefghijklmnopqrst'[i]
      type(field, value)
    }
    return value
  }

  beforeEach(() => {
    resetStoreForTest()
    store().addTextOverlayClip()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records one entry for a twenty-keystroke burst, writing the store on every keystroke', () => {
    const { writes } = renderLive()
    const before = past()

    const typed = typeTwenty(textarea())

    expect(writes).toHaveBeenCalledTimes(20)
    expect(textNow().text).toBe(typed)
    expect(past() - before).toBe(1)
  })

  it('undoes the whole burst in one step, back to the text before it', () => {
    renderLive()

    typeTwenty(textarea())
    store().undo()

    expect(textNow().text).toBe('Text')
  })

  it('starts a second entry for typing that resumes after a pause', () => {
    renderLive()
    const before = past()

    const first = typeTwenty(textarea())
    vi.advanceTimersByTime(BURST_PAUSE_MS)
    typeTwenty(textarea(), first)

    expect(past() - before).toBe(2)
    store().undo()
    expect(textNow().text).toBe(first)
  })

  it('closes the burst on blur', () => {
    renderLive()
    const before = past()

    type(textarea(), 'Texta')
    type(textarea(), 'Textab')
    fireEvent.blur(textarea())
    type(textarea(), 'Textabc')

    expect(past() - before).toBe(2)
  })

  it('records one entry for a run of font-size changes', () => {
    renderLive()
    const before = past()
    const size = screen.getByTitle('Font size')

    for (const value of ['49', '50', '51', '52', '53']) type(size, value)

    expect(textNow().fontSize).toBe(53)
    expect(past() - before).toBe(1)
  })

  it('records one entry for a sweep of the text colour picker', () => {
    const { writes } = renderLive()
    const before = past()
    const swatch = rowColor('Text')

    for (let i = 0; i < 30; i++) {
      fireEvent.input(swatch, { target: { value: `#${(i * 8).toString(16).padStart(2, '0')}0000` } })
    }
    // The native picker's closing `change` carries the last `input`'s value.
    fireEvent.change(swatch, { target: { value: '#e80000' } })

    expect(writes).toHaveBeenCalledTimes(30)
    expect(textNow().color).toBe('#e80000')
    expect(past() - before).toBe(1)
  })

  it('records one entry for a sweep of the background picker, and a second sweep after blur', () => {
    renderLive()
    const before = past()
    const swatch = rowColor('BG')

    for (const value of ['#111111', '#222222', '#333333']) fireEvent.input(swatch, { target: { value } })
    fireEvent.blur(swatch)
    for (const value of ['#444444', '#555555']) fireEvent.input(swatch, { target: { value } })

    expect(textNow().backgroundColor).toBe('#555555cc')
    expect(past() - before).toBe(2)
  })

  it('keeps one entry per click of bold and one per choice of a select', () => {
    renderLive()
    const before = past()

    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    fireEvent.change(fontSelect(), { target: { value: 'Georgia' } })

    expect(past() - before).toBe(3)
  })

  it('ends an open burst and clears its timer when the panel unmounts', () => {
    const { unmount } = renderLive()

    type(textarea(), 'Texta')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
