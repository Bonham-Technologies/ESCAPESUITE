import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Limitations from './Limitations'
import { LIMITATIONS, NETWORK_SILENCE_SPEC_URL } from './limitations'

function renderPage() {
  return render(
    <MemoryRouter>
      <Limitations />
    </MemoryRouter>
  )
}

describe('Limitations', () => {
  it('renders the page heading', () => {
    renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Known limitations, and how to check nothing leaves' })
    ).toBeInTheDocument()
  })

  it('sets the document title and canonical link via useSeo', () => {
    renderPage()
    expect(document.title).toBe('Known limitations — ESCAPE Suite')
    const canonical = document.head.querySelector('link[rel="canonical"]')
    expect(canonical).toHaveAttribute('href', 'https://www.escapesuite.io/limitations')
  })

  it('renders every limitation as its own section, with its sources', () => {
    renderPage()
    for (const limitation of LIMITATIONS) {
      const section = document.getElementById(limitation.id)
      expect(section, limitation.id).not.toBeNull()
      const inSection = within(section as HTMLElement)
      expect(inSection.getByRole('heading', { level: 3, name: limitation.title })).toBeInTheDocument()
      expect(inSection.getByText(/^Source/)).toBeInTheDocument()
      for (const source of limitation.sources) {
        if (source.href === undefined) {
          expect(inSection.getByText(source.label, { exact: false })).toBeInTheDocument()
        } else {
          expect(inSection.getByRole('link', { name: source.label })).toHaveAttribute('href', source.href)
        }
      }
    }
  })

  it('opens repository sources in a new tab, and keeps site links in the app', () => {
    renderPage()
    const repoLink = screen.getAllByRole('link', { name: 'docs/reference/key-constraints.md' })[0]
    expect(repoLink).toHaveAttribute('target', '_blank')
    expect(repoLink).toHaveAttribute('rel', 'noopener noreferrer')

    const privacy = within(document.getElementById('hosted-analytics') as HTMLElement).getByRole('link', {
      name: 'Privacy Policy',
    })
    expect(privacy).toHaveAttribute('href', '/privacy')
    expect(privacy).not.toHaveAttribute('target')
  })

  it('gives a "Check it yourself" recipe that links to the network-silence spec', () => {
    renderPage()
    const heading = screen.getByRole('heading', { level: 2, name: 'Check it yourself' })
    const section = heading.closest('section') as HTMLElement
    const inSection = within(section)

    expect(inSection.getByText(/Network panel/)).toBeInTheDocument()
    expect(inSection.getByText('pnpm test:e2e:standalone')).toBeInTheDocument()
    expect(inSection.getByText('pnpm test:e2e:production')).toBeInTheDocument()
    expect(inSection.getByRole('link', { name: 'network-silence.spec.ts' })).toHaveAttribute(
      'href',
      NETWORK_SILENCE_SPEC_URL
    )
  })
})
