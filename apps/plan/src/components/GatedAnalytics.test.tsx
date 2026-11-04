import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { BeforeSend } from '@vercel/analytics/react'

// Collaborator is mocked (never the module under test), the same way
// packages/shared/src/bootstrap/index.test.tsx stubs it, so presence/absence
// can be asserted without a network call.
// The props each render handed it, so the beforeSend it was given can be
// exercised (ESCSUITE-406).
const analyticsProps = vi.hoisted(() => [] as Array<{ beforeSend?: unknown }>)

vi.mock('@vercel/analytics/react', () => ({
  Analytics: (props: { beforeSend?: unknown }) => {
    analyticsProps.push(props)
    return <div data-testid="vercel-analytics-marker" />
  },
}))

describe('GatedAnalytics', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mounts Analytics in SaaS mode (default build mode)', async () => {
    const { GatedAnalytics } = await import('./GatedAnalytics')

    const { queryByTestId } = render(<GatedAnalytics />)

    expect(queryByTestId('vercel-analytics-marker')).not.toBeNull()
  })

  // ESCSUITE-406: no record may carry the page's query string.
  it('passes the shared beforeSend, which keeps only the path', async () => {
    analyticsProps.length = 0
    const { GatedAnalytics } = await import('./GatedAnalytics')
    const { analyticsBeforeSend } = await import('@escapesuite/shared/analytics')

    render(<GatedAnalytics />)

    const { beforeSend } = analyticsProps[analyticsProps.length - 1]
    expect(beforeSend).toBe(analyticsBeforeSend)
    expect(
      (beforeSend as BeforeSend)({
        type: 'event',
        url: 'https://www.escapesuite.io/?video=https%3A%2F%2Fh.example%2Fv.mp4&title=secret&project=eyJ9#x',
      })
    ).toEqual({ type: 'event', url: 'https://www.escapesuite.io/' })
  })

  it('mounts nothing in standalone build mode', async () => {
    vi.stubEnv('VITE_BUILD_MODE', 'standalone')
    vi.resetModules()

    const { GatedAnalytics } = await import('./GatedAnalytics')

    const { queryByTestId, container } = render(<GatedAnalytics />)

    expect(queryByTestId('vercel-analytics-marker')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})
