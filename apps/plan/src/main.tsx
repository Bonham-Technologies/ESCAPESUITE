import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    {/*
      Mounted directly rather than through `bootstrapApp()` (which ESCAPECRAFT and
      ESCAPEARTIST use), so it is NOT behind that helper's `BUILD_MODE === 'saas'` gate.
      Safe today only because ESCAPEPLAN has no `build:standalone` script: it is always a
      hosted build, so the gate would pass anyway. `trackEvent()` is gated regardless —
      the shared wrapper checks `BUILD_MODE` itself. If ESCAPEPLAN ever gains an offline
      build, route this through `bootstrapApp()` first, or it will ship the analytics
      runtime the other two apps no longer carry. See `packages/shared/src/analytics`.
    */}
    <Analytics />
  </StrictMode>
)
