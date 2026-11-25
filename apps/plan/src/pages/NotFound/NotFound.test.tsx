import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotFound from './NotFound'
import { applyNotFoundHead } from '../../lib/routeMeta'
import indexHtml from '../../../index.html?raw'

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
  // ESCSUITE-489: the running page sets the same head the hosted 404.html is
  // served with, and takes its noindex away again when the visitor moves on.
  it('sets the head 404.html is served with: noindex, no canonical, no og:url', () => {
    const headHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html').head.innerHTML
    document.head.innerHTML = headHtml(indexHtml)
    const { unmount } = renderPage()

    const robots = document.head.querySelector('meta[name="robots"]')
    expect(robots).toHaveAttribute('content', 'noindex')
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull()
    const served = new DOMParser().parseFromString(applyNotFoundHead(indexHtml), 'text/html')
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:title"]']) {
      expect(document.head.querySelector(selector)?.getAttribute('content'), selector).toBe(
        served.head.querySelector(selector)?.getAttribute('content')
      )
    }

    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
})
