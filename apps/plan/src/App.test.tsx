import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from './App'

// Layout initializes the shared theme system on mount; mock it as a
// collaborator so App's route table can be tested without pulling in
// IndexedDB / matchMedia side effects.
vi.mock('@escapesuite/shared/theme', () => ({
  ThemeToggle: () => <button data-testid="theme-toggle">Theme</button>,
  initTheme: vi.fn(),
  cleanupTheme: vi.fn(),
}))

vi.mock('./utils/themeStorage', () => ({
  themeStorage: {
    load: vi.fn(),
    save: vi.fn(),
  },
}))

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  )
}

describe('App routes', () => {
  it('renders Home at "/"', () => {
    renderApp('/')
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
  })

  it('renders Privacy at "/privacy"', () => {
    renderApp('/privacy')
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('renders Terms at "/terms"', () => {
    renderApp('/terms')
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
  })

  it('redirects an unmatched path to "/"', () => {
    renderApp('/does-not-exist')
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
  })

  it('renders every route inside the shared Layout (header present)', () => {
    renderApp('/privacy')
    expect(screen.getByText('ESCAPE')).toBeInTheDocument()
  })
})
