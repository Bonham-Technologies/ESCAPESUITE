import { useState, useCallback } from 'react'
import { validateLicense, saveLicense, type License } from './license'
import styles from './LicenseInputModal.module.css'

type AppProduct = 'craft' | 'artist'

interface LicenseInputModalProps {
  isOpen: boolean
  onSuccess: (license: License) => void
  product: AppProduct
  appName: string
}

export function LicenseInputModal({
  isOpen,
  onSuccess,
  product,
  appName,
}: LicenseInputModalProps) {
  const [licenseKey, setLicenseKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validatedLicense, setValidatedLicense] = useState<License | null>(null)

  const handleValidate = useCallback(async () => {
    const trimmedKey = licenseKey.trim()

    if (!trimmedKey) {
      setError('Please enter a license key')
      return
    }

    setIsValidating(true)
    setError(null)

    try {
      // Validate the license locally
      const license = validateLicense(trimmedKey, product)

      if (!license) {
        setError('Invalid license key. Please check and try again.')
        setIsValidating(false)
        return
      }

      // Check product compatibility
      if (license.product !== product && license.product !== 'suite') {
        setError(`This license is for ${license.product.toUpperCase()}, not ${product.toUpperCase()}.`)
        setIsValidating(false)
        return
      }

      // License is valid - save it
      saveLicense(product, trimmedKey)
      setValidatedLicense(license)

      // Call success callback after a brief delay to show success state
      setTimeout(() => {
        onSuccess(license)
      }, 1000)
    } catch {
      setError('An error occurred while validating the license.')
      setIsValidating(false)
    }
  }, [licenseKey, product, onSuccess])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isValidating && !validatedLicense) {
        handleValidate()
      }
    },
    [handleValidate, isValidating, validatedLicense]
  )

  if (!isOpen) return null

  // Show success state
  if (validatedLicense) {
    return (
      <div className={styles.container}>
        <div className={styles.modal}>
          <div className={styles.successIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2 className={styles.title}>License Activated</h2>
          <p className={styles.subtitle}>
            Welcome, <strong>{validatedLicense.customer}</strong>
          </p>
          <p className={styles.meta}>
            {validatedLicense.expires
              ? `Valid until ${new Date(validatedLicense.expires).toLocaleDateString()}`
              : 'Perpetual license'}
          </p>
          <p className={styles.loading}>Loading {appName}...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.modal}>
        <div className={styles.icon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 className={styles.title}>Enter License Key</h2>
        <p className={styles.subtitle}>
          Paste your license key below to activate {appName}
        </p>

        <div className={styles.inputGroup}>
          <textarea
            className={styles.input}
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ESCAPE-eyJpZCI6..."
            rows={3}
            disabled={isValidating}
            autoFocus
          />
        </div>

        {error && (
          <div className={styles.error}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <button
          className={styles.button}
          onClick={handleValidate}
          disabled={isValidating || !licenseKey.trim()}
        >
          {isValidating ? 'Validating...' : 'Activate License'}
        </button>

        <div className={styles.footer}>
          <p>
            Don't have a license?{' '}
            <a
              href="https://escapesuite.io/pricing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get one here
            </a>
          </p>
          <p>
            Already purchased?{' '}
            <a
              href="https://escapesuite.io/portal/downloads"
              target="_blank"
              rel="noopener noreferrer"
            >
              View your licenses
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
