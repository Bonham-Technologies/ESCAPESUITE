import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import styles from '../../pages/Auth.module.css'

interface AuthFormProps {
  mode: 'sign-in' | 'sign-up'
}

export default function AuthForm({ mode }: AuthFormProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isSignUp = mode === 'sign-up'
  const emailRedirectTo = `${window.location.origin}${redirectTo}`

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo },
        })
        if (error) throw error
        if (data.session) {
          navigate(redirectTo, { replace: true })
        } else {
          setNotice('Check your email to confirm your account, then sign in.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate(redirectTo, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleMagicLink() {
    setError(null)
    setNotice(null)
    if (!email) {
      setError('Enter your email address first.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo, shouldCreateUser: isSignUp },
      })
      if (error) throw error
      setNotice('Magic link sent — check your email to finish signing in.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <svg className={styles.brandMark} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className={styles.title}>{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
        <p className={styles.subtitle}>
          {isSignUp
            ? 'Start your 14-day free trial of ESCAPE Suite.'
            : 'Sign in to your ESCAPE Suite account.'}
        </p>

        {error && <div className={styles.error}>{error}</div>}
        {notice && <div className={styles.notice}>{notice}</div>}

        <form className={styles.form} onSubmit={handlePasswordSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className={styles.input}
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button className={styles.primaryButton} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className={styles.divider}>or</div>

        <button
          className={styles.secondaryButton}
          type="button"
          onClick={handleMagicLink}
          disabled={loading}
        >
          Email me a magic link
        </button>

        <p className={styles.footer}>
          {isSignUp ? (
            <>
              Already have an account? <Link to="/sign-in">Sign in</Link>
            </>
          ) : (
            <>
              New to ESCAPE Suite? <Link to="/sign-up">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
