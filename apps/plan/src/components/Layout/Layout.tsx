import { useEffect, useRef, type MouseEvent } from 'react'
import { Outlet, Link } from 'react-router-dom'
import Header from './Header'
import { GITHUB_URL } from '../../lib/launch'
import { initTheme, cleanupTheme } from '@escapesuite/shared/theme'
import { themeStorage } from '../../utils/themeStorage'
import styles from './Layout.module.css'

export default function Layout() {
  const mainRef = useRef<HTMLElement>(null)

  // Initialize theme on mount
  useEffect(() => {
    initTheme(themeStorage)
    return () => cleanupTheme()
  }, [])

  // The skip link moves focus itself rather than leaving it to the browser's
  // own fragment navigation (ESCSUITE-214). Both reach `<main tabindex="-1">`,
  // but doing it here is the same in every browser and in jsdom, and it leaves
  // no `#main` history entry for Back to undo. `focus()` scrolls the landmark
  // into view the way the hash jump would have.
  //
  // No null guard, deliberately: `<main>` is rendered unconditionally by this
  // same component on every route, so the ref is always attached by the time a
  // click can reach the link — and plan's coverage floors leave no room for a
  // branch no test can take.
  const skipToMain = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    ;(mainRef.current as HTMLElement).focus()
  }

  return (
    <div className={styles.layout}>
      <a href="#main" className={styles.skipLink} onClick={skipToMain}>
        Skip to main content
      </a>
      <Header />
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <Link to="/privacy">Privacy Policy</Link>
          <span className={styles.footerDivider}>|</span>
          <Link to="/terms">Terms of Service</Link>
          <span className={styles.footerDivider}>|</span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
        <p>&copy; {new Date().getFullYear()} <a href="https://www.bonham.tech" target="_blank" rel="noopener noreferrer">Bonham Technologies, LLC</a> &middot; <a href="https://github.com/Bonham-Technologies/ESCAPESUITE/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a></p>
      </footer>
    </div>
  )
}
