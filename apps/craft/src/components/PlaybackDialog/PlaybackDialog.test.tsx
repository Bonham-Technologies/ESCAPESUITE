// The playback modal, driven by props only.
//
// The dialog is mostly a frame around VideoPlayer, so what is asserted here is
// the frame: the accessible name the App suite queries, the three ways it can
// be dismissed (backdrop, close button, the player's own Escape handling), the
// one way it must *not* be (a click inside the panel), and the fact that a
// dead video is logged rather than swallowed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlaybackDialog } from './PlaybackDialog'
import { installBrowserStubs, type BrowserStubs } from '../../test/doubles/browser'
import styles from '../../App.module.css'

let browser: BrowserStubs

beforeEach(() => {
  browser = installBrowserStubs()
})

afterEach(() => {
  browser.restore()
  vi.restoreAllMocks()
})

function renderDialog(options: { name?: string; url?: string; duration?: number } = {}) {
  const onClose = vi.fn()
  const { container } = render(
    <PlaybackDialog
      url={options.url ?? 'blob:take-7'}
      name={options.name ?? 'Standup Demo'}
      duration={options.duration ?? 65.9}
      onClose={onClose}
    />
  )
  return { onClose, container }
}

describe('PlaybackDialog framing', () => {
  it('is a modal dialog named after the recording', () => {
    renderDialog({ name: 'Standup Demo' })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Standup Demo')

    const title = document.getElementById('playback-title') as HTMLElement
    expect(title).toHaveTextContent('Standup Demo')
    expect(title).toHaveClass(styles.playbackTitle)
  })

  it('plays the URL it was given, with the stored duration rather than the file\'s', () => {
    const { container } = renderDialog({ url: 'blob:take-7', duration: 65.9 })

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video).toHaveAttribute('src', 'blob:take-7')

    // A WebM straight out of MediaRecorder reports Infinity here; the dialog's
    // knownDuration is what the player must believe instead.
    act(() => {
      Object.defineProperty(video, 'duration', { configurable: true, get: () => Infinity })
      fireEvent.loadedMetadata(video)
    })

    expect(container.querySelector(`.${styles.playbackContent}`)).toHaveTextContent('0:00 / 1:05')
  })
})

describe('PlaybackDialog dismissal', () => {
  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    await user.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when the click lands inside the panel', async () => {
    const user = userEvent.setup()
    const { onClose, container } = renderDialog()

    await user.click(container.querySelector(`.${styles.playbackContent}`) as HTMLElement)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from its own close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    const close = screen.getByRole('button', { name: 'Close playback' })
    expect(close).toHaveAttribute('title', 'Close (Esc)')

    await user.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the player reports Escape', () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PlaybackDialog errors', () => {
  it('logs a video that will not load, and leaves the dialog standing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container, onClose } = renderDialog()

    fireEvent.error(container.querySelector('video') as HTMLVideoElement)

    expect(consoleError).toHaveBeenCalledWith('Video playback error:', expect.any(Error))
    expect(consoleError.mock.calls[0][1]).toHaveProperty('message', 'Failed to load video')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
