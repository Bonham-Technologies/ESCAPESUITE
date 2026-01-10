import { Link } from 'react-router-dom'
import { SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import { ThemeToggle } from '@escapesuite/shared/theme'
import styles from './Layout.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.logo}>
        <svg className={styles.logoIcon} viewBox="0 0 24 24" fill="currentColor">
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

      <nav className={styles.nav}>
        <ThemeToggle />
        <SignedOut>
          <Link to="/sign-in">Sign In</Link>
          <Link to="/sign-up">
            <button className="primary">Get Started</button>
          </Link>
        </SignedOut>
        <SignedIn>
          <Link to="/dashboard">Dashboard</Link>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </nav>
    </header>
  )
}
