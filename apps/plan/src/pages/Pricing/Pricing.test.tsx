import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Pricing from './Pricing'

// Auth adapter: signed-out so CTAs route to sign-up and SignedOut renders.
vi.mock('../../lib/auth', () => ({
  useUser: () => ({ user: null, isSignedIn: false, isLoaded: true }),
  SignedIn: (_props: { children: React.ReactNode }) => null,
  SignedOut: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    subscription: null,
    checkout: vi.fn(),
    refetch: vi.fn(),
  })),
}))

vi.mock('../../lib/analytics', () => ({
  analytics: { checkoutStarted: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) } },
}))

describe('Pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderPricing = (initialPath = '/pricing') =>
    render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Pricing />
      </MemoryRouter>
    )

  it('renders without crashing', () => {
    renderPricing()
    expect(document.body).toBeDefined()
  })

  it('displays the main heading', () => {
    renderPricing()
    expect(screen.getByRole('heading', { name: /Pricing/i })).toBeInTheDocument()
  })

  it('shows the Site License and Individual tabs', () => {
    renderPricing()
    expect(screen.getByText('Site License')).toBeInTheDocument()
    expect(screen.getByText('Individual')).toBeInTheDocument()
  })

  it('shows the site-license tiers by default', () => {
    renderPricing()
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Organization' })).toBeInTheDocument()
    expect(screen.getByText('$2,400')).toBeInTheDocument()
    expect(screen.getByText('$9,600')).toBeInTheDocument()
  })

  it('switches to individual pricing', () => {
    renderPricing()
    fireEvent.click(screen.getByText('Individual'))
    expect(screen.getByText('Free Trial')).toBeInTheDocument()
    expect(screen.getByText('Pro Annual')).toBeInTheDocument()
    expect(screen.getByText(/Founding Member/i)).toBeInTheDocument()
    expect(screen.getByText(/\$149/)).toBeInTheDocument()
  })

  it('displays the FAQ section', () => {
    renderPricing()
    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument()
    expect(screen.getByText(/air-gapped Site License/i)).toBeInTheDocument()
  })
})
