import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderInChromium } from './renderDriver'
import { MAX_TIMEOUT_MS } from './timeouts'
import type { LoadedJob } from './loaders'

// Review finding 5: `chromium` is a plain module-scope import from 'playwright', so the
// straggling-launch cleanup (launching.then((late) => late.close()...)) is testable without a
// real browser -- a mocked launch that resolves after the deadline has already won the race.
const launchControl = vi.hoisted(() => ({
  delayMs: 0,
  closeMock: vi.fn(async () => undefined),
}))

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, launchControl.delayMs))
      return { close: launchControl.closeMock, version: () => 'mock-chromium' }
    }),
  },
}))

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

describe('renderInChromium launch deadline (mocked playwright)', () => {
  afterEach(() => {
    launchControl.delayMs = 0
    launchControl.closeMock.mockClear()
  })

  // Review finding 5: without this cleanup, a launch that eventually resolves after the
  // deadline already rejected the call would leak a Chromium process -- one per timed-out job
  // on `serve`. Asserts both that the caller still sees the deadline's own message and that
  // the straggling browser is closed once it does resolve.
  it('closes a browser that finishes launching after the deadline already won the race', async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-launch-mock-'))
    try {
      const bundleHtmlPath = path.join(scratch, 'bundle.html')
      await fs.writeFile(bundleHtmlPath, '<html></html>')
      launchControl.delayMs = 50

      await expect(
        renderInChromium(bundleHtmlPath, STUB_JOB, { format: 'mp4', quality: 'medium' }, path.join(scratch, 'out.mp4'), {
          timeoutMs: 10,
        }),
      ).rejects.toThrow('render timed out after 10 ms')

      expect(launchControl.closeMock).not.toHaveBeenCalled()
      // The mocked launch resolves ~50 ms after the call already rejected; give it room to.
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(launchControl.closeMock).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(scratch, { recursive: true, force: true })
    }
  })
})
