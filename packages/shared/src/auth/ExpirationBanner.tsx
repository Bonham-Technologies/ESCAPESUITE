import { useState, useMemo } from 'react'
import type { License } from './license'
import styles from './ExpirationBanner.module.css'

interface ExpirationBannerProps {
  license: License | null
  /** Number of days before expiration to start showing the banner (default: 30) */
  warningDays?: number
}

/**
 * Get the storage key for banner dismissal
 */
function getDismissalKey(licenseId: string): string {
  return `escape_expiration_dismissed_${licenseId}`
}

/**
 * Check if the banner was dismissed today
 */
function wasDismissedToday(licenseId: string): boolean {
  const dismissedDate = localStorage.getItem(getDismissalKey(licenseId))
  if (!dismissedDate) return false

  const today = new Date().toDateString()
  return dismissedDate === today
}

/**
 * Save that the banner was dismissed today
 */
function saveDismissal(licenseId: string): void {
  const today = new Date().toDateString()
  localStorage.setItem(getDismissalKey(licenseId), today)
}

/**
 * Calculate days until expiration
 */
function getDaysUntilExpiration(expiresDate: string): number {
  const now = new Date()
  const expires = new Date(expiresDate)
  const diffMs = expires.getTime() - now.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Format expiration date for display
 */
function formatExpirationDate(expiresDate: string): string {
  return new Date(expiresDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Check if the banner should be shown based on license state
 */
function shouldShowBanner(license: License | null, warningDays: number): boolean {
  if (!license?.expires) return false

  const daysLeft = getDaysUntilExpiration(license.expires)

  // Only show if within warning period and not already expired
  if (daysLeft > warningDays || daysLeft < 0) return false

  // Check if already dismissed today
  if (wasDismissedToday(license.id)) return false

  return true
}

/**
 * A closable banner that warns users when their license is approaching expiration.
 * Shows when the license will expire within the warning period (default 30 days).
 * Dismissal is remembered for the current day.
 */
export function ExpirationBanner({ license, warningDays = 30 }: ExpirationBannerProps) {
  // Calculate initial visibility based on license state
  const initiallyVisible = useMemo(
    () => shouldShowBanner(license, warningDays),
    [license, warningDays]
  )

  // Track manual dismissal (clicking the close button)
  const [manuallyDismissed, setManuallyDismissed] = useState(false)

  // Don't show if license has no expiration, not in warning period, or manually dismissed
  if (!initiallyVisible || manuallyDismissed || !license?.expires) {
    return null
  }

  const daysLeft = getDaysUntilExpiration(license.expires)
  const formattedDate = formatExpirationDate(license.expires)

  const handleDismiss = () => {
    saveDismissal(license.id)
    setManuallyDismissed(true)
  }

  return (
    <div className={styles.banner} role="alert">
      <div className={styles.content}>
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className={styles.message}>
          {daysLeft <= 0 ? (
            <>Your license expires today.</>
          ) : daysLeft === 1 ? (
            <>Your license expires tomorrow ({formattedDate}).</>
          ) : (
            <>Your license expires in {daysLeft} days ({formattedDate}).</>
          )}
          {' '}
          <a
            href="https://escapesuite.io/portal/downloads"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            Renew now
          </a>
        </span>
      </div>
      <button
        className={styles.closeButton}
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
