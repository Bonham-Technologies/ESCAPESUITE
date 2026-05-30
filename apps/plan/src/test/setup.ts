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

// A chainable, thenable stub for the Supabase query builder. Every builder
// method (select/eq/order/insert/...) returns the same proxy, and awaiting it
// resolves to an empty result — enough for components/hooks to render in tests.
function makeChain(): unknown {
  const result = { data: null, error: null, count: 0 }
  const p = Promise.resolve(result) as unknown as Record<string, unknown>
  return new Proxy(p, {
    get(target, prop, receiver) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return (target[prop as string] as (...a: unknown[]) => unknown).bind(target)
      }
      return () => receiver
    },
  })
}

const mockSupabase = {
  from: () => makeChain(),
  rpc: () => makeChain(),
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    })),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'test-token', user: { id: 'test-user-id' } } },
      error: null,
    })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(async () => ({ data: { session: {} }, error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  },
  functions: {
    invoke: vi.fn(async () => ({ data: {}, error: null })),
  },
}

// Mock the shared Supabase auth layer: signed-in test user + the stub client.
// importOriginal preserves the rest of the module (license, machineHash, etc.).
vi.mock('@escapesuite/shared/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getSupabase: () => mockSupabase,
    useSupabaseUser: () => ({
      user: { id: 'test-user-id', email: 'test@example.com', user_metadata: {} },
      session: { access_token: 'test-token' },
      loading: false,
    }),
  }
})

export { mockSupabase }
