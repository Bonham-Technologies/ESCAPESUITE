import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Pricing from './Pricing'

// Mock Clerk
vi.mock('@clerk/clerk-react', () => ({
  useUser: vi.fn(() => ({
    user: null,
    isSignedIn: false,
  })),
  SignedIn: ({ children: _children }: { children: React.ReactNode }) => null,
  SignedOut: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock useSubscription hook
vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    subscription: null,
    checkout: vi.fn(),
  })),
}))

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  analytics: {
    checkoutStarted: vi.fn(),
  },
}))

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  functionsUrl: 'https://test.supabase.co/functions/v1',
  supabaseAnonKey: 'test-anon-key',
}))

describe('Pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderPricing = (initialPath = '/pricing') => {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Pricing />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderPricing()
    expect(document.body).toBeDefined()
  })

  it('displays the main heading', () => {
    renderPricing()
    expect(screen.getByRole('heading', { name: /Choose Your Plan/i })).toBeInTheDocument()
  })

  it('shows pricing tabs', () => {
    renderPricing()
    expect(screen.getByText('Individual')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Standalone License')).toBeInTheDocument()
  })

  it('shows individual pricing by default', () => {
    renderPricing()
    expect(screen.getByText('Free Trial')).toBeInTheDocument()
    expect(screen.getByText('Pro Annual')).toBeInTheDocument()
    expect(screen.getByText('Pro Monthly')).toBeInTheDocument()
  })

  it('shows founding member option', () => {
    renderPricing()
    expect(screen.getByText(/Founding Member/i)).toBeInTheDocument()
    expect(screen.getByText(/\$149/)).toBeInTheDocument()
  })
})

describe('Pricing - tab switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('switches to team pricing', () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Teams'))

    // Team tab shows team-specific content
    expect(screen.getByText('Number of Seats')).toBeInTheDocument()
    expect(screen.getByText(/Team Features/i)).toBeInTheDocument()
  })

  it('switches to standalone pricing', () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Standalone License'))

    expect(screen.getByText('Select Product')).toBeInTheDocument()
    expect(screen.getByText('ESCAPECRAFT')).toBeInTheDocument()
    expect(screen.getByText('ESCAPEARTIST')).toBeInTheDocument()
    expect(screen.getByText('Suite Bundle')).toBeInTheDocument()
  })
})

describe('Pricing - standalone options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows selecting different products', () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    )

    // Switch to standalone tab
    fireEvent.click(screen.getByText('Standalone License'))

    // Should show product options - use getAllByText since names appear multiple places
    expect(screen.getAllByText('ESCAPECRAFT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ESCAPEARTIST').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Suite Bundle').length).toBeGreaterThan(0)
  })

  it('shows tier options', () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    )

    // Switch to standalone tab
    fireEvent.click(screen.getByText('Standalone License'))

    // Should show tier options
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Lifetime')).toBeInTheDocument()
  })
})

describe('Pricing - FAQ section', () => {
  it('displays FAQ section', () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    )

    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument()
    expect(screen.getByText(/What's the difference between SaaS and Standalone/i)).toBeInTheDocument()
  })
})
