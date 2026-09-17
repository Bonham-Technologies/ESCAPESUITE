import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { GatedAnalytics } from './components/GatedAnalytics'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
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
