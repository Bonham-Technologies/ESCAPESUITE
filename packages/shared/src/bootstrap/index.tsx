// App bootstrap utilities for consistent initialization

import { StrictMode, type ComponentType, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { BUILD_MODE } from '../config'
import { ErrorBoundary } from '../components/ErrorBoundary'

export interface BootstrapConfig {
  /** The root element ID (default: 'root') */
  rootId?: string
  /** The main App component */
  App: ComponentType
  /**
   * Passed straight through to the shared `ErrorBoundary` wrapped around
   * `App` (ESCSUITE-212) — the one place a host app reaches for anything a
   * render-time throw would otherwise leave dangling (ESCAPECRAFT disposes a
   * live recorder; ESCAPEARTIST's is a documented no-op). See
   * `../components/ErrorBoundary`.
   */
  onError?: (error: Error, info: ErrorInfo) => void
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
 * shipped inert. `<Analytics />` sits outside the `ErrorBoundary` so a crash
 * in `App` cannot also take it down. That placement is deliberately
 * one-sided: Analytics is not itself guarded by anything, so a throw from
 * `<Analytics />` is uncaught and blanks the page — the one render path at
 * the root this ticket leaves unprotected, accepted because it is a small,
 * third-party, hosted-only script injector rather than a reason to change.
 */
export function bootstrapApp(config: BootstrapConfig): void {
  const { rootId = 'root', App, onError } = config

  const rootElement = document.getElementById(rootId)
  if (!rootElement) {
    throw new Error(`Root element #${rootId} not found`)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary onError={onError}>
        <App />
      </ErrorBoundary>
      {BUILD_MODE === 'saas' && <Analytics />}
    </StrictMode>
  )
}

export type { BootstrapConfig as AppBootstrapConfig }
