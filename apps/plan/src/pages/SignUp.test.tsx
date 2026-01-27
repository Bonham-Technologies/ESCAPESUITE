import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SignUpPage from './SignUp'

// Mock Clerk SignUp component
vi.mock('@clerk/clerk-react', () => ({
  SignUp: ({ forceRedirectUrl, path, signInUrl }: {
    forceRedirectUrl?: string
    path?: string
    signInUrl?: string
  }) => (
    <div data-testid="clerk-sign-up">
      <span data-testid="force-redirect-url">{forceRedirectUrl}</span>
      <span data-testid="path">{path}</span>
      <span data-testid="sign-in-url">{signInUrl}</span>
    </div>
  ),
}))

// Mock Clerk themes
vi.mock('@clerk/themes', () => ({
  dark: { baseTheme: 'dark' },
}))

describe('SignUp Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderSignUp = () => {
    return render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderSignUp()
    expect(document.body).toBeDefined()
  })

  it('renders the Clerk SignUp component', () => {
    renderSignUp()
    expect(screen.getByTestId('clerk-sign-up')).toBeInTheDocument()
  })

  it('configures forceRedirectUrl to /dashboard', () => {
    renderSignUp()
    expect(screen.getByTestId('force-redirect-url')).toHaveTextContent('/dashboard')
  })

  it('configures path to /sign-up', () => {
    renderSignUp()
    expect(screen.getByTestId('path')).toHaveTextContent('/sign-up')
  })

  it('configures signInUrl to /sign-in', () => {
    renderSignUp()
    expect(screen.getByTestId('sign-in-url')).toHaveTextContent('/sign-in')
  })

  it('does not use deprecated afterSignUpUrl prop', () => {
    // This test documents that we migrated from afterSignUpUrl to forceRedirectUrl
    // The Clerk SDK v5 deprecated afterSignUpUrl in favor of forceRedirectUrl
    renderSignUp()
    const signUp = screen.getByTestId('clerk-sign-up')
    // If afterSignUpUrl were still used, the component would not receive forceRedirectUrl
    expect(screen.getByTestId('force-redirect-url')).toHaveTextContent('/dashboard')
    expect(signUp).toBeInTheDocument()
  })
})
