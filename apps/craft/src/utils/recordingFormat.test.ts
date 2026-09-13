import { describe, it, expect } from 'vitest'
import { formatDuration, safeFileName } from './recordingFormat'

describe('formatDuration', () => {
  it('formats zero seconds', () => {
    expect(formatDuration(0)).toBe('00:00')
  })

  it('floors fractional seconds independently for minutes and seconds', () => {
    expect(formatDuration(65.9)).toBe('01:05')
  })

  it('does not roll minutes over at 60 — pads past two digits instead', () => {
    expect(formatDuration(3600)).toBe('60:00')
  })
})

describe('safeFileName', () => {
  it('replaces every non-alphanumeric run with an underscore and lowercases the result', () => {
    expect(safeFileName('Standup Demo: 9/9')).toBe('standup_demo__9_9')
  })
})
