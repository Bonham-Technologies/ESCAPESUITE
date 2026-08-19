import { render, screen } from '@testing-library/react'
import Home from './Home'

// Home renders no router-aware components (every link is a plain external <a>),
// so it needs no router wrapper.
function renderHome() {
  return render(<Home />)
}

describe('Home (open-source landing)', () => {
  it('renders the hero with Use-now CTAs for both tools', () => {
    renderHome()
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open the editor/i })).toBeInTheDocument()
  })

  it('links to GitHub and the offline build download', () => {
    renderHome()
    const github = screen.getAllByRole('link', { name: /github/i })[0]
    expect(github).toHaveAttribute('href', 'https://github.com/Bonham-Technologies/ESCAPESUITE')
    const download = screen.getAllByRole('link', { name: /offline build/i })[0]
    expect(download).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest'
    )
  })

  it('has no pricing, sign-in, or trial content', () => {
    renderHome()
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
  })

  it('describes the suite as free and open source', () => {
    renderHome()
    expect(screen.getAllByText(/open source/i).length).toBeGreaterThan(0)
  })

  it('exposes the open-source CTAs as links, not buttons nested in links', () => {
    const { container } = renderHome()

    // A <button> inside an <a> is invalid HTML and gives AT two roles for one
    // control — these CTAs navigate, so they must be plain anchors.
    expect(container.querySelector('a button')).toBeNull()

    // "View on GitHub" appears in both the hero and the open-source section.
    const repoLinks = screen.getAllByRole('link', { name: /view on github/i })
    expect(repoLinks).toHaveLength(2)
    for (const link of repoLinks) {
      expect(link).toHaveAttribute('href', 'https://github.com/Bonham-Technologies/ESCAPESUITE')
    }

    expect(screen.getByRole('link', { name: 'Download offline build' })).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest'
    )
  })
})
