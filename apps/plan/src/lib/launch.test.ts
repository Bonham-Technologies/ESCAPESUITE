import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// analytics.toolLaunched/offlineBuildDownloaded are collaborators — mock them,
// never the module under test.
vi.mock('./analytics', () => ({
  analytics: { toolLaunched: vi.fn(), offlineBuildDownloaded: vi.fn() },
}))

import { analytics } from './analytics'
import {
  toolUrl,
  launchTool,
  trackOfflineDownload,
  GITHUB_URL,
  RELEASES_URL,
  CRAFT_OFFLINE_BUILD_URL,
  ARTIST_OFFLINE_BUILD_URL,
} from './launch'

describe('constants', () => {
  it('GITHUB_URL points at the repository', () => {
    expect(GITHUB_URL).toBe('https://github.com/Bonham-Technologies/ESCAPESUITE')
  })

  it('RELEASES_URL points at the latest release (the "all downloads" link)', () => {
    expect(RELEASES_URL).toBe('https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest')
  })

  // These resolve against the umbrella release's stable asset names
  // (ESCSUITE-195) rather than GitHub's bare `/releases/latest`, which can
  // resolve to any per-package release a changesets publish creates —
  // including one with no offline build attached at all.
  it('CRAFT_OFFLINE_BUILD_URL points at the stable ESCAPECRAFT asset on the latest release', () => {
    expect(CRAFT_OFFLINE_BUILD_URL).toBe(
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest/download/ESCAPECRAFT-latest.html'
    )
  })

  it('ARTIST_OFFLINE_BUILD_URL points at the stable ESCAPEARTIST asset on the latest release', () => {
    expect(ARTIST_OFFLINE_BUILD_URL).toBe(
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest/download/ESCAPEARTIST-latest.html'
    )
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

describe('trackOfflineDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tracks an Offline Build Downloaded analytics event with no tool for the "all downloads" link', () => {
    trackOfflineDownload()
    expect(analytics.offlineBuildDownloaded).toHaveBeenCalledTimes(1)
    expect(analytics.offlineBuildDownloaded).toHaveBeenCalledWith(undefined)
  })

  it('names the tool for the ESCAPECRAFT download link', () => {
    trackOfflineDownload('craft')
    expect(analytics.offlineBuildDownloaded).toHaveBeenCalledWith('craft')
  })

  it('names the tool for the ESCAPEARTIST download link', () => {
    trackOfflineDownload('artist')
    expect(analytics.offlineBuildDownloaded).toHaveBeenCalledWith('artist')
  })
})
