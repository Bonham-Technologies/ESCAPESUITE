import { Link } from 'react-router-dom'
import { ThemeToggle } from '@escapesuite/shared/theme'
import { GITHUB_URL } from '../../lib/launch'
import styles from './Layout.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.logo} aria-label="ESCAPE Suite Home">
        <svg className={styles.logoIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"/>
        </svg>
        <span className={styles.logoText}>ESCAPE</span>
        <span className={styles.logoSuite}>Suite</span>
      </Link>

      <nav className={styles.nav} aria-label="Main navigation">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        <ThemeToggle />
      </nav>
    </header>
  )
}
