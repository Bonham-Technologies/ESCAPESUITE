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

  it('renders Known limitations at "/limitations"', () => {
    renderApp('/limitations')
    expect(
      screen.getByRole('heading', { level: 1, name: /known limitations/i })
    ).toBeInTheDocument()
  })

  // ESCSUITE-455: an unmatched path used to redirect to "/", so the hub answered
  // every made-up URL with its home page. It now shows a not-found page, the same
  // content the hosted site's 404.html renders, inside the shared Layout.
  it('renders the not-found page for an unmatched path, not the home page', () => {
    renderApp('/does-not-exist')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start recording/i })).not.toBeInTheDocument()
    expect(screen.getByText('ESCAPE')).toBeInTheDocument()
  })

  // The hosted site serves the hub's own document as a file at /index.html (200),
  // so a not-found page there would be a soft 404 at a real URL. It goes home,
  // as every unmatched path did before ESCSUITE-455.
  it('sends /index.html to the home page, not the not-found page', () => {
    renderApp('/index.html')
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
  })

  it('renders every route inside the shared Layout (header present)', () => {
    renderApp('/privacy')
    expect(screen.getByText('ESCAPE')).toBeInTheDocument()
  })
})
