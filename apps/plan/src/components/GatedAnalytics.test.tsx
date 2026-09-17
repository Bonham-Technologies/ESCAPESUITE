import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'

// Collaborator is mocked (never the module under test), the same way
// packages/shared/src/bootstrap/index.test.tsx stubs it, so presence/absence
// can be asserted without a network call.
vi.mock('@vercel/analytics/react', () => ({
  Analytics: () => <div data-testid="vercel-analytics-marker" />,
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

  it('mounts nothing in standalone build mode', async () => {
    vi.stubEnv('VITE_BUILD_MODE', 'standalone')
    vi.resetModules()

    const { GatedAnalytics } = await import('./GatedAnalytics')

    const { queryByTestId, container } = render(<GatedAnalytics />)

    expect(queryByTestId('vercel-analytics-marker')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})
