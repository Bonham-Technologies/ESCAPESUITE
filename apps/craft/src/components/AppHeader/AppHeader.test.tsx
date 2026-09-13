// The app bar, rendered from props alone.
//
// Two of the header's decisions are not props — whether there is a suite to go
// back to, and where the editor lives — so `@escapesuite/shared/config` is
// doubled here the same way the App suite doubles it, and everything else is
// this component's own rendering.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeader } from './AppHeader'
import type { RecordingState } from '../../store/types'
import styles from '../../App.module.css'

const { isStandaloneMode } = vi.hoisted(() => ({ isStandaloneMode: vi.fn(() => false) }))
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isStandaloneMode,
}))

let openSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  isStandaloneMode.mockReturnValue(false)
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderHeader(state: RecordingState = 'idle') {
  const onOpenHelp = vi.fn()
  const { container } = render(<AppHeader state={state} onOpenHelp={onOpenHelp} />)
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

  it.each(['preparing', 'countdown'] as RecordingState[])(
    'says nothing while %s',
    (state) => {
      renderHeader(state)

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
  )
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
