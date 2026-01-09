import { Page, BrowserContext } from '@playwright/test'

/**
 * Utilities for mocking Clerk authentication in Playwright tests.
 *
 * These utilities inject fake Clerk state into the page before it loads,
 * allowing tests to run as if a user is authenticated without requiring
 * actual Clerk API calls.
 */

export interface MockUser {
  id: string
  email: string
  name: string
  imageUrl?: string
}

export interface MockSession {
  id: string
  userId: string
  status: 'active' | 'ended' | 'expired'
}

const DEFAULT_USER: MockUser = {
  id: 'user_test_123',
  email: 'test@example.com',
  name: 'Test User',
  imageUrl: 'https://via.placeholder.com/150',
}

const DEFAULT_SESSION: MockSession = {
  id: 'sess_test_123',
  userId: DEFAULT_USER.id,
  status: 'active',
}

/**
 * Mock Clerk authentication state for a page.
 * Must be called BEFORE navigating to the page.
 *
 * This injects mock state that Clerk's React hooks will read,
 * making useUser(), useAuth(), etc. return authenticated state.
 */
export async function mockClerkAuth(
  page: Page,
  options?: {
    user?: Partial<MockUser>
    session?: Partial<MockSession>
  }
) {
  const user = { ...DEFAULT_USER, ...options?.user }
  const session = { ...DEFAULT_SESSION, ...options?.session, userId: user.id }

  await page.addInitScript(
    ({ user, session }) => {
      // Mock Clerk's internal state
      // These globals are checked by Clerk SDK
      ;(window as any).__clerk_frontend_api = 'mock-frontend-api'
      ;(window as any).__clerk_publishable_key = 'pk_test_mock'

      // Mock the Clerk client object that the SDK looks for
      ;(window as any).__clerk = {
        loaded: true,
        session: {
          id: session.id,
          userId: session.userId,
          status: session.status,
          user: {
            id: user.id,
            primaryEmailAddress: {
              emailAddress: user.email,
              id: 'email_1',
            },
            fullName: user.name,
            firstName: user.name.split(' ')[0],
            lastName: user.name.split(' ')[1] || '',
            imageUrl: user.imageUrl,
            hasImage: !!user.imageUrl,
          },
          getToken: async () => 'mock-session-token',
        },
        user: {
          id: user.id,
          primaryEmailAddress: {
            emailAddress: user.email,
            id: 'email_1',
          },
          fullName: user.name,
          firstName: user.name.split(' ')[0],
          lastName: user.name.split(' ')[1] || '',
          imageUrl: user.imageUrl,
          hasImage: !!user.imageUrl,
        },
        organization: null,
        signOut: async () => {},
        openSignIn: () => {},
        openSignUp: () => {},
        openUserProfile: () => {},
      }

      // Store mock state in sessionStorage for persistence within test
      sessionStorage.setItem(
        '__clerk_mock_auth',
        JSON.stringify({ user, session, isSignedIn: true })
      )
    },
    { user, session }
  )

  // Also intercept Clerk API calls to prevent network errors
  await interceptClerkAPI(page)
}

/**
 * Mock Clerk as signed out state.
 * Useful for testing sign-in flows or unauthenticated views.
 */
export async function mockClerkSignedOut(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__clerk_frontend_api = 'mock-frontend-api'
    ;(window as any).__clerk_publishable_key = 'pk_test_mock'

    ;(window as any).__clerk = {
      loaded: true,
      session: null,
      user: null,
      organization: null,
      signOut: async () => {},
      openSignIn: () => {},
      openSignUp: () => {},
      openUserProfile: () => {},
    }

    sessionStorage.setItem(
      '__clerk_mock_auth',
      JSON.stringify({ user: null, session: null, isSignedIn: false })
    )
  })

  await interceptClerkAPI(page)
}

/**
 * Intercept Clerk API calls to prevent network errors and return mock data.
 * This prevents the actual Clerk SDK from making network requests.
 */
export async function interceptClerkAPI(page: Page) {
  // Intercept all Clerk API endpoints
  await page.route('**/*.clerk.accounts.dev/**', async (route) => {
    const url = route.request().url()

    // Return mock responses for common endpoints
    if (url.includes('/v1/client')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: {
            client: {
              id: 'client_test',
              sessions: [],
              sign_in: null,
              sign_up: null,
              last_active_session_id: null,
            },
          },
        }),
      })
    }

    if (url.includes('/v1/environment')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          auth_config: {
            single_session_mode: false,
          },
          display_config: {
            application_name: 'ESCAPE Suite Test',
          },
        }),
      })
    }

    // For other endpoints, abort to prevent hanging
    return route.abort()
  })

  // Also handle clerk.com domains
  await page.route('**/*clerk.com/**', async (route) => {
    return route.abort()
  })
}

/**
 * Setup authentication for a browser context.
 * Applies auth mocking to all pages created in this context.
 */
export async function setupAuthForContext(
  context: BrowserContext,
  options?: {
    user?: Partial<MockUser>
    session?: Partial<MockSession>
  }
) {
  const user = { ...DEFAULT_USER, ...options?.user }
  const session = { ...DEFAULT_SESSION, ...options?.session, userId: user.id }

  // Add init script to context so all pages get it
  await context.addInitScript(
    ({ user, session }) => {
      ;(window as any).__clerk_frontend_api = 'mock-frontend-api'
      ;(window as any).__clerk_publishable_key = 'pk_test_mock'
      ;(window as any).__clerk = {
        loaded: true,
        session: {
          id: session.id,
          userId: session.userId,
          status: session.status,
          user: {
            id: user.id,
            primaryEmailAddress: { emailAddress: user.email, id: 'email_1' },
            fullName: user.name,
            firstName: user.name.split(' ')[0],
            lastName: user.name.split(' ')[1] || '',
            imageUrl: user.imageUrl,
            hasImage: !!user.imageUrl,
          },
          getToken: async () => 'mock-session-token',
        },
        user: {
          id: user.id,
          primaryEmailAddress: { emailAddress: user.email, id: 'email_1' },
          fullName: user.name,
          firstName: user.name.split(' ')[0],
          lastName: user.name.split(' ')[1] || '',
          imageUrl: user.imageUrl,
          hasImage: !!user.imageUrl,
        },
        organization: null,
        signOut: async () => {},
        openSignIn: () => {},
        openSignUp: () => {},
        openUserProfile: () => {},
      }
      sessionStorage.setItem(
        '__clerk_mock_auth',
        JSON.stringify({ user, session, isSignedIn: true })
      )
    },
    { user, session }
  )

  // Route interception for context
  await context.route('**/*.clerk.accounts.dev/**', async (route) => {
    return route.abort()
  })
  await context.route('**/*clerk.com/**', async (route) => {
    return route.abort()
  })
}

/**
 * Check if the current page appears to be authenticated.
 * Useful for verifying auth mocking is working.
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const clerk = (window as any).__clerk
    return clerk?.session !== null && clerk?.user !== null
  })
}

/**
 * Get the mocked user data from the page.
 */
export async function getMockedUser(page: Page): Promise<MockUser | null> {
  return page.evaluate(() => {
    const stored = sessionStorage.getItem('__clerk_mock_auth')
    if (stored) {
      const data = JSON.parse(stored)
      return data.user
    }
    return null
  })
}
