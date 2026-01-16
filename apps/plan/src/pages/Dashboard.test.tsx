import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'

// Mock Supabase client (before other imports that depend on it)
vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
}))

// Mock hooks and dependencies
vi.mock('@clerk/clerk-react', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'user_123', firstName: 'Test' },
    isLoaded: true,
  })),
}))

vi.mock('../hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    subscription: null,
    isLoading: false,
    checkout: vi.fn(),
    openPortal: vi.fn(),
  })),
}))

vi.mock('../hooks/useOrganization', () => ({
  useOrganization: vi.fn(() => ({
    organizations: [],
    fetchOrganizations: vi.fn(),
    loading: false,
    error: null,
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
  })

  const renderDashboard = () => {
    return render(
      <MemoryRouter>
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
})

describe('Dashboard - subscription states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state', async () => {
    const { useSubscription } = await import('../hooks/useSubscription')
    vi.mocked(useSubscription).mockReturnValue({
      subscription: null,
      isLoading: true,
      checkout: vi.fn(),
      openPortal: vi.fn(),
      refresh: vi.fn(),
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
      checkout: vi.fn(),
      openPortal: vi.fn(),
      refresh: vi.fn(),
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    expect(screen.getByText(/Free Trial/i)).toBeInTheDocument()
  })
})
