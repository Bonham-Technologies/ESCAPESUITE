import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import { initTheme, cleanupTheme } from '../../utils/theme'
import styles from './Layout.module.css'

export default function Layout() {
  // Initialize theme on mount
  useEffect(() => {
    initTheme()
    return () => cleanupTheme()
  }, [])

  return (
    <div className={styles.layout}>
      <Header />
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <p>&copy; {new Date().getFullYear()} ESCAPE Suite. All rights reserved.</p>
      </footer>
    </div>
  )
}
