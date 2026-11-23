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
    expect(canonical).toHaveAttribute('href', 'https://escapesuite.tech/privacy')
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
    expect(screen.getByText(/^Last updated:/)).toHaveTextContent('Last updated: November 23, 2026')
  })

  // ESCSUITE-452: the offline build fetches a video when ESCAPEARTIST is given
  // that video's address (?video= or LOAD_VIDEO), as the /limitations page says,
  // so the policy can't say it makes no network requests at all.
  it('says the offline build fetches only a video address you give ESCAPEARTIST', () => {
    render(<Privacy />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/no network requests at all/)
    const sentence =
      /makes no network requests of its own; it fetches a video only when you give ESCAPEARTIST that video.s address/
    expect(screen.getByText(sentence, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(sentence, { selector: 'li' })).toBeInTheDocument()
  })

  // ESCSUITE-452: nothing backs a fixed 90 days; Vercel's reporting window
  // depends on the plan.
  it('states analytics retention as the Vercel plan window, not a fixed day count', () => {
    render(<Privacy />)
    const item = screen.getByText(/^Analytics data:/, { selector: 'strong' }).closest('li')
    expect(item).toHaveTextContent('Analytics data: Kept by Vercel for the reporting window of our plan')
    expect(item?.textContent).not.toMatch(/\d+ days/)
  })
})
