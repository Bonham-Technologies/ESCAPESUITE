import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotFound from './NotFound'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/no-such-page-xyz']}>
      <NotFound />
    </MemoryRouter>
  )
}

describe('NotFound (ESCSUITE-455)', () => {
  it('says the page was not found', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('sets a not-found document title', () => {
    renderPage()
    expect(document.title).toBe('Page not found — ESCAPE Suite')
  })

  it('links home, ESCAPECRAFT and ESCAPEARTIST', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    // Vitest runs in dev mode, where the tools are on their own dev ports.
    expect(screen.getByRole('link', { name: 'Open ESCAPECRAFT' })).toHaveAttribute(
      'href',
      'http://localhost:5174'
    )
    expect(screen.getByRole('link', { name: 'Open ESCAPEARTIST' })).toHaveAttribute(
      'href',
      'http://localhost:5175'
    )
  })
})
