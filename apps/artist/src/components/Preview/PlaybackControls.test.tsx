// The transport buttons and their keyboard shortcuts.
//
// PlaybackControls owns no canvas: it reads the store for the timeline's
// duration and the playhead, and writes back through the same actions the
// keyboard shortcuts use. Nothing here renders the preview.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlaybackControls } from './PlaybackControls'
import { TRANSPORT_KEYS } from './transportKeys'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

beforeEach(() => {
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlaybackControls', () => {
  const withClip = () => addClip('clip1', 0, 10)

  it('renders all control buttons', () => {
    render(<PlaybackControls />)

    expect(screen.getByTitle('Go to start (Home)')).toBeInTheDocument()
    expect(screen.getByTitle('Step backward (←)')).toBeInTheDocument()
    expect(screen.getByTitle('Play (Space)')).toBeInTheDocument()
    expect(screen.getByTitle('Step forward (→)')).toBeInTheDocument()
    expect(screen.getByTitle('Go to end (End)')).toBeInTheDocument()
  })

  it('disables play when there is nothing to play', () => {
    render(<PlaybackControls />)

    expect(screen.getByTitle('Play (Space)')).toBeDisabled()
  })

  it('disables play once the playhead is at the end of the timeline', () => {
    withClip()
    store().setCurrentTime(10)

    render(<PlaybackControls />)

    expect(screen.getByTitle('Play (Space)')).toBeDisabled()
  })

  it('enables play when clips exist', () => {
    withClip()

    render(<PlaybackControls />)

    expect(screen.getByTitle('Play (Space)')).not.toBeDisabled()
  })

  it('goes to start when the button is clicked', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Go to start (Home)'))

    expect(store().currentTime).toBe(0)
  })

  it('steps backward when the button is clicked', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().currentTime).toBe(4)
  })

  it('steps forward when the button is clicked', () => {
    withClip()
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step forward (→)'))

    expect(store().currentTime).toBe(6)
  })

  it('goes to end when the button is clicked', () => {
    withClip()
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Go to end (End)'))

    expect(store().currentTime).toBe(10)
  })

  it('toggles play state when the play button is clicked', () => {
    withClip()
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Play (Space)'))

    expect(store().isPlaying).toBe(true)
  })

  it('shows the pause button while playing', () => {
    withClip()
    store().setIsPlaying(true)

    render(<PlaybackControls />)

    expect(screen.getByTitle('Pause (Space)')).toBeInTheDocument()
  })

  it('pauses from the pause button even at the end of the timeline', () => {
    withClip()
    store().setCurrentTime(10)
    store().setIsPlaying(true)

    render(<PlaybackControls />)
    fireEvent.click(screen.getByTitle('Pause (Space)'))

    expect(store().isPlaying).toBe(false)
  })

  it('clamps step backward to 0', () => {
    store().setCurrentTime(0.5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().currentTime).toBe(0)
  })

  it('clamps step forward to the timeline duration', () => {
    withClip()
    store().setCurrentTime(9.5)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step forward (→)'))

    expect(store().currentTime).toBe(10)
  })

  it('stops playback when the playhead is stepped', () => {
    withClip()
    store().setIsPlaying(true)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Step backward (←)'))

    expect(store().isPlaying).toBe(false)
  })

  it('stops playback when the playhead jumps to either end', () => {
    withClip()
    store().setIsPlaying(true)
    render(<PlaybackControls />)

    fireEvent.click(screen.getByTitle('Go to end (End)'))
    expect(store().isPlaying).toBe(false)

    store().setIsPlaying(true)
    fireEvent.click(screen.getByTitle('Go to start (Home)'))
    expect(store().isPlaying).toBe(false)
  })
})

describe('PlaybackControls keyboard shortcuts', () => {
  beforeEach(() => {
    addClip('clip1', 0, 10)
  })

  it('handles Space for play/pause', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'Space' })

    expect(store().isPlaying).toBe(true)
  })

  it('handles ArrowLeft for step backward', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'ArrowLeft' })

    expect(store().currentTime).toBe(4)
  })

  it('handles ArrowRight for step forward', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'ArrowRight' })

    expect(store().currentTime).toBe(6)
  })

  it('handles Home for go to start', () => {
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'Home' })

    expect(store().currentTime).toBe(0)
  })

  it('handles End for go to end', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'End' })

    expect(store().currentTime).toBe(10)
  })

  it('ignores every other key', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'KeyK' })

    expect(store().currentTime).toBe(0)
    expect(store().isPlaying).toBe(false)
  })

  it('leaves the transport alone while a text field has focus', () => {
    const input = document.createElement('input')
    document.body.append(input)
    render(<PlaybackControls />)

    fireEvent.keyDown(input, { code: 'Space' })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    fireEvent.keyDown(textarea, { code: 'ArrowRight' })

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(0)
    input.remove()
    textarea.remove()
  })

  it('leaves the transport alone while a select has focus', () => {
    const select = document.createElement('select')
    document.body.append(select)
    render(<PlaybackControls />)

    fireEvent.keyDown(select, { code: 'ArrowRight' })

    expect(store().currentTime).toBe(0)
    select.remove()
  })

  it('stops listening once it is unmounted', () => {
    const { unmount } = render(<PlaybackControls />)
    unmount()

    fireEvent.keyDown(window, { code: 'Space' })

    expect(store().isPlaying).toBe(false)
  })

  describe('with a modal in front', () => {
    it('leaves every transport key alone', () => {
      addClip('clip1', 0, 10)
      store().setCurrentTime(5)
      render(<PlaybackControls modalOpen={true} />)

      fireEvent.keyDown(window, { code: 'Space' })
      fireEvent.keyDown(window, { code: 'ArrowLeft' })
      fireEvent.keyDown(window, { code: 'ArrowRight' })
      fireEvent.keyDown(window, { code: 'Home' })
      fireEvent.keyDown(window, { code: 'End' })

      expect(store().isPlaying).toBe(false)
      expect(store().currentTime).toBe(5)
    })

    it('takes them again the moment the modal closes', () => {
      addClip('clip1', 0, 10)
      const { rerender } = render(<PlaybackControls modalOpen={true} />)

      fireEvent.keyDown(window, { code: 'Space' })
      expect(store().isPlaying).toBe(false)

      rerender(<PlaybackControls modalOpen={false} />)
      fireEvent.keyDown(window, { code: 'Space' })

      expect(store().isPlaying).toBe(true)
    })
  })
})

// ESCSUITE-247: Space belongs to the focused control (CRAFT's ESCSUITE-185 twin).
describe('PlaybackControls Space handling', () => {
  const press = (target: Element | Window, init: KeyboardEventInit) =>
    fireEvent.keyDown(target, { bubbles: true, cancelable: true, ...init })

  it('leaves Space to a focused transport button and does not toggle playback', () => {
    addClip('clip1', 0, 10)
    render(<PlaybackControls />)
    const button = screen.getByTitle('Step forward (→)')

    const notPrevented = press(button, { code: 'Space', key: ' ' })

    expect(notPrevented).toBe(true)
    expect(store().isPlaying).toBe(false)
  })

  it.each([
    ['a role="button" element', () => { const e = document.createElement('div'); e.setAttribute('role', 'button'); return e }],
    ['a link with an href', () => { const e = document.createElement('a'); e.setAttribute('href', '#x'); return e }],
    ['a select', () => document.createElement('select')],
    ['a range input', () => { const e = document.createElement('input'); e.type = 'range'; return e }],
  ])('leaves Space to %s', (_label, make) => {
    addClip('clip1', 0, 10)
    render(<PlaybackControls />)
    const el = make()
    document.body.appendChild(el)

    const notPrevented = press(el, { code: 'Space', key: ' ' })

    expect(notPrevented).toBe(true)
    expect(store().isPlaying).toBe(false)
    el.remove()
  })

  it('leaves Space to a contenteditable element', () => {
    addClip('clip1', 0, 10)
    render(<PlaybackControls />)
    const el = document.createElement('div')
    Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true })
    document.body.appendChild(el)

    expect(press(el, { code: 'Space', key: ' ' })).toBe(true)
    expect(store().isPlaying).toBe(false)
    el.remove()
  })

  it('still toggles playback from the body and from a plain element', () => {
    addClip('clip1', 0, 10)
    render(<PlaybackControls />)
    const plain = document.createElement('div')
    document.body.appendChild(plain)

    expect(press(plain, { code: 'Space', key: ' ' })).toBe(false)
    expect(store().isPlaying).toBe(true)
    press(document.body, { code: 'Space', key: ' ' })
    expect(store().isPlaying).toBe(false)
    plain.remove()
  })

  it('still toggles playback when the target is the window itself', () => {
    addClip('clip1', 0, 10)
    render(<PlaybackControls />)

    expect(press(window, { code: 'Space', key: ' ' })).toBe(false)
    expect(store().isPlaying).toBe(true)
  })

  it('keeps the arrows on a focused button (the gate is Space only)', () => {
    addClip('clip1', 0, 10)
    store().setCurrentTime(5)
    render(<PlaybackControls />)

    expect(press(screen.getByTitle('Step forward (→)'), { code: 'ArrowRight', key: 'ArrowRight' })).toBe(false)
    expect(store().currentTime).toBe(6)
  })

  it('keeps ignoring the arrows on a slider and a text field', () => {
    addClip('clip1', 0, 10)
    store().setCurrentTime(5)
    render(<PlaybackControls />)
    const range = document.createElement('input')
    range.type = 'range'
    const text = document.createElement('input')
    document.body.append(range, text)

    expect(press(range, { code: 'ArrowRight', key: 'ArrowRight' })).toBe(true)
    expect(press(text, { code: 'ArrowRight', key: 'ArrowRight' })).toBe(true)
    expect(store().currentTime).toBe(5)
    range.remove()
    text.remove()
  })
})

describe('PlaybackControls claims every key the sheet lists for the transport', () => {
  it.each([
    ['Space', 'Space'], ['←', 'ArrowLeft'], ['→', 'ArrowRight'], ['Home', 'Home'], ['End', 'End'],
  ])('%s is claimed (code %s)', (label, code) => {
    addClip('clip1', 0, 10)
    render(<PlaybackControls />)
    expect(TRANSPORT_KEYS).toContain(label)
    expect(fireEvent.keyDown(window, { code, cancelable: true })).toBe(false)
  })
})
