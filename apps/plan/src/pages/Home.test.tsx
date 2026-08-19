import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  )
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
})
