import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Layout from './Layout'
import Header from './Header'

// Mock shared theme
vi.mock('@escapesuite/shared/theme', () => ({
  ThemeToggle: () => <button data-testid="theme-toggle">Theme</button>,
  initTheme: vi.fn(),
  cleanupTheme: vi.fn(),
}))

// Mock themeStorage
vi.mock('../../utils/themeStorage', () => ({
  themeStorage: {
    load: vi.fn(),
    save: vi.fn(),
  },
}))

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderHeader = () => {
    return render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderHeader()
    expect(document.body).toBeDefined()
  })

  it('displays logo', () => {
    renderHeader()
    expect(screen.getByText('ESCAPE')).toBeInTheDocument()
    expect(screen.getByText('Suite')).toBeInTheDocument()
  })

  it('shows navigation links', () => {
    renderHeader()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })

  it('includes theme toggle', () => {
    renderHeader()
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('has link to homepage', () => {
    renderHeader()
    // Logo link has aria-label "ESCAPE Suite Home"
    const logoLink = screen.getByRole('link', { name: /ESCAPE Suite Home/i })
    expect(logoLink).toHaveAttribute('href', '/')
  })

  it('has link to GitHub', () => {
    renderHeader()
    const githubLink = screen.getByRole('link', { name: /GitHub/i })
    expect(githubLink).toHaveAttribute('href', 'https://github.com/Bonham-Technologies/ESCAPESUITE')
  })
})

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderLayout = () => {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderLayout()
    expect(document.body).toBeDefined()
  })

  it('renders header', () => {
    renderLayout()
    expect(screen.getByText('ESCAPE')).toBeInTheDocument()
  })

  it('renders outlet content', () => {
    renderLayout()
    expect(screen.getByText('Home Content')).toBeInTheDocument()
  })

  it('renders footer', () => {
    renderLayout()
    expect(screen.getByText(/Bonham Technologies/)).toBeInTheDocument()
  })

  it('displays current year in footer', () => {
    renderLayout()
    const currentYear = new Date().getFullYear().toString()
    expect(screen.getByText(new RegExp(currentYear))).toBeInTheDocument()
  })
})

describe('Layout - theme initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes theme on mount', async () => {
    const { initTheme } = await import('@escapesuite/shared/theme')

    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(initTheme).toHaveBeenCalled()
  })
})
