import { render, screen } from '@testing-library/react'
import Privacy from './Privacy'

describe('Privacy', () => {
  it('renders the Privacy Policy heading', () => {
    render(<Privacy />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('sets the document title and canonical link via useSeo', () => {
    render(<Privacy />)
    expect(document.title).toBe('Privacy Policy — ESCAPE Suite')
    const canonical = document.head.querySelector('link[rel="canonical"]')
    expect(canonical).toHaveAttribute('href', 'https://www.escapesuite.io/privacy')
  })
})

describe('Privacy §2.1 usage analytics (ESCSUITE-407)', () => {
  function section21(): string {
    render(<Privacy />)
    const heading = screen.getByRole('heading', { level: 3, name: /2\.1 Usage Analytics/ })
    let text = ''
    for (let el = heading.nextElementSibling; el && el.tagName !== 'H3'; el = el.nextElementSibling) {
      text += ` ${el.textContent ?? ''}`
    }
    return text.replace(/\s+/g, ' ')
  }

  it('lists what Vercel Web Analytics records', () => {
    const text = section21()
    expect(text).toMatch(/path of the page you are on/)
    expect(text).toMatch(/never the part of the address after a \? or #/)
    expect(text).toMatch(/address of the site that sent you or shows the app inside its own page/)
    expect(text).toMatch(/browser, operating system and device type/)
    expect(text).toMatch(/approximate location, down to the city/)
  })

  it('says how the IP address is used instead of claiming it is not tracked', () => {
    const text = section21()
    expect(text).not.toMatch(/We do not track your IP address/)
    expect(text).toMatch(/Vercel works out .* from your IP address/)
    expect(text).toMatch(/says it does not store the IP address/)
  })

  it('keeps the no-cookies and no-identity statements', () => {
    const text = section21()
    expect(text).toMatch(/does not use cookies/)
    expect(text).toMatch(/not tied to any account or identity/)
  })

  it('no longer says location is never tracked', () => {
    render(<Privacy />)
    expect(document.body.textContent).not.toMatch(/We don't track your geographic location/)
  })

  it('bumps the last-updated date', () => {
    render(<Privacy />)
    expect(screen.getByText(/^Last updated:/)).toHaveTextContent('Last updated: November 11, 2026')
  })
})
