import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser, SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react'
import { useAcceptInvite } from '../../hooks/useOrganization'

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, isLoaded } = useUser()
  const { acceptInvite, loading, error } = useAcceptInvite()

  const [accepted, setAccepted] = useState(false)
  const [acceptedOrg, setAcceptedOrg] = useState<{
    name: string
    slug: string
  } | null>(null)

  const handleAccept = async () => {
    if (!token) return

    try {
      const result = await acceptInvite(token)
      setAccepted(true)
      setAcceptedOrg({
        name: result.organization.name,
        slug: result.organization.slug,
      })
    } catch {
      // Error is handled by the hook
    }
  }

  // Auto-redirect after successful accept
  useEffect(() => {
    if (accepted && acceptedOrg) {
      const timer = setTimeout(() => {
        navigate(`/team/${acceptedOrg.slug}`)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [accepted, acceptedOrg, navigate])

  if (!token) {
    return (
      <div className="accept-invite error">
        <h1>Invalid Invitation</h1>
        <p>This invitation link is invalid or has expired.</p>
        <Link to="/dashboard">Go to Dashboard</Link>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="accept-invite loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="accept-invite">
      <div className="invite-card">
        <SignedOut>
          <div className="invite-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h1>You've Been Invited</h1>
          <p>You've been invited to join a team on ESCAPE Suite.</p>
          <p className="sign-in-prompt">Sign in to accept this invitation.</p>
          <SignInButton mode="modal">
            <button className="btn btn-primary btn-large">
              Sign In to Continue
            </button>
          </SignInButton>
          <p className="help-text">
            Don't have an account?{' '}
            <Link to={`/sign-up?redirect_url=/invite/${token}`}>Sign up</Link>
          </p>
        </SignedOut>

        <SignedIn>
          {accepted && acceptedOrg ? (
            <>
              <div className="invite-icon success">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h1>Welcome to {acceptedOrg.name}!</h1>
              <p>You've successfully joined the team.</p>
              <p className="redirect-notice">
                Redirecting to team dashboard...
              </p>
              <Link
                to={`/team/${acceptedOrg.slug}`}
                className="btn btn-primary btn-large"
              >
                Go to Team Dashboard
              </Link>
            </>
          ) : (
            <>
              <div className="invite-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h1>Team Invitation</h1>
              <p>
                You've been invited to join a team on ESCAPE Suite as{' '}
                <strong>{user?.primaryEmailAddress?.emailAddress}</strong>.
              </p>

              {error && (
                <div className="error-message">
                  <p>{error}</p>
                  {error.includes('expired') && (
                    <p className="error-help">
                      Contact your team administrator for a new invitation.
                    </p>
                  )}
                </div>
              )}

              <button
                className="btn btn-primary btn-large"
                onClick={handleAccept}
                disabled={loading}
              >
                {loading ? 'Accepting...' : 'Accept Invitation'}
              </button>

              <p className="help-text">
                Wrong account?{' '}
                <Link to="/sign-in">Sign in with a different account</Link>
              </p>
            </>
          )}
        </SignedIn>
      </div>

      <style>{`
        .accept-invite {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          background: var(--bg-primary);
        }

        .accept-invite.loading,
        .accept-invite.error {
          flex-direction: column;
          text-align: center;
          color: var(--text-primary);
        }

        .accept-invite.error h1 {
          color: var(--error);
        }

        .invite-card {
          background: var(--bg-secondary);
          border-radius: 16px;
          padding: 2.5rem;
          max-width: 420px;
          width: 100%;
          text-align: center;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-color);
        }

        .invite-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          color: var(--color-primary, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
        }

        .invite-icon.success {
          background: var(--success-bg);
          color: var(--success);
        }

        .invite-card h1 {
          font-size: 1.5rem;
          margin: 0 0 0.75rem;
          color: var(--text-primary);
        }

        .invite-card p {
          color: var(--text-secondary);
          margin: 0 0 1rem;
        }

        .sign-in-prompt {
          font-weight: 500;
          color: var(--text-primary) !important;
        }

        .redirect-notice {
          font-size: 0.875rem;
          color: var(--text-secondary) !important;
        }

        .error-message {
          background: var(--error-bg);
          color: var(--error-text);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
          text-align: left;
        }

        .error-message p {
          color: inherit;
          margin: 0;
        }

        .error-help {
          font-size: 0.875rem;
          margin-top: 0.5rem !important;
          opacity: 0.9;
        }

        .help-text {
          font-size: 0.875rem;
          margin-top: 1.5rem !important;
          color: var(--text-secondary);
        }

        .help-text a {
          color: var(--color-primary, #6366f1);
          text-decoration: none;
        }

        .help-text a:hover {
          text-decoration: underline;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 500;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .btn-large {
          padding: 0.875rem 2rem;
          font-size: 1rem;
          width: 100%;
        }

        .btn-primary {
          background: var(--color-primary, #6366f1);
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--color-primary-dark, #4f46e5);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border-color);
          border-top-color: var(--color-primary, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
