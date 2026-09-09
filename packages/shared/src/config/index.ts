// Build-time configuration.
// 'saas' (default) = hosted at escapesuite.io (Vercel Analytics enabled).
// 'standalone' = offline single-file build (no analytics, no network).
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'saas'

export const isSaaSMode = (): boolean => BUILD_MODE === 'saas'
export const isStandaloneMode = (): boolean => BUILD_MODE === 'standalone'

// True when the current document is running inside a frame (e.g. ESCAPEARTIST
// embedded in a host page). Safe to call during SSR / in workers where
// `window` does not exist.
export const isEmbedded = (): boolean =>
  typeof window !== 'undefined' && window.parent !== window

// Where CRAFT sends recordings for editing. Defaults to the co-hosted
// ESCAPEARTIST build; can be overridden to point at a different host.
// Always normalised to end with a single trailing slash.
const rawEditorUrl = import.meta.env.VITE_EDITOR_URL || '/artist/'
export const EDITOR_URL = rawEditorUrl.endsWith('/') ? rawEditorUrl : `${rawEditorUrl}/`

export const editorUrl = (params?: Record<string, string>): string => {
  if (!params || Object.keys(params).length === 0) return EDITOR_URL
  const query = new URLSearchParams(params).toString()
  return `${EDITOR_URL}?${query}`
}
