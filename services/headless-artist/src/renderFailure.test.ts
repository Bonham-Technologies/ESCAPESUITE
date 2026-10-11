import { describe, expect, it } from 'vitest'
import { CodedRenderError, isPermanentFailure, OUTPUT_SIZE_UNSUPPORTED, unwrapPageRender } from './renderFailure'
import type { RenderMeta, RenderOutcome } from './types'

const META: RenderMeta = { format: 'mp4', byteLength: 5, durationSec: 1, width: 64, height: 48, gpu: false }

const SIZE_SENTENCE =
  'The output size 64×8 is too small for H.264 — MP4 needs at least 16×16; WebM and GIF are unaffected.'

describe('unwrapPageRender', () => {
  it('hands back the meta of a render that finished', () => {
    expect(unwrapPageRender({ meta: META })).toBe(META)
  })

  // ESCSUITE-237: Playwright carries an in-page error's message across the evaluate boundary
  // and nothing else, so the bundle's `ExportError.code` has to come across as data.
  it('throws a coded error for a failure the bundle reported with a code', () => {
    let thrown: unknown
    try {
      unwrapPageRender({ failure: { message: SIZE_SENTENCE, code: OUTPUT_SIZE_UNSUPPORTED } })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CodedRenderError)
    expect(thrown).toMatchObject({ message: SIZE_SENTENCE, code: 'OUTPUT_SIZE_UNSUPPORTED' })
  })
})

describe('isPermanentFailure', () => {
  const failed = (extra: Partial<RenderOutcome> = {}): RenderOutcome =>
    ({ jobId: 'job-1', ok: false, error: 'x', durationMs: 1, ...extra })

  it('is true for an output size H.264 refuses — the input, not the run, has to change', () => {
    expect(isPermanentFailure(failed({ code: 'OUTPUT_SIZE_UNSUPPORTED' }))).toBe(true)
  })

  it('is false for a failure that carries no code, which may succeed on a retry', () => {
    expect(isPermanentFailure(failed())).toBe(false)
  })
})
