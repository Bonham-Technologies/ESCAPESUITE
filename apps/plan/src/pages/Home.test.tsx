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
    // Multiple "Start Free Trial" buttons exist on page
    const freeTrialButtons = screen.getAllByText('Start Free Trial')
    expect(freeTrialButtons.length).toBeGreaterThan(0)
    expect(screen.getByText('Sign In')).toBeInTheDocument()
  })
})

describe('Home - feature highlights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('highlights privacy-first approach', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
    // Check for privacy-related content in hero section
    expect(screen.getByText(/locally on your device/i)).toBeInTheDocument()
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
