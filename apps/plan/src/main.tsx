import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@escapesuite/shared/components'
import App from './App'
import { GatedAnalytics } from './components/GatedAnalytics'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/*
        ESCSUITE-219: the shared ErrorBoundary, mounted here for the same reason
        `GatedAnalytics` is (`bootstrapApp()` has no hook for `<BrowserRouter>`). Inside the
        router so the fallback's Reload keeps the current route; `GatedAnalytics` stays
        outside it. No `onError`: the hub holds nothing live (no capture, no worker) that a
        crash could leave running, so there is nothing to release.
      */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
    {/*
      `GatedAnalytics` carries the same `isSaaSMode()` gate `bootstrapApp()` applies for
      ESCAPECRAFT and ESCAPEARTIST — mounted directly here (rather than via `bootstrapApp()`
      itself) only because that helper has no hook for the `<BrowserRouter>` wrapper above.
      See `apps/plan/src/components/GatedAnalytics.tsx`.
    */}
    <GatedAnalytics />
  </StrictMode>
)
