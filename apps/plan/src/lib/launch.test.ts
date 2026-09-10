import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// analytics.toolLaunched is a collaborator — mock it, never the module under test.
vi.mock('./analytics', () => ({
  analytics: { toolLaunched: vi.fn() },
}))

import { analytics } from './analytics'
import { toolUrl, launchTool, GITHUB_URL, RELEASES_URL } from './launch'

describe('constants', () => {
  it('GITHUB_URL points at the repository', () => {
    expect(GITHUB_URL).toBe('https://github.com/Bonham-Technologies/ESCAPESUITE')
  })

  it('RELEASES_URL points at the latest release', () => {
    expect(RELEASES_URL).toBe('https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest')
  })
})

describe('toolUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the production path for craft when not in DEV', () => {
    vi.stubEnv('DEV', false)
    expect(toolUrl('craft')).toBe('/craft/')
  })

  it('returns the production path for artist when not in DEV', () => {
    vi.stubEnv('DEV', false)
    expect(toolUrl('artist')).toBe('/artist/')
  })

  it('returns the dev server URL for craft when in DEV', () => {
    vi.stubEnv('DEV', true)
    expect(toolUrl('craft')).toBe('http://localhost:5174')
  })

  it('returns the dev server URL for artist when in DEV', () => {
    vi.stubEnv('DEV', true)
    expect(toolUrl('artist')).toBe('http://localhost:5175')
  })
})

describe('launchTool', () => {
  let openSpy: ReturnType<typeof vi.fn>
  let assignSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    openSpy = vi.fn()
    assignSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    // vi.stubGlobal replaces globals, not properties of one, so location.assign is
    // redefined in place — jsdom's own would only log "Not implemented: navigation".
    Object.defineProperty(window.location, 'assign', {
      value: assignSpy,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('tracks a Tool Launched analytics event', () => {
    vi.stubEnv('DEV', false)
    launchTool('craft')
    expect(analytics.toolLaunched).toHaveBeenCalledWith('craft')
  })

  it('opens the dev server URL in a new tab in DEV mode', () => {
    vi.stubEnv('DEV', true)
    launchTool('artist')
    expect(openSpy).toHaveBeenCalledWith('http://localhost:5175', '_blank')
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('navigates via location.assign to the production path outside DEV', () => {
    vi.stubEnv('DEV', false)
    launchTool('craft')
    expect(assignSpy).toHaveBeenCalledWith('/craft/')
    expect(openSpy).not.toHaveBeenCalled()
  })
})
