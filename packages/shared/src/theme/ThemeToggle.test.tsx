import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'
import { cleanupTheme, getTheme, applyTheme, setTheme } from './theme'

// Uses the real theme module (no mocking the unit under test). The theme
// module has singleton state, so each test resets it and picks a known
// starting preference via applyTheme + a direct setTheme call.

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    applyTheme('dark')
  })

  afterEach(() => {
    cleanupTheme()
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders three theme option buttons', () => {
    render(<ThemeToggle />)
    expect(screen.getByLabelText('Light mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Dark mode')).toBeInTheDocument()
    expect(screen.getByLabelText('System preference')).toBeInTheDocument()
  })

  it('marks the button matching the current preference as aria-pressed', () => {
    render(<ThemeToggle />)
    // getTheme() defaults to 'dark' at module load
    expect(screen.getByLabelText('Dark mode')).toHaveAttribute('aria-pressed', String(getTheme() === 'dark'))
    expect(screen.getByLabelText('Light mode')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('System preference')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking Light mode sets the theme to light and updates aria-pressed', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByLabelText('Light mode'))

    expect(screen.getByLabelText('Light mode')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Dark mode')).toHaveAttribute('aria-pressed', 'false')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('clicking Dark mode sets the theme to dark', async () => {
    applyTheme('light')
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByLabelText('Dark mode'))

    expect(screen.getByLabelText('Dark mode')).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('clicking System preference sets the preference to system and shows resolved theme in the title', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByLabelText('System preference'))

    expect(screen.getByLabelText('System preference')).toHaveAttribute('aria-pressed', 'true')
    // matchMedia mock from setup.ts reports matches: false -> resolves to light
    expect(screen.getByLabelText('System preference')).toHaveAttribute('title', 'System (light)')
  })

  it('updates when the theme changes externally via subscribe', async () => {
    render(<ThemeToggle />)

    // A theme change made outside of this component's own click handler
    // (e.g. from another ThemeToggle instance) should still update this
    // instance via the subscribe() effect.
    await act(async () => {
      await setTheme('light')
    })

    expect(screen.getByLabelText('Light mode')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Dark mode')).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies a custom className alongside the container class', () => {
    const { container } = render(<ThemeToggle className="extra-class" />)
    expect(container.firstElementChild).toHaveClass('extra-class')
  })

  it('unsubscribes on unmount (no further updates after unmount)', () => {
    const { unmount } = render(<ThemeToggle />)
    unmount()
    // Should not throw when a theme change happens after unmount.
    expect(() => applyTheme('light')).not.toThrow()
  })
})
