import styles from './ErrorScreen.module.css'

interface ErrorScreenProps {
  message: string | null
}

export function ErrorScreen({ message }: ErrorScreenProps) {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.icon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className={styles.title}>Access Denied</h1>
        <p className={styles.message}>
          {message || 'This application is not licensed for use.'}
        </p>
        <div className={styles.actions}>
          <a
            href="https://escapesuite.io"
            className={styles.button}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get Started at ESCAPE Suite
          </a>
        </div>
        <p className={styles.footer}>
          Already have an account?{' '}
          <a href="https://escapesuite.io/sign-in" target="_blank" rel="noopener noreferrer">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}
