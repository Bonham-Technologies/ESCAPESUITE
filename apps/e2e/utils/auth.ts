import { Page, BrowserContext } from '@playwright/test'

/**
 * Utilities for mocking Supabase Auth in Playwright tests.
 *
 * The app reads auth state via `supabase.auth.getSession()`, which loads a
 * persisted session from localStorage under the key `sb-<ref>-auth-token`
 * (ref = the subdomain of VITE_SUPABASE_URL). So to make the app think a user
 * is signed in we (1) seed that localStorage key with a structurally-valid
 * Supabase session before the page loads, and (2) intercept the GoTrue
 * `/auth/v1/*` endpoints as a network backstop so the client never blocks on
 * the (nonexistent) mock backend.
 *
 * The dev servers are started by playwright.config.ts with VITE_SUPABASE_URL =
 * MOCK_SUPABASE_URL, so the client derives the same storage key we write to.
 *
 * NOTE: edge-function calls (get-subscription, validate-license, Stripe) are
 * mocked separately in subscription-mocks.ts / license-mocks.ts / stripe-mocks.ts.
 */

// Deterministic mock Supabase project used for E2E (no real network calls).
// Keep these in sync with the webServer env in the playwright configs (they
// import these constants, so they stay in sync automatically).
export const MOCK_SUPABASE_URL = 'https://e2e-mock.supabase.co'
// Fake anon key (never validated client-side; supabase-js only sends it as a
// header to endpoints we intercept). Shaped like a JWT for realism.
export const MOCK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImUyZS1tb2NrIn0.e2e-mock-anon-signature'

export interface MockUser {
  id: string
  email: string
  name: string
  imageUrl?: string
}

const DEFAULT_USER: MockUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'test@example.com',
  name: 'Test User',
}

/** localStorage key supabase-js uses to persist the session for our mock URL. */
function authStorageKey(): string {
  const ref = new URL(MOCK_SUPABASE_URL).hostname.split('.')[0]
  return `sb-${ref}-auth-token`
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/**
 * A fake but structurally-valid JWT. supabase-js does NOT verify the signature
 * client-side; getSession() only reads `expires_at` from the session object, so
 * a far-future expiry means it returns the session without attempting a refresh.
 */
function fakeJwt(user: MockUser, expiresAt: number, issuedAt: number): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' })
  const payload = base64url({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${MOCK_SUPABASE_URL}/auth/v1`,
    iat: issuedAt,
    exp: expiresAt,
    user_metadata: { full_name: user.name, name: user.name, email: user.email },
    app_metadata: { provider: 'email', providers: ['email'] },
  })
  return `${header}.${payload}.e2e-mock-signature`
}

/** Build a Supabase session object matching the supabase-js persisted shape. */
function buildSession(user: MockUser) {
  const nowSec = Math.floor(Date.now() / 1000)
  const expiresAt = nowSec + 60 * 60 * 24 * 365 // 1 year out → never refreshes mid-test
  const nowIso = new Date().toISOString()
  const supabaseUser = {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: nowIso,
    phone: '',
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: user.name, name: user.name, email: user.email },
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
  }
  return {
    access_token: fakeJwt(user, expiresAt, nowSec),
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    refresh_token: `e2e-mock-refresh-${user.id}`,
    user: supabaseUser,
  }
}

type SupabaseSession = ReturnType<typeof buildSession>

/**
 * Network backstop: answer the GoTrue endpoints so the client never hangs on
 * the mock backend. getSession() is local (reads storage); these cover token
 * refresh / getUser if anything triggers them.
 */
async function interceptSupabaseAuth(
  target: Page | BrowserContext,
  session: SupabaseSession
) {
  await target.route('**/auth/v1/token**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    })
  )
  await target.route('**/auth/v1/user**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session.user),
    })
  )
  await target.route('**/auth/v1/logout**', (route) =>
    route.fulfill({ status: 204, contentType: 'application/json', body: '{}' })
  )
}

/**
 * Make the app see an authenticated user. Must be called BEFORE navigating.
 * Seeds the Supabase session in localStorage and backstops the auth endpoints.
 */
export async function mockSignedIn(
  page: Page,
  options?: { user?: Partial<MockUser> }
) {
  const user: MockUser = { ...DEFAULT_USER, ...options?.user }
  const session = buildSession(user)
  const key = authStorageKey()

  await page.addInitScript(
    ({ key, session }) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(session))
      } catch {
        /* localStorage unavailable before navigation; ignored */
      }
    },
    { key, session }
  )

  await interceptSupabaseAuth(page, session)
}

/**
 * Make the app see a signed-out visitor. Clears any seeded session and answers
 * the auth endpoints with unauthenticated responses.
 */
export async function mockSignedOut(page: Page) {
  const key = authStorageKey()

  await page.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignored */
    }
  }, key)

  await page.route('**/auth/v1/user**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'not authenticated' }),
    })
  )
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant' }),
    })
  )
}

/**
 * Seed authentication for an entire browser context so every page created in it
 * starts signed in. Used by cross-app integration/workflow tests.
 */
export async function setupAuthForContext(
  context: BrowserContext,
  options?: { user?: Partial<MockUser> }
) {
  const user: MockUser = { ...DEFAULT_USER, ...options?.user }
  const session = buildSession(user)
  const key = authStorageKey()

  await context.addInitScript(
    ({ key, session }) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(session))
      } catch {
        /* ignored */
      }
    },
    { key, session }
  )

  await interceptSupabaseAuth(context, session)
}
