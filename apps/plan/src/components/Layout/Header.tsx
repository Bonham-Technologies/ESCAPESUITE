import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@escapesuite/shared/theme'
import { SignedIn, SignedOut, useUser, signOut } from '../../lib/auth'
import styles from './Layout.module.css'

function AccountMenu() {
  const { user } = useUser()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function handleSignOut() {
    await signOut()
    setOpen(false)
    navigate('/')
  }

  const initial = (user?.email?.[0] ?? '?').toUpperCase()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: 'none',
          background: '#6366f1',
          color: '#fff',
          fontWeight: 600,
          fontSize: '0.9rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            minWidth: 200,
            background: 'var(--bg-secondary, #12121a)',
            border: '1px solid var(--border-color, #2a2a3e)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            padding: '0.5rem',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '0.5rem 0.6rem',
              fontSize: '0.8rem',
              color: 'var(--text-secondary, #a0a0b0)',
              borderBottom: '1px solid var(--border-color, #2a2a3e)',
              marginBottom: '0.25rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {user?.email}
          </div>
          <Link
            to="/dashboard"
            onClick={() => setOpen(false)}
            style={{ padding: '0.5rem 0.6rem', borderRadius: 6, color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem' }}
          >
            Dashboard
          </Link>
          <Link
            to="/dashboard?tab=downloads"
            onClick={() => setOpen(false)}
            style={{ padding: '0.5rem 0.6rem', borderRadius: 6, color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem' }}
          >
            Downloads
          </Link>
          <button
            onClick={handleSignOut}
            style={{
              padding: '0.5rem 0.6rem',
              borderRadius: 6,
              color: '#fca5a5',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

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
        <Link to="/pricing">Pricing</Link>
        <ThemeToggle />
        <SignedOut>
          <Link to="/sign-in">Sign In</Link>
          <Link to="/sign-up">
            <button className="primary" aria-label="Get started with ESCAPE Suite">Get Started</button>
          </Link>
        </SignedOut>
        <SignedIn>
          <Link to="/dashboard">Dashboard</Link>
          <AccountMenu />
        </SignedIn>
      </nav>
    </header>
  )
}
