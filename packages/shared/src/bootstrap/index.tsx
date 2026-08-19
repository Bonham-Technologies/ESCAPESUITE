// App bootstrap utilities for consistent initialization

import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { isSaaSMode } from '../config'

export interface BootstrapConfig {
  /** The root element ID (default: 'root') */
  rootId?: string
  /** The main App component */
  App: ComponentType
}

/**
 * Bootstrap an ESCAPE Suite app.
 * Analytics are only mounted in hosted (saas) builds — standalone builds run
 * fully offline and must make no network requests.
 */
export function bootstrapApp(config: BootstrapConfig): void {
  const { rootId = 'root', App } = config

  const rootElement = document.getElementById(rootId)
  if (!rootElement) {
    throw new Error(`Root element #${rootId} not found`)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
      {isSaaSMode() && <Analytics />}
    </StrictMode>
  )
}

export type { BootstrapConfig as AppBootstrapConfig }
