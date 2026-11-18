import { Link } from 'react-router-dom'
import { ThemeToggle } from '@escapesuite/shared/theme'
import { GITHUB_URL } from '../../lib/launch'
import styles from './Layout.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      {/* The product lockup: accent square, name, parent. "by Bonham Technologies" sits beside
          the link, not in it, so the link's visible text stays "ESCAPE Suite" (ESCSUITE-334:
          WCAG 2.5.3 Label in Name). */}
      <div className={styles.lockup}>
        <Link to="/" className={styles.logo} aria-label="ESCAPE Suite Home">
          <span className={styles.logoText}>ESCAPE</span>{' '}
          <span className={styles.logoSuite}>Suite</span>
        </Link>
        <span className={styles.logoParent}>by Bonham Technologies</span>
      </div>

      <nav className={styles.nav} aria-label="Main navigation">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        <ThemeToggle />
      </nav>
    </header>
  )
}
