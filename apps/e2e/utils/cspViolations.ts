import type { BrowserContext } from '@playwright/test'

/**
 * Records every Content-Security-Policy violation in a browser context
 * (ESCSUITE-467).
 *
 * The offline single-file builds carry a CSP `<meta>` that admits no network
 * source (`scripts/offline-csp.mjs`). If that policy is too tight for
 * something the app really does (a worker, a worklet, a media URL), the
 * browser blocks it, often silently. The standalone suite runs every test
 * with this tracker and fails a test that triggered any violation, so the
 * policy and the app cannot drift apart unnoticed.
 *
 * Two sources: the `securitypolicyviolation` event in every document the
 * context opens, and Chromium's own console line ("Refused to … because it
 * violates the following Content Security Policy directive"), which also
 * covers violations that only reach the console.
 */
export interface CspViolation {
  /** `event`: a `securitypolicyviolation` event; `console`: the browser's console line. */
  via: 'event' | 'console'
  /** The directive that blocked it, such as `connect-src` (events only). */
  directive: string
  /** The blocked address, or `inline` / `eval` (events only). */
  blockedURI: string
  /** The console text, or the event's sample. */
  text: string
}

export interface CspViolationTracker {
  violations(): CspViolation[]
}

const CONSOLE_VIOLATION = /Content Security Policy/i

/** Start recording; call before the first navigation. */
export async function trackCspViolations(context: BrowserContext): Promise<CspViolationTracker> {
  const violations: CspViolation[] = []

  await context.exposeBinding(
    '__escsuiteCspViolation',
    (_source, report: { directive: string; blockedURI: string; sample: string }) => {
      violations.push({ via: 'event', directive: report.directive, blockedURI: report.blockedURI, text: report.sample })
    }
  )
  await context.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        const report = (window as unknown as {
          __escsuiteCspViolation?: (r: { directive: string; blockedURI: string; sample: string }) => void
        }).__escsuiteCspViolation
        report?.({ directive: event.effectiveDirective, blockedURI: event.blockedURI, sample: event.sample })
      },
      true
    )
  })

  context.on('console', (message) => {
    const text = message.text()
    if (CONSOLE_VIOLATION.test(text)) violations.push({ via: 'console', directive: '', blockedURI: '', text })
  })

  return { violations: () => [...violations] }
}

/** One line per violation, for a failure message. */
export function describeCspViolations(violations: readonly CspViolation[]): string {
  return violations
    .map((v) => (v.via === 'event' ? `  event: ${v.directive} blocked ${v.blockedURI}` : `  console: ${v.text}`))
    .join('\n')
}
