import '@escapesuite/shared/test/setup'
import { afterEach, vi } from 'vitest'

// Plan-specific: restore all mocks after each test
afterEach(() => {
  vi.restoreAllMocks()
})

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn())

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    origin: 'http://localhost:5173',
    href: 'http://localhost:5173',
    pathname: '/',
  },
  writable: true,
})

// Mock IntersectionObserver (used by analytics for pricing section)
vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(_callback: IntersectionObserverCallback) {
    // Store callback for potential testing
  }
})

// Mock Clerk hooks
vi.mock('@clerk/clerk-react', () => ({
  useUser: vi.fn(() => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'test-user-id',
      primaryEmailAddress: { emailAddress: 'test@example.com' },
      fullName: 'Test User',
    },
  })),
  useAuth: vi.fn(() => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'test-user-id',
  })),
  useClerk: vi.fn(() => ({
    openSignIn: vi.fn(),
    openSignUp: vi.fn(),
    signOut: vi.fn(),
  })),
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: (_props: { children: React.ReactNode }) => null,
  UserButton: () => null,
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}))
