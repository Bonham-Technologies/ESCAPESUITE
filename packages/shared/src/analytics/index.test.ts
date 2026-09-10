import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}))

import { track } from '@vercel/analytics'
import { trackEvent } from './index'

describe('trackEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the event name to @vercel/analytics track', () => {
    trackEvent('Test Event')
    expect(track).toHaveBeenCalledWith('Test Event', undefined)
  })

  it('forwards event name and props', () => {
    trackEvent('Test Event', { foo: 'bar', count: 42, active: true })
    expect(track).toHaveBeenCalledWith('Test Event', { foo: 'bar', count: 42, active: true })
  })
})
