// Most of this module's notices are exercised, by value, wherever they are
// raised — `useRecordingSave.test.ts` and `useRecordingController.test.ts`
// compare against the exported constant, not a literal, so a wording change
// would not fail either suite. This file is the one place several of those
// constants are asserted against their actual text, so a copy edit that
// changes the sentence rather than just moving it is visible in a diff here.
import { describe, it, expect } from 'vitest'
import { SEPARATE_TRACK_NOT_SAVED } from './notices'

describe('SEPARATE_TRACK_NOT_SAVED', () => {
  it('is the exact sentence raised for a separate-tracks companion that did not make it', () => {
    expect(SEPARATE_TRACK_NOT_SAVED).toBe(
      'A separate track could not be saved — the screen recording was kept.'
    )
  })
})
