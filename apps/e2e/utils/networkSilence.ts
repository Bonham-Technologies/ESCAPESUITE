import type { BrowserContext } from '@playwright/test'

/**
 * Network-silence checks: which addresses a page may reach, and a tracker
 * that records everything else (ESCSUITE-402).
 *
 * The standalone suites (`tests/standalone/craft.spec.ts`, `artist.spec.ts`)
 * each wire their own `page.on('request')` filter for the offline build, which
 * may reach nothing at all. The hosted build may reach its own origin and the
 * hosts in {@link ANALYTICS_ALLOWED_HOSTS}, and its record, edit and export
 * path crosses three pages (hub, CRAFT, and the ARTIST window CRAFT opens), so
 * this tracker listens on the whole browser context and also counts the
 * attempts the hosted Content-Security-Policy blocks before they become a
 * request at all.
 */

/**
 * Hosts other than the page's own origin that a hosted build may contact.
 *
 * In a production build `@vercel/analytics` loads its script from the site's
 * own `/_vercel/insights/script.js` and sends page views and events to
 * `/_vercel/insights/`, so its traffic is same-origin. Its one off-origin
 * address is `va.vercel-scripts.com`, the debug script it loads when it runs
 * in development mode (`getScriptSrc` in `@vercel/analytics`); that string is
 * in the hosted bundle (docs/reference/vercel-analytics.md), so it is the one
 * analytics host allowed here. Anything else fails the check.
 */
export const ANALYTICS_ALLOWED_HOSTS: readonly string[] = ['va.vercel-scripts.com']

export type UrlVerdict = 'not-network' | 'same-origin' | 'allow-listed' | 'off-origin'

const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])

/**
 * Where `url` points, relative to `origin` and `allowHosts`.
 *
 * `data:`, `blob:` and `about:` URLs never leave the page, and a CSP report's
 * `blockedURI` can be a keyword (`inline`, `eval`) rather than an address, so
 * anything that is not an http(s) or ws(s) URL is `not-network`.
 */
export function classifyUrl(
  url: string,
  origin: string,
  allowHosts: readonly string[] = ANALYTICS_ALLOWED_HOSTS
): UrlVerdict {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'not-network'
  }
  if (!NETWORK_PROTOCOLS.has(parsed.protocol)) return 'not-network'
  if (parsed.host === new URL(origin).host) return 'same-origin'
  if (allowHosts.includes(parsed.hostname)) return 'allow-listed'
  return 'off-origin'
}

export interface OffOriginAttempt {
  url: string
  /**
   * `request`: the browser sent it (and the tracker aborted it before it left
   * the machine). `csp-blocked`: the page tried and the Content-Security-Policy
   * refused it, so it never became a request — still a page reaching out.
   */
  via: 'request' | 'csp-blocked'
}

export interface NetworkSilenceTracker {
  /** The hosts besides the origin this tracker accepts. */
  readonly allowHosts: readonly string[]
  /** Every network request the context sent, from any page or worker, in order. */
  requests(): string[]
  /** Every request or blocked attempt to a host outside the origin and the allow-list. */
  violations(): OffOriginAttempt[]
}

/**
 * Start recording every request `context` makes, in every page and popup it
 * opens. Call it before the first navigation.
 *
 * Off-origin requests (allow-listed ones included) are aborted after they are
 * recorded, so a test run never actually sends anything to a third party.
 */
export async function trackNetworkSilence(
  context: BrowserContext,
  { origin, allowHosts = ANALYTICS_ALLOWED_HOSTS }: { origin: string; allowHosts?: readonly string[] }
): Promise<NetworkSilenceTracker> {
  const requests: string[] = []
  const violations: OffOriginAttempt[] = []

  context.on('request', (request) => {
    const url = request.url()
    requests.push(url)
    if (classifyUrl(url, origin, allowHosts) === 'off-origin') violations.push({ url, via: 'request' })
  })

  await context.route(
    (url) => {
      const verdict = classifyUrl(url.href, origin, allowHosts)
      return verdict === 'off-origin' || verdict === 'allow-listed'
    },
    (route) => route.abort('blockedbyclient')
  )

  await context.exposeBinding('__escsuiteCspBlocked', (_source, blockedURI: string) => {
    if (classifyUrl(blockedURI, origin, allowHosts) === 'off-origin') {
      violations.push({ url: blockedURI, via: 'csp-blocked' })
    }
  })
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __escsuiteCspBlocked?: (uri: string) => void })
        .__escsuiteCspBlocked
      report?.(event.blockedURI)
    })
  })

  return {
    allowHosts,
    requests: () => [...requests],
    violations: () => [...violations],
  }
}

/**
 * Throw, naming every offender, if the tracked context reached any host
 * outside its own origin and the allow-list. A plain `Error` rather than a
 * failed `expect`, so a test can also prove that it throws.
 */
export function assertNetworkSilence(tracker: NetworkSilenceTracker): void {
  const violations = tracker.violations()
  if (violations.length === 0) return
  throw new Error(
    `Expected no requests outside this origin and the analytics allow-list ` +
      `(${tracker.allowHosts.join(', ') || 'none'}), got ${violations.length}:\n` +
      violations.map((v) => `  ${v.via}: ${v.url}`).join('\n')
  )
}
