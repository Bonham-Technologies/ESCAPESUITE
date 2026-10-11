// The app bar, rendered from props alone.
//
// Two of the header's decisions are not props — whether there is a suite to go
// back to, and where the editor lives — so `@escapesuite/shared/config` is
// doubled here the same way the App suite doubles it, and everything else is
// this component's own rendering.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeader } from './AppHeader'
import { useRecorderStore } from '../../store/recorderStore'
import type { RecordingState } from '../../store/types'
import { EDITOR_FILE_ORIGIN_REASON } from '../../utils/sendToEditor'
import styles from '../../App.module.css'

const { isStandaloneMode, isFileOrigin, editorUrlIsRelative } = vi.hoisted(() => ({
  isStandaloneMode: vi.fn(() => false),
  isFileOrigin: vi.fn(() => false),
  editorUrlIsRelative: vi.fn(() => false),
}))
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isStandaloneMode,
  isFileOrigin,
  editorUrlIsRelative,
}))

let openSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useRecorderStore.setState({ countdownValue: 0 })
  isStandaloneMode.mockReturnValue(false)
  isFileOrigin.mockReturnValue(false)
  editorUrlIsRelative.mockReturnValue(false)
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderHeader(state: RecordingState = 'idle', notice: string | null = null) {
  const onOpenHelp = vi.fn()
  const { container } = render(<AppHeader state={state} notice={notice} onOpenHelp={onOpenHelp} />)
  return { onOpenHelp, container }
}

describe('AppHeader branding', () => {
  it('links back to the suite when it is not the standalone build', () => {
    renderHeader()

    const link = screen.getByTitle('Back to ESCAPE Suite')
    expect(link).toHaveAttribute('href', '/')
    expect(link).toHaveClass(styles.dashboardLink)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ESCAPECRAFT')
  })

  it('drops the suite link in the standalone build', () => {
    isStandaloneMode.mockReturnValue(true)

    renderHeader()

    expect(screen.queryByTitle('Back to ESCAPE Suite')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ESCAPECRAFT')
  })
})

describe('AppHeader status region', () => {
  it('is a polite, atomic live region that says nothing while idle', () => {
    const { container } = renderHeader('idle')

    const region = container.querySelector(`.${styles.headerCenter}`) as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(region).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces a running take with its blinking dot', () => {
    const { container } = renderHeader('recording')

    expect(screen.getByRole('status')).toHaveTextContent('Recording')
    expect(container.querySelector(`.${styles.recordingDot}`)).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces a paused take', () => {
    renderHeader('paused')

    expect(screen.getByRole('status')).toHaveTextContent('Paused')
    expect(screen.getByRole('status')).toHaveClass(styles.pausedIndicator)
  })

  it('announces a save in progress', () => {
    renderHeader('saving')

    expect(screen.getByRole('status')).toHaveTextContent('Saving...')
  })

  it('says nothing while preparing', () => {
    renderHeader('preparing')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says nothing during a countdown that has no number to show yet', () => {
    useRecorderStore.setState({ countdownValue: 0 })
    renderHeader('countdown')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each([3, 2, 1])('announces "Recording starts in %i" at that tick (ESCSUITE-231)', (n) => {
    useRecorderStore.setState({ countdownValue: n })
    renderHeader('countdown')

    expect(screen.getByRole('status')).toHaveTextContent(`Recording starts in ${n}`)
  })

  it('re-announces each tick through the one status span', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    renderHeader('countdown')

    act(() => {
      useRecorderStore.getState().setCountdown(2)
    })

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Recording starts in 2')
  })

  it('does not announce a stale number outside the countdown', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    renderHeader('recording')

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Recording$/)
  })

  it('hands over from the countdown phrase to the recording phrase without a second status span', () => {
    useRecorderStore.setState({ countdownValue: 1 })
    const onOpenHelp = vi.fn()
    const { rerender } = render(<AppHeader state="countdown" notice={null} onOpenHelp={onOpenHelp} />)
    expect(screen.getByRole('status')).toHaveTextContent('Recording starts in 1')

    useRecorderStore.setState({ countdownValue: 0 })
    rerender(<AppHeader state="recording" notice={null} onOpenHelp={onOpenHelp} />)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Recording$/)
  })
})

describe('AppHeader notices', () => {
  it('carries an error through the same live region the state uses', () => {
    const { container } = renderHeader('idle', 'The recording could not be saved.')

    const region = container.querySelector(`.${styles.headerCenter}`) as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('The recording could not be saved.')
  })

  it('leaves the region with exactly one role="status" when a take is running too', () => {
    renderHeader('recording', 'System audio was not shared.')

    // The notice is announced by the region's own aria-live rather than by a
    // second role="status": the promise this header makes is one status node.
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Recording')
    expect(screen.getByText('System audio was not shared.')).toBeTruthy()
  })

  it('says nothing when there is no notice', () => {
    const { container } = renderHeader('idle', null)

    expect(container.querySelector(`.${styles.headerCenter}`)).toBeEmptyDOMElement()
  })
})

describe('AppHeader buttons', () => {
  it('opens the help dialog through its caller', async () => {
    const user = userEvent.setup()
    const { onOpenHelp } = renderHeader()

    const help = screen.getByRole('button', { name: 'Help - Recording Tips' })
    expect(help).toHaveAttribute('title', 'Recording Tips')

    await user.click(help)

    expect(onOpenHelp).toHaveBeenCalledTimes(1)
  })

  it('opens the editor itself, in a named window it can reuse', async () => {
    const user = userEvent.setup()
    renderHeader()

    const editor = screen.getByRole('button', { name: 'Open Editor in new window' })
    expect(editor).toHaveAttribute('title', 'Open Editor')

    await user.click(editor)

    expect(openSpy).toHaveBeenCalledWith('/artist/', 'escapeartist')
  })
})

describe('AppHeader Open Editor under a file origin (ESCSUITE-221)', () => {
  it('is disabled with a visible reason it is described by, and opens nothing', async () => {
    isFileOrigin.mockReturnValue(true)
    const user = userEvent.setup()
    renderHeader()

    const editor = screen.getByRole('button', { name: 'Open Editor in new window' })
    expect(editor).toBeDisabled()
    expect(editor).toHaveAttribute('title', EDITOR_FILE_ORIGIN_REASON)
    expect(editor).toHaveAccessibleDescription(EDITOR_FILE_ORIGIN_REASON)
    expect(screen.getByText(EDITOR_FILE_ORIGIN_REASON)).toBeVisible()

    await user.click(editor)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('is enabled, titled "Open Editor" and carries no reason on an http origin', () => {
    renderHeader()

    const editor = screen.getByRole('button', { name: 'Open Editor in new window' })
    expect(editor).toBeEnabled()
    expect(editor).toHaveAttribute('title', 'Open Editor')
    expect(editor).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(EDITOR_FILE_ORIGIN_REASON)).not.toBeInTheDocument()
  })
})

describe('AppHeader Open Editor in a standalone build over http (ESCSUITE-259)', () => {
  it('is disabled with the reason when the editor URL is relative', async () => {
    isStandaloneMode.mockReturnValue(true)
    editorUrlIsRelative.mockReturnValue(true)
    const user = userEvent.setup()
    renderHeader()

    const editor = screen.getByRole('button', { name: 'Open Editor in new window' })
    expect(editor).toBeDisabled()
    expect(editor).toHaveAccessibleDescription(EDITOR_FILE_ORIGIN_REASON)
    expect(screen.getByText(EDITOR_FILE_ORIGIN_REASON)).toBeVisible()
    await user.click(editor)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('stays enabled when the build was given an absolute editor URL', () => {
    isStandaloneMode.mockReturnValue(true)
    renderHeader()

    expect(screen.getByRole('button', { name: 'Open Editor in new window' })).toBeEnabled()
  })

  it('stays enabled in a hosted build, whatever the editor URL', () => {
    editorUrlIsRelative.mockReturnValue(true)
    renderHeader()

    expect(screen.getByRole('button', { name: 'Open Editor in new window' })).toBeEnabled()
  })
})
