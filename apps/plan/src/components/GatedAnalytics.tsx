import { Analytics } from '@vercel/analytics/react'
import { isSaaSMode } from '@escapesuite/shared/config'

/**
 * Mounts Vercel Analytics only in hosted (saas) builds — the same intent
 * `bootstrapApp` applies for ESCAPECRAFT and ESCAPEARTIST (see
 * `@escapesuite/shared`'s `src/bootstrap/index.tsx`), but not the same gate:
 * `bootstrapApp` compares `BUILD_MODE` directly so the bundler can fold the
 * branch away, while this component calls the runtime check `isSaaSMode()`
 * instead, because it is opaque to that analysis (see `../config`'s doc
 * comment). ESCAPEPLAN builds its own root in `main.tsx` rather than calling
 * `bootstrapApp` (it wraps `<App />` in `<BrowserRouter>`, which
 * `bootstrapApp` has no hook for), so this component carries the equivalent
 * gate on its own — and is unit tested here, since `main.tsx` is excluded
 * from coverage as a bootstrap entry point (see `vitest.config.ts`).
 *
 * ESCAPEPLAN has no standalone build today, so `isSaaSMode()` is always true
 * in practice; this exists for consistency with the other two apps rather
 * than to close a live leak.
 */
export function GatedAnalytics() {
  return isSaaSMode() ? <Analytics /> : null
}
