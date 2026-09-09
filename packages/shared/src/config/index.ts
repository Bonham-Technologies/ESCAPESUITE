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
export const EDITOR_URL = rawEditorUrl.replace(/\/+$/, '') + '/'

export const editorUrl = (params?: Record<string, string>): string => {
  if (!params || Object.keys(params).length === 0) return EDITOR_URL
  const query = new URLSearchParams(params).toString()
  return `${EDITOR_URL}?${query}`
}

// An embedding host may name itself with `?hostOrigin=<origin>` so the app can
// address its postMessage traffic at that origin instead of '*' and ignore
// inbound messages from anywhere else.
//
// This protects the *host's* deployment — a page that frames the app also
// controls the app's URL, so a hostile framer would simply supply its own
// origin. Refusing to be framed at all is `Content-Security-Policy:
// frame-ancestors` on the deployment serving the app, not a URL parameter.
//
// The value must be a bare origin ('https://host.example', port allowed): a URL
// whose serialisation is exactly its own origin. Anything else is ignored, with
// one warning per page load so a misconfigured host is noticed but a repeated
// call cannot flood the console.
let hostOriginWarned = false

export const parseHostOrigin = (
  search: string = typeof window !== 'undefined' ? window.location.search : ''
): string | null => {
  const value = new URLSearchParams(search).get('hostOrigin')
  if (!value) return null

  try {
    if (new URL(value).origin === value) return value
  } catch {
    // Falls through to the warning below.
  }

  if (!hostOriginWarned) {
    hostOriginWarned = true
    console.warn(
      `[config] ignoring invalid hostOrigin "${value}" — expected a bare origin such as https://host.example`
    )
  }
  return null
}

// Test seam: clears the warn-once latch so each test starts from a clean slate.
export const resetHostOriginWarning = (): void => {
  hostOriginWarned = false
}
