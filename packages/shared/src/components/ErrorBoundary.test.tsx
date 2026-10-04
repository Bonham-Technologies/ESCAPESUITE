// The shared boundary, driven directly: a child that throws, a host's
// onError, the dev-only console.error, and the "no recovery" shape that
// keeps a second throw from ever reaching render again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message)
}

function Fine() {
  return <div data-testid="fine">all good</div>
}

// Captured fresh each test and restored in afterEach regardless of outcome
// (ESCSUITE-212 R6) — the "reload the page" test below stubs this, and an
// assertion failing between the stub and an inline restore would otherwise
// leave window.location stubbed for every test after it in this file.
let originalLocation: Location

beforeEach(() => {
  originalLocation = window.location
  vi.stubEnv('DEV', true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('fine')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the fallback panel — a heading, one sentence and a Reload button — when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    const panel = screen.getByRole('alert')
    expect(panel.querySelector('h1')).not.toBeNull()
    expect(panel.querySelector('p')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeNull()
  })

  it('keeps the Reload button outside the alert region (interactive content does not belong in role="alert")', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    const panel = screen.getByRole('alert')
    expect(panel.querySelector('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reload' }).closest('[role="alert"]')).toBeNull()
  })

  it('moves focus to the panel, so a keyboard or screen-reader user is not left with nothing to Tab to', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    // The focused element is the outer, tabIndex={-1} container the alert
    // region lives in, not the alert region itself.
    const panel = screen.getByRole('alert').parentElement
    expect(document.activeElement).toBe(panel)
  })

  it('reloads the page when the Reload button is clicked', () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('calls onError exactly once, with the error and React info', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary onError={onError}>
        <Boom message="specific failure" />
      </ErrorBoundary>
    )

    expect(onError).toHaveBeenCalledTimes(1)
    const [error, info] = onError.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('specific failure')
    expect(info).toHaveProperty('componentStack')
  })

  it('tolerates a throw with no onError prop at all', () => {
    expect(() =>
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      )
    ).not.toThrow()
    expect(screen.getByRole('alert')).not.toBeNull()
  })

  // React's own dev build logs a caught error to the console on its own,
  // regardless of this flag — these two assert on the boundary's *own*
  // "[ErrorBoundary]"-prefixed call specifically, not on console.error being
  // called at all.
  function ownLogCalls(): unknown[][] {
    return (console.error as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].startsWith('[ErrorBoundary]')
    )
  }

  it('does not log its own message in a production build', () => {
    vi.stubEnv('DEV', false)

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(ownLogCalls()).toHaveLength(0)
  })

  it('logs its own message in a dev build', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(ownLogCalls()).toHaveLength(1)
  })

  it('keeps showing one panel and does not call onError again once the parent hands it a different throwing child', () => {
    const onError = vi.fn()

    const { rerender } = render(
      <ErrorBoundary onError={onError}>
        <Boom message="first" />
      </ErrorBoundary>
    )
    expect(onError).toHaveBeenCalledTimes(1)

    // Move focus away from the panel before the second render, so a second,
    // unguarded focus() call on the re-render would be visible: componentDidCatch
    // only ever fires for a genuinely new catch (render() never re-renders the
    // children that already threw), so this proves no second focus call rides
    // along with the re-render itself.
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    expect(document.activeElement).toBe(elsewhere)

    rerender(
      <ErrorBoundary onError={onError}>
        <Boom message="second" />
      </ErrorBoundary>
    )

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(elsewhere)

    elsewhere.remove()
  })
})
