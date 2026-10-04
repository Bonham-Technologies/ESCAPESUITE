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

beforeEach(() => {
  vi.stubEnv('DEV', true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
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

  it('reloads the page when the Reload button is clicked', () => {
    const reload = vi.fn()
    const originalLocation = window.location
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

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
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

    rerender(
      <ErrorBoundary onError={onError}>
        <Boom message="second" />
      </ErrorBoundary>
    )

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
