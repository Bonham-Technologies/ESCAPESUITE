import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}))

// The build mode is read at module scope, so every test loads `./index` fresh
// (after `vi.resetModules()`) and pulls `track` out of the same fresh registry —
// resetting the registry re-runs the mock factory, so the top-level binding
// would be a different spy than the one the module under test calls.
// `@vercel/analytics` is loaded first, and awaited, so the module under test
// picks that same registered instance up rather than racing a second one in.
async function load() {
  const { track } = await import('@vercel/analytics')
  const { trackEvent } = await import('./index')
  return { trackEvent, track: vi.mocked(track) }
}

describe('trackEvent', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('forwards the event name to @vercel/analytics track', async () => {
    const { trackEvent, track } = await load()
    trackEvent('Test Event')
    expect(track).toHaveBeenCalledWith('Test Event', undefined)
  })

  it('forwards event name and props', async () => {
    const { trackEvent, track } = await load()
    trackEvent('Test Event', { foo: 'bar', count: 42, active: true })
    expect(track).toHaveBeenCalledWith('Test Event', { foo: 'bar', count: 42, active: true })
  })

  it('does not call track in a standalone build', async () => {
    vi.stubEnv('VITE_BUILD_MODE', 'standalone')
    vi.resetModules()

    const { trackEvent, track } = await load()
    trackEvent('Recording Started', { duration: 12 })

    expect(track).not.toHaveBeenCalled()
  })
})
