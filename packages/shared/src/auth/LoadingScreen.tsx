import type { ReactNode } from 'react'
import styles from './LoadingScreen.module.css'

interface LoadingScreenProps {
  appName: string
  logo: ReactNode
}

export function LoadingScreen({ appName, logo }: LoadingScreenProps) {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>{logo}</div>
          <span className={styles.logoText}>{appName}</span>
        </div>
        <div className={styles.spinner} />
        <p className={styles.message}>Verifying access...</p>
      </div>
    </div>
  )
}
