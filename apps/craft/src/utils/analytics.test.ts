import { describe, it, expect, vi, beforeEach } from 'vitest'

// @vercel/analytics talks to a script the page injects; in tests it is the
// boundary we stop at. Everything below it (shared trackEvent, the ESCAPECRAFT
// event map) is exercised for real.
const { track } = vi.hoisted(() => ({ track: vi.fn() }))
vi.mock('@vercel/analytics', () => ({ track }))

import { analytics, trackEvent } from './analytics'

beforeEach(() => {
  track.mockClear()
})

describe('analytics', () => {
  it('re-exports the shared trackEvent, props and all', () => {
    trackEvent('Custom Event', { plan: 'free' })
    expect(track).toHaveBeenCalledWith('Custom Event', { plan: 'free' })
  })

  it('forwards an event with no props as undefined props', () => {
    trackEvent('Bare Event')
    expect(track).toHaveBeenCalledWith('Bare Event', undefined)
  })

  it('reports a started recording', () => {
    analytics.recordingStarted()
    expect(track).toHaveBeenCalledWith('Recording Started', undefined)
  })

  it('reports a completed recording with the duration rounded to whole seconds', () => {
    analytics.recordingCompleted(12.4)
    expect(track).toHaveBeenCalledWith('Recording Completed', { duration: 12 })

    analytics.recordingCompleted(12.6)
    expect(track).toHaveBeenLastCalledWith('Recording Completed', { duration: 13 })
  })

  it('reports a recording sent to the editor', () => {
    analytics.recordingSentToEditor()
    expect(track).toHaveBeenCalledWith('Recording Sent to Editor', undefined)
  })

  it('reports a downloaded recording', () => {
    analytics.recordingDownloaded()
    expect(track).toHaveBeenCalledWith('Recording Downloaded', undefined)
  })

  it('reports a deleted recording', () => {
    analytics.recordingDeleted()
    expect(track).toHaveBeenCalledWith('Recording Deleted', undefined)
  })
})
