import { describe, expect, it } from 'vitest'
import { renderInChromium } from './renderDriver'
import { MAX_TIMEOUT_MS } from './timeouts'
import type { LoadedJob } from './loaders'

/**
 * A `LoadedJob` the guard under test never touches: `createDeadline`'s own `timeoutMs` bound
 * is checked before `renderInChromium` even looks at the bundle path or the job, so none of
 * these fields need to be real.
 */
const STUB_JOB: LoadedJob = {
  project: { id: 'stub', timeline: { clips: [] } } as unknown as LoadedJob['project'],
  sourceVideos: [],
  sourceFiles: {},
  async cleanup() {},
}

// ESCSUITE-206: the render deadline is the one programmatic surface `cli.ts`'s own
// HEADLESS_TIMEOUT_MS parser does not cover -- a library caller (or a test) can hand
// renderInChromium a timeoutMs directly, bypassing that parser's own MAX_TIMEOUT_MS bound. If
// it is above what setTimeout can represent, Node clamps the deadline to ~1 ms instead of
// refusing it, so a timer that was supposed to mean "almost no limit" fires immediately.
describe('renderInChromium timeoutMs bound', () => {
  it('refuses a timeoutMs above MAX_TIMEOUT_MS, naming the bound, before touching the bundle or Chromium', async () => {
    await expect(
      renderInChromium('/does/not/exist.html', STUB_JOB, { format: 'mp4', quality: 'medium' }, '/does/not/exist.mp4', {
        timeoutMs: MAX_TIMEOUT_MS + 1,
      }),
    ).rejects.toThrow(`timeoutMs must be at most ${MAX_TIMEOUT_MS}, got ${MAX_TIMEOUT_MS + 1}`)
  })

  it('accepts exactly the bound and proceeds past the guard (to the next real check: the missing bundle)', async () => {
    await expect(
      renderInChromium('/does/not/exist.html', STUB_JOB, { format: 'mp4', quality: 'medium' }, '/does/not/exist.mp4', {
        timeoutMs: MAX_TIMEOUT_MS,
      }),
    ).rejects.toThrow('headless bundle not found at /does/not/exist.html')
  })

  it('accepts an ordinary timeoutMs the same way', async () => {
    await expect(
      renderInChromium('/does/not/exist.html', STUB_JOB, { format: 'mp4', quality: 'medium' }, '/does/not/exist.mp4', {
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('headless bundle not found at /does/not/exist.html')
  })

  it('applies the same bound to the default timeout when none is given', async () => {
    // DEFAULT_TIMEOUT_MS (30 minutes) is already well under MAX_TIMEOUT_MS, so omitting
    // timeoutMs entirely must reach the same next check as passing one explicitly -- not the
    // bound's own error.
    await expect(
      renderInChromium('/does/not/exist.html', STUB_JOB, { format: 'mp4', quality: 'medium' }, '/does/not/exist.mp4'),
    ).rejects.toThrow('headless bundle not found at /does/not/exist.html')
  })
})
