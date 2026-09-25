// The one place the three companion roles differ in words.
//
// Every sentence about a part — its stored name, its library row, the five
// things the recorder and the save path can say went wrong with it — is
// derived from this table, so the copy exists once and a fourth role would be
// one entry rather than a grep.
import { describe, it, expect } from 'vitest'
import { COMPANION_PARTS, companionPartFor } from './companionParts'

describe('COMPANION_PARTS', () => {
  it('names each role twice — mid-sentence and sentence-initial', () => {
    expect(COMPANION_PARTS.webcam).toEqual({
      label: 'webcam',
      trackLabel: 'Webcam',
      isAudio: false,
    })
    expect(COMPANION_PARTS.mic).toEqual({
      label: 'microphone',
      trackLabel: 'Microphone',
      isAudio: true,
    })
    expect(COMPANION_PARTS.system).toEqual({
      label: 'system audio',
      trackLabel: 'System audio',
      isAudio: true,
    })
  })
})

describe('companionPartFor', () => {
  it('answers for each companion role', () => {
    expect(companionPartFor('webcam')).toBe(COMPANION_PARTS.webcam)
    expect(companionPartFor('mic')).toBe(COMPANION_PARTS.mic)
    expect(companionPartFor('system')).toBe(COMPANION_PARTS.system)
  })

  it('answers null for the primary and for a row that has no role at all', () => {
    // A primary is not a companion, and every recording made before
    // ESCSUITE-14 has no role stored. Both are "this row is the take".
    expect(companionPartFor('screen')).toBeNull()
    expect(companionPartFor(undefined)).toBeNull()
  })
})
