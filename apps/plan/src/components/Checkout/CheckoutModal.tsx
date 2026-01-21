import { useEffect } from 'react'
import { EmbeddedCheckout } from './EmbeddedCheckout'
import styles from './CheckoutModal.module.css'

interface CheckoutModalProps {
  clientSecret: string | null
  onClose: () => void
  onComplete?: () => void
}

export function CheckoutModal({ clientSecret, onClose, onComplete }: CheckoutModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  if (!clientSecret) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close checkout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className={styles.checkoutContainer}>
          <EmbeddedCheckout clientSecret={clientSecret} onComplete={onComplete} />
        </div>
      </div>
    </div>
  )
}
