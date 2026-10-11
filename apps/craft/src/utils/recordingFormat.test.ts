import { describe, it, expect } from 'vitest'
import { downloadFileStem, formatDuration, safeFileName } from './recordingFormat'

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
  it('replaces every non-alphanumeric character with an underscore and lowercases the result', () => {
    expect(safeFileName('Standup Demo: 9/9')).toBe('standup_demo__9_9')
  })
})

describe('downloadFileStem', () => {
  const at = new Date(2026, 9, 10, 15, 4, 5).getTime()

  it('builds the stem from the take\'s own timestamp, zero-padded', () => {
    expect(downloadFileStem('Recording 10/10/2026, 3:04:05 PM', at)).toBe(
      'recording_2026-10-10_15-04-05'
    )
    expect(downloadFileStem('x', new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe(
      'recording_2026-01-02_03-04-05'
    )
  })

  it('appends the companion label, cleaned, when the name carries one', () => {
    expect(downloadFileStem('Recording 10/10/2026, 3:04:05 PM — Webcam', at)).toBe(
      'recording_2026-10-10_15-04-05_webcam'
    )
    expect(downloadFileStem('Recording x — System Audio', at)).toBe(
      'recording_2026-10-10_15-04-05_system_audio'
    )
  })

  it('is the same Latin stem whatever locale rendered the name', () => {
    const en = `Recording ${new Date(at).toLocaleString('en-US')}`
    const ar = `Recording ${new Date(at).toLocaleString('ar-EG')}`
    expect(downloadFileStem(ar, at)).toBe(downloadFileStem(en, at))
    expect(downloadFileStem(`${ar} — Webcam`, at)).toBe(
      'recording_2026-10-10_15-04-05_webcam'
    )
  })
})
