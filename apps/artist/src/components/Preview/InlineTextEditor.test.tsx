import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineTextEditor, type InlineTextEditorProps } from './InlineTextEditor'

function renderEditor(overrides: Partial<InlineTextEditorProps> = {}) {
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  render(
    <InlineTextEditor
      clipId="clip1"
      text="Hello"
      x={100}
      y={50}
      fontFamily="Inter"
      fontSize={40}
      fontWeight="700"
      fontStyle="italic"
      color="#ff0000"
      textAlign="center"
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />
  )
  return { onCommit, onCancel, textarea: screen.getByRole('textbox') as HTMLTextAreaElement }
}

describe('InlineTextEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts focused with the existing text selected, so typing replaces it', async () => {
    const user = userEvent.setup()
    const { textarea, onCommit } = renderEditor()

    expect(textarea).toHaveFocus()
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe('Hello'.length)

    await user.keyboard('Goodbye')
    expect(textarea.value).toBe('Goodbye')

    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onCommit).toHaveBeenCalledWith('Goodbye')
  })

  it('commits the edited text on Meta+Enter', async () => {
    const user = userEvent.setup()
    const { textarea, onCommit, onCancel } = renderEditor()

    await user.clear(textarea)
    await user.type(textarea, 'New label')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onCommit).toHaveBeenCalledWith('New label')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('treats a bare Enter as a newline rather than a commit', async () => {
    const user = userEvent.setup()
    const { textarea, onCommit } = renderEditor()

    await user.clear(textarea)
    await user.type(textarea, 'one{Enter}two')

    expect(textarea.value).toBe('one\ntwo')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('cancels on Escape without committing', async () => {
    const user = userEvent.setup()
    const { textarea, onCommit, onCancel } = renderEditor()

    await user.clear(textarea)
    await user.type(textarea, 'discarded')
    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits when focus leaves the editor', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderEditor({ text: 'Caption' })

    await user.tab()

    expect(onCommit).toHaveBeenCalledWith('Caption')
  })

  it('does not commit a second time after the blur that follows a commit', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderEditor()

    await user.keyboard('{Control>}{Enter}{/Control}')
    await user.tab()

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not commit on the blur that follows a cancel', async () => {
    const user = userEvent.setup()
    const { onCommit, onCancel } = renderEditor()

    await user.keyboard('{Escape}')
    await user.tab()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('keeps its keystrokes away from the editor-wide shortcut handler', async () => {
    const user = userEvent.setup()
    const documentKeys = vi.fn()
    document.addEventListener('keydown', documentKeys)
    try {
      const { textarea } = renderEditor()
      await user.type(textarea, 'x')
      await user.keyboard('{Escape}')

      expect(documentKeys).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', documentKeys)
    }
  })

  it('mirrors the canvas text styling, offset by its own padding', () => {
    const { textarea } = renderEditor({ x: 100, y: 50, fontSize: 40 })

    // padding = fontSize * 0.15 = 6px
    expect(textarea.style.left).toBe('94px')
    expect(textarea.style.top).toBe('44px')
    expect(textarea.style.fontFamily).toBe('Inter')
    expect(textarea.style.fontSize).toBe('40px')
    expect(textarea.style.fontWeight).toBe('700')
    expect(textarea.style.fontStyle).toBe('italic')
    expect(textarea.style.color).toBe('rgb(255, 0, 0)')
    expect(textarea.style.textAlign).toBe('center')
  })

  it.each([
    ['start', 'left'],
    ['end', 'right'],
    ['left', 'left'],
    ['right', 'right'],
  ] as const)('maps the canvas alignment %s to CSS %s', (canvasAlign, cssAlign) => {
    const { textarea } = renderEditor({ textAlign: canvasAlign })

    expect(textarea.style.textAlign).toBe(cssAlign)
  })

  it('re-measures itself as the text changes', async () => {
    const user = userEvent.setup()
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    const { textarea } = renderEditor()

    await user.type(textarea, 'abc')

    expect(raf).toHaveBeenCalledTimes(3)
    // jsdom reports no layout, so the editor falls back to its minimum width.
    expect(textarea.style.width).toBe('60px')
  })
})
