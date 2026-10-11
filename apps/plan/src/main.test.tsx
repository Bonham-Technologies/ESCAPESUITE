// ESCSUITE-219: main.tsx mounts the shared ErrorBoundary inside <BrowserRouter>
// and around <App />. App is mocked to a component that always throws; the
// element tree main.tsx hands `createRoot().render` is rendered for real, so
// the boundary under test is the real one, not a mock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const renderSpy = vi.fn<(tree: ReactNode) => void>()
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: renderSpy }),
}))

function Boom(): never {
  throw new Error('kaboom')
}
vi.mock('./App', () => ({ default: Boom }))
vi.mock('./index.css', () => ({}))

beforeEach(() => {
  vi.resetModules()
  renderSpy.mockClear()
  document.body.innerHTML = '<div id="root"></div>'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('main', () => {
  it('shows the shared error panel with a Reload button when a page throws, instead of a blank page', async () => {
    await import('./main')
    expect(renderSpy).toHaveBeenCalledTimes(1)

    render(<>{renderSpy.mock.calls[0][0]}</>)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
  })
})
