// App bootstrap utilities for consistent initialization

import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { BUILD_MODE } from '../config'

export interface BootstrapConfig {
  /** The root element ID (default: 'root') */
  rootId?: string
  /** The main App component */
  App: ComponentType
}

/**
 * Bootstrap an ESCAPE Suite app.
 *
 * Analytics are only mounted in hosted (saas) builds — standalone builds run
 * fully offline and must make no network requests. As in `../analytics`, the
 * gate compares `BUILD_MODE` rather than calling `isSaaSMode()` so the bundler
 * can fold it: with the branch dead, `<Analytics />` is unreferenced and the
 * `@vercel/analytics` runtime — the script injector that would fetch
 * `va.vercel-scripts.com` — is dropped from the standalone bundle rather than
 * shipped inert.
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
      {BUILD_MODE === 'saas' && <Analytics />}
    </StrictMode>
  )
}

export type { BootstrapConfig as AppBootstrapConfig }
