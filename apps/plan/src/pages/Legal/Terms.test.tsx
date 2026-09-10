import { render, screen } from '@testing-library/react'
import Terms from './Terms'

describe('Terms', () => {
  it('renders the Terms of Service heading', () => {
    render(<Terms />)
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
  })

  it('sets the document title and canonical link via useSeo', () => {
    render(<Terms />)
    expect(document.title).toBe('Terms of Service — ESCAPE Suite')
    const canonical = document.head.querySelector('link[rel="canonical"]')
    expect(canonical).toHaveAttribute('href', 'https://www.escapesuite.io/terms')
  })

  it('links to the Privacy Policy', () => {
    render(<Terms />)
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  })
})
