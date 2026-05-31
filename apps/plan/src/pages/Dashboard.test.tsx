import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'

// Mock Supabase client (before other imports that depend on it).
// `from('licenses')` returns a chainable builder whose terminal awaited value is
// an empty result, matching .select(...).is('revoked_at', null).order('issued_at', ...).
vi.mock('../lib/supabase', () => {
  const makeLicensesChain = () => {
    const result = { data: [], error: null }
    const chain = {
      select: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(() => Promise.resolve(result)),
      eq: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    }
    return chain
  }
  return {
    supabase: {
      functions: {
        invoke: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      },
      from: vi.fn(() => makeLicensesChain()),
    },
  }
})

// Dashboard reads the user via ../lib/auth (the Supabase-backed Clerk adapter),
// so mock that module directly to control the signed-in user.
vi.mock('../lib/auth', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'user_123', firstName: 'Test', email: 'test@example.com' },
    isLoaded: true,
    isSignedIn: true,
  })),
}))

vi.mock('../hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    subscription: null,
    isLoading: false,
    error: null,
    checkout: vi.fn(),
    openPortal: vi.fn(),
    refetch: vi.fn(),
  })),
}))

vi.mock('../lib/analytics', () => ({
  analytics: {
    toolLaunched: vi.fn(),
    subscriptionUpgraded: vi.fn(),
  },
}))

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // version.json fetch used by the downloads tab — resolve to a 404-ish miss.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    )
  })

  const renderDashboard = (initialEntries: string[] = ['/dashboard']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <Dashboard />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderDashboard()
    expect(document.body).toBeDefined()
  })

  it('displays tool cards', () => {
    renderDashboard()
    expect(screen.getByText('ESCAPECRAFT')).toBeInTheDocument()
    expect(screen.getByText('ESCAPEARTIST')).toBeInTheDocument()
  })

  it('shows tool descriptions', () => {
    renderDashboard()
    expect(screen.getByText(/Record screen, webcam, and audio/i)).toBeInTheDocument()
    expect(screen.getByText(/Edit videos with a professional timeline/i)).toBeInTheDocument()
  })

  it('renders the downloads tab when ?tab=downloads is set', () => {
    renderDashboard(['/dashboard?tab=downloads'])
    expect(screen.getByText('Your Licenses')).toBeInTheDocument()
    expect(screen.getByText('Standalone Downloads')).toBeInTheDocument()
  })
})

describe('Dashboard - subscription states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    )
  })

  it('shows loading state', async () => {
    const { useSubscription } = await import('../hooks/useSubscription')
    vi.mocked(useSubscription).mockReturnValue({
      subscription: null,
      isLoading: true,
      error: null,
      checkout: vi.fn(),
      openPortal: vi.fn(),
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    // Dashboard should still render even during loading
    expect(document.body).toBeDefined()
  })

  it('shows free trial state when no subscription', async () => {
    const { useSubscription } = await import('../hooks/useSubscription')
    vi.mocked(useSubscription).mockReturnValue({
      subscription: null,
      isLoading: false,
      error: null,
      checkout: vi.fn(),
      openPortal: vi.fn(),
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    expect(screen.getByText(/Free Trial/i)).toBeInTheDocument()
  })
})
