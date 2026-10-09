// Build-time configuration.
// 'saas' (default) = hosted at escapesuite.io (Vercel Analytics enabled).
// 'standalone' = offline single-file build (no analytics, no network).
//
// Vite inlines `import.meta.env.VITE_BUILD_MODE`, so `BUILD_MODE` is a string
// literal by the time the bundler sees it. Code that must *disappear* from a
// build rather than merely not run — the analytics runtime, see `../analytics`
// and `../bootstrap` — therefore compares `BUILD_MODE` directly, which the
// bundler can fold; the two predicates below are function calls and are opaque
// to that analysis, so they are for ordinary runtime branching only.
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'saas'

export const isSaaSMode = (): boolean => BUILD_MODE === 'saas'
export const isStandaloneMode = (): boolean => BUILD_MODE === 'standalone'

// True when the current document is running inside a frame (e.g. ESCAPEARTIST
// embedded in a host page). Safe to call during SSR / in workers where
// `window` does not exist.
export const isEmbedded = (): boolean =>
  typeof window !== 'undefined' && window.parent !== window

// True when the document was opened from disk (`file:`) — the released
// single-file builds, run by double-click. A relative or root-absolute URL
// such as the default `EDITOR_URL` (`/artist/`) resolves to `file:///artist/`
// there, a browser error page, so anything that navigates to a sibling app
// has to know. Safe to call where `window` does not exist.
export const isFileOrigin = (): boolean =>
  typeof window !== 'undefined' && window.location.protocol === 'file:'

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
// The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` from vercel.json;
// self-hosted builds must set their own.
//
// The value need not be a bare origin: any http:/https: value `new URL(v)`
// can parse is accepted and normalised down to its `.origin` (ESCSUITE-176) —
// a trailing slash or a path included, since a host is as likely to build
// this from `location.href` or a routed URL as to type a bare origin by
// hand. Only a value `new URL()` cannot parse at all, one with an opaque
// origin, or one on any scheme other than `http:`/`https:`, is ignored, with
// one warning per page load so a misconfigured host is noticed but a
// repeated call cannot flood the console. The parameter being absent
// entirely is the one case that stays silent — "no host named itself" is not
// a misconfiguration — so `?hostOrigin=` and bare `?hostOrigin` (a host that
// interpolated an `undefined` variable into its iframe URL, most likely)
// warn just like any other unusable value rather than being treated as
// absent (ESCSUITE-199).
let hostOriginWarned = false

export const parseHostOrigin = (
  search: string = typeof window !== 'undefined' ? window.location.search : ''
): string | null => {
  const params = new URLSearchParams(search)
  if (!params.has('hostOrigin')) return null
  // `has()` was just true, so `get()` cannot return null here; the assertion
  // says so to the type checker without a fallback no caller can reach.
  const value = params.get('hostOrigin')!

  try {
    const url = new URL(value)
    // An opaque origin (data:, or any scheme with no authority) serialises as
    // the literal string "null" rather than throwing — accepting it would
    // hand postMessage a targetOrigin that matches a sandboxed iframe's own
    // origin, not a real host. `http:`/`https:` is also enforced explicitly
    // rather than relying on that check alone: Chromium serialises a
    // `file:` URL's origin as the non-opaque string `'file://'`, which would
    // otherwise pass — harmlessly, since no real document has that origin to
    // receive the post, but a real host is always served over HTTP(S), so
    // restricting to the schemes one can actually run from closes the gap
    // outright rather than leaning on the postMessage recipient failing to
    // exist.
    if (url.origin !== 'null' && (url.protocol === 'http:' || url.protocol === 'https:')) {
      return url.origin
    }
  } catch {
    // Falls through to the warning below.
  }

  if (!hostOriginWarned) {
    hostOriginWarned = true
    console.warn(
      `[config] ignoring invalid hostOrigin "${value}" — expected a URL such as https://host.example`
    )
  }
  return null
}

// Test seam: clears the warn-once latch so each test starts from a clean slate.
export const resetHostOriginWarning = (): void => {
  hostOriginWarned = false
}
