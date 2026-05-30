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
}

/**
 * Bootstrap an ESCAPE Suite app with consistent initialization pattern.
 *
 * This handles:
 * - SaaS vs Standalone mode detection
 * - Supabase session wiring (SaaS) without bundling auth into standalone
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
  } = config

  const rootElement = document.getElementById(rootId)
  if (!rootElement) {
    throw new Error(`Root element #${rootId} not found`)
  }

  const root = createRoot(rootElement)

  if (isSaaSMode()) {
    // Dynamically import the Supabase session hook so standalone builds never
    // pull in Supabase Auth.
    const { SaaSAuthGate } = await importSaaSAuthGate()
    const { useSupabaseUser } = await import('../auth/useSupabaseUser')

    // Wrapper component that reads the shared Supabase session.
    function SaaSApp() {
      const { user, loading } = useSupabaseUser()
      return (
        <SaaSAuthGate userId={user?.id} isLoaded={!loading}>
          <App />
        </SaaSAuthGate>
      )
    }

    root.render(
      <StrictMode>
        <SaaSApp />
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
