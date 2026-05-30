import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SignInPage from './SignIn'

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

  it('renders an email input', () => {
    renderSignIn()
    const email = document.querySelector('input[type="email"]')
    expect(email).toBeInTheDocument()
  })

  it('renders a password input', () => {
    renderSignIn()
    const password = document.querySelector('input[type="password"]')
    expect(password).toBeInTheDocument()
  })

  it('renders a "Sign in" submit button', () => {
    renderSignIn()
    const submit = screen.getByRole('button', { name: /sign in/i })
    expect(submit).toBeInTheDocument()
    expect(submit).toHaveAttribute('type', 'submit')
  })

  it('renders a magic link button', () => {
    renderSignIn()
    expect(
      screen.getByRole('button', { name: /magic link/i })
    ).toBeInTheDocument()
  })

  it('renders a link to /sign-up', () => {
    renderSignIn()
    const signUpLink = screen.getByRole('link', { name: /create an account/i })
    expect(signUpLink).toHaveAttribute('href', '/sign-up')
  })
})
