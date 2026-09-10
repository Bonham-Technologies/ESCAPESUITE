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
