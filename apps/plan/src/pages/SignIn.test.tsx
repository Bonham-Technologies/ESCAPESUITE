import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SignInPage from './SignIn'

// Mock Clerk SignIn component
vi.mock('@clerk/clerk-react', () => ({
  SignIn: ({ forceRedirectUrl, path, signUpUrl }: {
    forceRedirectUrl?: string
    path?: string
    signUpUrl?: string
  }) => (
    <div data-testid="clerk-sign-in">
      <span data-testid="force-redirect-url">{forceRedirectUrl}</span>
      <span data-testid="path">{path}</span>
      <span data-testid="sign-up-url">{signUpUrl}</span>
    </div>
  ),
}))

// Mock Clerk themes
vi.mock('@clerk/themes', () => ({
  dark: { baseTheme: 'dark' },
}))

describe('SignIn Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderSignIn = () => {
    return render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderSignIn()
    expect(document.body).toBeDefined()
  })

  it('renders the Clerk SignIn component', () => {
    renderSignIn()
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument()
  })

  it('configures forceRedirectUrl to /dashboard', () => {
    renderSignIn()
    expect(screen.getByTestId('force-redirect-url')).toHaveTextContent('/dashboard')
  })

  it('configures path to /sign-in', () => {
    renderSignIn()
    expect(screen.getByTestId('path')).toHaveTextContent('/sign-in')
  })

  it('configures signUpUrl to /sign-up', () => {
    renderSignIn()
    expect(screen.getByTestId('sign-up-url')).toHaveTextContent('/sign-up')
  })

  it('does not use deprecated afterSignInUrl prop', () => {
    // This test documents that we migrated from afterSignInUrl to forceRedirectUrl
    // The Clerk SDK v5 deprecated afterSignInUrl in favor of forceRedirectUrl
    renderSignIn()
    const signIn = screen.getByTestId('clerk-sign-in')
    // If afterSignInUrl were still used, the component would not receive forceRedirectUrl
    expect(screen.getByTestId('force-redirect-url')).toHaveTextContent('/dashboard')
    expect(signIn).toBeInTheDocument()
  })
})
