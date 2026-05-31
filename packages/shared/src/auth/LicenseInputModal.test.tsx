import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LicenseInputModal } from './LicenseInputModal'
import * as licenseModule from './license'

// Mock the license module
vi.mock('./license', async () => {
  const actual = await vi.importActual('./license')
  return {
    ...actual,
    validateLicense: vi.fn(),
    validateLicenseAsync: vi.fn(),
    saveLicense: vi.fn(),
  }
})

describe('LicenseInputModal', () => {
  const mockOnSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('should not render when isOpen is false', () => {
    render(
      <LicenseInputModal
        isOpen={false}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    expect(screen.queryByText('Enter License Key')).not.toBeInTheDocument()
  })

  it('should render the modal when isOpen is true', () => {
    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    expect(screen.getByText('Enter License Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')).toBeInTheDocument()
    expect(screen.getByText('Activate License')).toBeInTheDocument()
  })

  it('should disable button when license key is empty', () => {
    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const button = screen.getByText('Activate License')
    expect(button).toBeDisabled()
  })

  it('should enable button when license key is entered', () => {
    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-somekey' } })

    const button = screen.getByText('Activate License')
    expect(button).not.toBeDisabled()
  })

  it('should show error for invalid license', async () => {
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue(null)

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'INVALID-KEY' } })

    const button = screen.getByText('Activate License')
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Invalid license key. Please check and try again.')).toBeInTheDocument()
    })
  })

  it('should show error for wrong product license', async () => {
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue({
      id: 'lic_123',
      customer: 'Test User',
      email: 'test@example.com',
      product: 'artist',
      tier: 'pro',
      seats: 1,
      issued: '2026-01-01',
      expires: null,
      features: [],
    })

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-validkey' } })

    const button = screen.getByText('Activate License')
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('This license is for ARTIST, not CRAFT.')).toBeInTheDocument()
    })
  })

  it('should accept suite license for any product', async () => {
    const mockLicense = {
      id: 'lic_123',
      customer: 'Test User',
      email: 'test@example.com',
      product: 'suite' as const,
      tier: 'pro' as const,
      seats: 1,
      issued: '2026-01-01',
      expires: null,
      features: [],
    }
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue(mockLicense)

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-suitekey' } })

    const button = screen.getByText('Activate License')
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('License Activated')).toBeInTheDocument()
      expect(screen.getByText(/Welcome/)).toBeInTheDocument()
    })

    expect(licenseModule.saveLicense).toHaveBeenCalledWith('craft', 'ESCAPE-suitekey')
  })

  it('should call onSuccess after successful validation', async () => {
    const mockLicense = {
      id: 'lic_123',
      customer: 'Test User',
      email: 'test@example.com',
      product: 'craft' as const,
      tier: 'pro' as const,
      seats: 1,
      issued: '2026-01-01',
      expires: null,
      features: [],
    }
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue(mockLicense)

    vi.useFakeTimers()

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-validkey' } })

    const button = screen.getByText('Activate License')
    fireEvent.click(button)

    // Flush the awaited validateLicenseAsync microtask, then advance timers to
    // trigger the delayed success callback.
    await vi.advanceTimersByTimeAsync(1100)

    expect(mockOnSuccess).toHaveBeenCalledWith(mockLicense)

    vi.useRealTimers()
  })

  it('should display expiration date for expiring licenses', async () => {
    const mockLicense = {
      id: 'lic_123',
      customer: 'Test User',
      email: 'test@example.com',
      product: 'craft' as const,
      tier: 'standard' as const,
      seats: 1,
      issued: '2026-01-01',
      expires: '2027-01-01',
      features: [],
    }
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue(mockLicense)

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-validkey' } })

    const button = screen.getByText('Activate License')
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText(/Valid until/)).toBeInTheDocument()
    })
  })

  it('should display perpetual for lifetime licenses', async () => {
    const mockLicense = {
      id: 'lic_123',
      customer: 'Test User',
      email: 'test@example.com',
      product: 'craft' as const,
      tier: 'lifetime' as const,
      seats: 1,
      issued: '2026-01-01',
      expires: null,
      features: [],
    }
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue(mockLicense)

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-validkey' } })

    const button = screen.getByText('Activate License')
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Perpetual license')).toBeInTheDocument()
    })
  })

  it('should have links to purchase and download pages', () => {
    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    expect(screen.getByText('Get one here')).toHaveAttribute(
      'href',
      'https://escapesuite.io/pricing'
    )
    expect(screen.getByText('View your licenses')).toHaveAttribute(
      'href',
      'https://escapesuite.io/portal/downloads'
    )
  })

  it('should handle Enter key to submit', async () => {
    const mockLicense = {
      id: 'lic_123',
      customer: 'Test User',
      email: 'test@example.com',
      product: 'craft' as const,
      tier: 'pro' as const,
      seats: 1,
      issued: '2026-01-01',
      expires: null,
      features: [],
    }
    vi.mocked(licenseModule.validateLicenseAsync).mockResolvedValue(mockLicense)

    render(
      <LicenseInputModal
        isOpen={true}
        onSuccess={mockOnSuccess}
        product="craft"
        appName="ESCAPECRAFT"
      />
    )

    const textarea = screen.getByPlaceholderText('ESCAPE-eyJpZCI6...')
    fireEvent.change(textarea, { target: { value: 'ESCAPE-validkey' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByText('License Activated')).toBeInTheDocument()
    })
  })
})
