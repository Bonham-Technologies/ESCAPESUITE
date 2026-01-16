// App bootstrap utilities for consistent initialization

import { StrictMode, type ReactNode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'

export interface BootstrapConfig {
  /** The root element ID (default: 'root') */
  rootId?: string
  /** The main App component */
  App: ComponentType
  /** Function to check if SaaS mode is enabled */
  isSaaSMode: () => boolean
  /** StandaloneAuthGate component for license-based auth */
  StandaloneAuthGate: ComponentType<{ children: ReactNode }>
  /** Dynamic import for SaaSAuthGate */
  importSaaSAuthGate: () => Promise<{
    SaaSAuthGate: ComponentType<{ children: ReactNode; userId: string | undefined; isLoaded: boolean }>
  }>
  /** Dynamic import for Clerk key */
  importClerkKey: () => Promise<{ CLERK_KEY: string }>
}

/**
 * Bootstrap an ESCAPE Suite app with consistent initialization pattern.
 *
 * This handles:
 * - SaaS vs Standalone mode detection
 * - Dynamic loading of Clerk (excludes from standalone bundle)
 * - Proper auth gate wrapping
 * - Analytics integration
 */
export async function bootstrapApp(config: BootstrapConfig): Promise<void> {
  const {
    rootId = 'root',
    App,
    isSaaSMode,
    StandaloneAuthGate,
    importSaaSAuthGate,
    importClerkKey,
  } = config

  const rootElement = document.getElementById(rootId)
  if (!rootElement) {
    throw new Error(`Root element #${rootId} not found`)
  }

  const root = createRoot(rootElement)

  if (isSaaSMode()) {
    // Dynamically import Clerk to avoid bundling it in standalone builds
    const { ClerkProvider, useUser } = await import('@clerk/clerk-react')
    const { SaaSAuthGate } = await importSaaSAuthGate()
    const { CLERK_KEY } = await importClerkKey()

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
        <Analytics />
      </StrictMode>
    )
  } else {
    // Standalone mode - license-based auth only
    // No Analytics in standalone (runs offline, no network requests)
    root.render(
      <StrictMode>
        <StandaloneAuthGate>
          <App />
        </StandaloneAuthGate>
      </StrictMode>
    )
  }
}

export type { BootstrapConfig as AppBootstrapConfig }
