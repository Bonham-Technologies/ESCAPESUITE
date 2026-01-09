import styles from './LoadingScreen.module.css'

export function LoadingScreen() {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.logo}>
          <svg className={styles.logoIcon} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" fill="var(--bg-primary, #0a0a0f)" />
          </svg>
          <span className={styles.logoText}>ESCAPECRAFT</span>
        </div>
        <div className={styles.spinner} />
        <p className={styles.message}>Verifying access...</p>
      </div>
    </div>
  )
}
