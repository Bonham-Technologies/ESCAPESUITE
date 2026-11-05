import { describe, it, expect } from 'vitest'
import { analyticsBeforeSend, stripQueryAndFragment } from './beforeSend'

// The shape an integration host puts in ESCAPEARTIST's address (ESCSUITE-406).
const EMBEDDED_URL =
  'https://www.escapesuite.io/artist/?video=https%3A%2F%2Fhost.example%2Fclip.mp4' +
  '&title=Quarterly%20review&project=eyJuYW1lIjoic2VjcmV0In0%3D#section'

describe('stripQueryAndFragment', () => {
  it('drops the query string and fragment and keeps the path', () => {
    expect(stripQueryAndFragment(EMBEDDED_URL)).toBe('https://www.escapesuite.io/artist/')
  })

  it('drops a fragment that has no query before it', () => {
    expect(stripQueryAndFragment('https://www.escapesuite.io/craft/#take')).toBe(
      'https://www.escapesuite.io/craft/'
    )
  })

  it('cuts at the fragment when a ? appears only inside it', () => {
    expect(stripQueryAndFragment('https://www.escapesuite.io/#a?b=1')).toBe(
      'https://www.escapesuite.io/'
    )
  })

  it('returns a URL with neither unchanged', () => {
    expect(stripQueryAndFragment('https://www.escapesuite.io/privacy')).toBe(
      'https://www.escapesuite.io/privacy'
    )
  })
})

describe('analyticsBeforeSend', () => {
  it('sends a page view with the path only', () => {
    expect(analyticsBeforeSend({ type: 'pageview', url: EMBEDDED_URL })).toEqual({
      type: 'pageview',
      url: 'https://www.escapesuite.io/artist/',
    })
  })

  it('sends a custom event with the path only and keeps everything else it carries', () => {
    // The insights script hands the hook the event's payload alongside `url`.
    const event = {
      type: 'event' as const,
      url: EMBEDDED_URL,
      payload: { name: 'Export Started', data: { format: 'mp4' } },
    }

    expect(analyticsBeforeSend(event)).toEqual({
      ...event,
      url: 'https://www.escapesuite.io/artist/',
    })
  })

  it('never cancels a record', () => {
    expect(analyticsBeforeSend({ type: 'pageview', url: 'https://www.escapesuite.io/' })).not.toBeNull()
  })
})
