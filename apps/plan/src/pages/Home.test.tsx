import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

// Override the auth adapter for this file: simulate a SIGNED-OUT visitor so the
// landing page renders its unauthenticated CTAs ("Start Free Trial" / "Sign In").
// SignedOut renders its children, SignedIn renders nothing.
vi.mock('../lib/auth', () => ({
  useUser: vi.fn(() => ({
    user: null,
    isLoaded: true,
    isSignedIn: false,
  })),
  SignedIn: (_props: { children: ReactNode }) => null,
  SignedOut: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// Mock analytics
vi.mock('../lib/analytics', () => ({
  analytics: {
    pricingViewed: vi.fn(),
  },
}))

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderHome = () => {
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderHome()
    expect(document.body).toBeDefined()
  })

  it('displays the main heading', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('shows sign up call to action for unauthenticated users', () => {
    renderHome()
    expect(screen.getByText('Start Free Trial')).toBeInTheDocument()
    // Hosted-apps CTA appears in the hero and the pricing section.
    expect(screen.getAllByText('Try the hosted apps free').length).toBeGreaterThan(0)
  })
})

describe('Home - feature highlights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('highlights the air-gapped / privacy-first approach', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
    // Hero leads with the air-gap wedge.
    expect(screen.getByText(/leaving the building/i)).toBeInTheDocument()
  })

  it('shows ESCAPECRAFT tool', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
    expect(screen.getByText('ESCAPECRAFT')).toBeInTheDocument()
  })

  it('shows ESCAPEARTIST tool', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
    expect(screen.getByText('ESCAPEARTIST')).toBeInTheDocument()
  })
})
