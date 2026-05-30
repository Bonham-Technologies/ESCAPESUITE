import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SignUpPage from './SignUp'

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

  it('renders the sign-up heading and subtitle', () => {
    renderSignUp()
    expect(
      screen.getByRole('heading', { name: /create your account/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/14-day free trial/i)).toBeInTheDocument()
  })

  it('renders email and password inputs', () => {
    renderSignUp()
    const email = screen.getByLabelText(/email/i)
    const password = screen.getByLabelText(/password/i)
    expect(email).toBeInTheDocument()
    expect(email).toHaveAttribute('type', 'email')
    expect(password).toBeInTheDocument()
    expect(password).toHaveAttribute('type', 'password')
  })

  it('renders a "Create account" submit button', () => {
    renderSignUp()
    const submit = screen.getByRole('button', { name: /create account/i })
    expect(submit).toBeInTheDocument()
    expect(submit).toHaveAttribute('type', 'submit')
  })

  it('renders a magic-link button', () => {
    renderSignUp()
    expect(
      screen.getByRole('button', { name: /magic link/i })
    ).toBeInTheDocument()
  })

  it('links to the sign-in page', () => {
    renderSignUp()
    const signInLink = screen.getByRole('link', { name: /sign in/i })
    expect(signInLink).toBeInTheDocument()
    expect(signInLink).toHaveAttribute('href', '/sign-in')
  })
})
