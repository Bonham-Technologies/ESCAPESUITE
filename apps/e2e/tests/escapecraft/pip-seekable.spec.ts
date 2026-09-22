import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { captureConsole, expectSeekableTake, recordPipTake } from '../../utils/seekable'

/**
 * A PiP take (screen + webcam) is stored seekable.
 *
 * This is the only ESCAPECRAFT spec that exercises the **MediaRecorder** half
 * of `recorder-factory.ts`. Chromium sends a screen-only take through
 * WebCodecs, whose output is already seekable; a PiP take goes through the
 * compositor and MediaRecorder, and only that output is handed to
 * `fixWebMMetadata()` — and so to `webm-duration-fix` — before storage.
 *
 * It exists because that import broke without any test noticing: under Vite 8's
 * CJS interop the default import resolved to the module's `exports` object
 * rather than the function on it, every PiP save logged
 * `fixWebmDuration is not a function`, and the take was stored raw — playable,
 * but with no Duration and no Cues, so it would not scrub. Every unit test
 * `vi.mock`s the library, so none of them could see the real module's shape.
 *
 * The assertion is the user-visible property, not the bytes: a `<video>` fed
 * the stored blob must report a finite `duration`.
 */

const CRAFT_URL = 'http://localhost:5174'

test.describe('ESCAPECRAFT PiP recording', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Only Chromium can be granted camera permission headlessly, which a PiP take needs'
  )

  test('stores a PiP take with repaired, seekable WebM metadata', async ({ page }) => {
    test.setTimeout(120_000)

    const consoleLog = captureConsole(page)
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await recordPipTake(page, CRAFT_URL)

    // The take really did take the MediaRecorder path — otherwise this spec
    // would be a second, slower copy of the screen-only WebCodecs one.
    expect(consoleLog.matching(/Using MediaRecorder-based recorder \(PiP mode\)/)).not.toEqual([])

    await expectSeekableTake(page, consoleLog)
  })
})
