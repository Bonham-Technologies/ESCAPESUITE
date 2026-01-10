import * as Sentry from '@sentry/react'

export interface SentryOptions {
  /** Product identifier for error tagging (e.g., 'plan', 'craft', 'artist') */
  product?: string
  /** Sentry DSN - defaults to VITE_SENTRY_DSN env var */
  dsn?: string
}

/**
 * Initialize Sentry error tracking with standard configuration
 */
export function initSentry(options: SentryOptions = {}) {
  const dsn = options.dsn ?? import.meta.env.VITE_SENTRY_DSN

  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Performance monitoring
    tracesSampleRate: 0.1, // 10% of transactions
    // Session replay for errors
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
    // Tag errors with product if provided
    beforeSend(event) {
      if (options.product) {
        event.tags = { ...event.tags, product: options.product }
      }
      return event
    },
  })
}

export { Sentry }
