import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { captureConsole, expectSeekableTake, recordPipTake } from '../../utils/seekable'

/**
 * A PiP take is stored seekable in the build that actually ships.
 *
 * The same check as `tests/escapecraft/pip-seekable.spec.ts`, run against the
 * combined `dist/` that `pnpm build:deploy` produces — because the dev server
 * and the production bundle do not share a module pipeline. Vite 8 pre-bundles
 * dependencies with Rolldown for the dev server and bundles them again for the
 * build, and the two disagreed about what `import fixWebmDuration from
 * 'webm-duration-fix'` (a CommonJS module with `exports.default` and
 * `__esModule`) binds to. Only running the take in both says whether a broken
 * import is a dev-server nuisance or a shipped regression, so both run.
 *
 * Requires `pnpm build:deploy` first; `playwright.production.config.ts` serves
 * the result on one port.
 */

const CRAFT_URL = 'http://localhost:5190/craft/'

test.describe('ESCAPECRAFT PiP recording (production layout)', () => {
  test('stores a PiP take with repaired, seekable WebM metadata', async ({ page }) => {
    test.setTimeout(120_000)

    const consoleLog = captureConsole(page)
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await recordPipTake(page, CRAFT_URL)

    // Same log-line path proof, and the same caveat, as the dev-server spec.
    expect(consoleLog.matching(/Using MediaRecorder-based recorder \(PiP mode\)/)).not.toEqual([])

    await expectSeekableTake(page, consoleLog)
  })
})
