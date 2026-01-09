import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isSaaSMode, StandaloneAuthGate } from './auth'

// Dynamically load Clerk and Sentry only in SaaS mode
async function renderApp() {
  const root = createRoot(document.getElementById('root')!)

  if (isSaaSMode()) {
    // Initialize Sentry in SaaS mode only (excludes from standalone bundle)
    const { initSentry } = await import('./lib/sentry')
    initSentry()

    // Dynamically import Clerk to avoid bundling it in standalone builds
    const { ClerkProvider, useUser } = await import('@clerk/clerk-react')
    const { SaaSAuthGate } = await import('./auth')
    const { CLERK_KEY } = await import('./auth/config')

    // Wrapper component that uses Clerk hooks
    function SaaSApp() {
      const { user, isLoaded } = useUser()
      return (
        <SaaSAuthGate userId={user?.id} isLoaded={isLoaded}>
          <App />
        </SaaSAuthGate>
      )
    }

    root.render(
      <StrictMode>
        <ClerkProvider publishableKey={CLERK_KEY}>
          <SaaSApp />
        </ClerkProvider>
      </StrictMode>
    )
  } else {
    // Standalone mode - license-based auth only
    root.render(
      <StrictMode>
        <StandaloneAuthGate>
          <App />
        </StandaloneAuthGate>
      </StrictMode>
    )
  }
}

renderApp()
