import { test as base, expect } from '@playwright/test'
import { describeCspViolations, trackCspViolations, type CspViolationTracker } from '../../utils/cspViolations'

/**
 * The standalone suite's `test`: every test runs with the offline build's
 * Content-Security-Policy watched (ESCSUITE-467), and fails if anything the
 * test did was blocked by it. Recording, editing, export and the decode worker
 * all run under the real policy here, so a policy too tight for the app turns
 * this suite red instead of breaking a downloaded file.
 *
 * A test that provokes violations on purpose (`offline-csp.spec.ts`) sets
 * `test.use({ allowCspViolations: true })` and reads `cspViolations` itself.
 */
export const test = base.extend<{
  allowCspViolations: boolean
  cspViolations: CspViolationTracker
}>({
  allowCspViolations: [false, { option: true }],
  cspViolations: [
    async ({ context, allowCspViolations }, use) => {
      const tracker = await trackCspViolations(context)
      await use(tracker)
      if (!allowCspViolations) {
        const violations = tracker.violations()
        expect(
          violations,
          `The offline build's Content-Security-Policy blocked something this test did:\n` +
            describeCspViolations(violations)
        ).toEqual([])
      }
    },
    { auto: true },
  ],
})

export { expect }
