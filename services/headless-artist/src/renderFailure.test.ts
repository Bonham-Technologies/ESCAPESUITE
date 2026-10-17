import { describe, expect, it } from 'vitest'
import {
  AUDIO_CODEC_UNAVAILABLE,
  CodedRenderError,
  isPermanentFailure,
  OUTPUT_SIZE_UNSUPPORTED,
  SOURCE_NOT_SEEKABLE,
  unwrapPageRender,
} from './renderFailure'
import type { RenderMeta, RenderOutcome } from './types'

const META: RenderMeta = { format: 'mp4', byteLength: 5, durationSec: 1, width: 64, height: 48, gpu: false, audio: true }

const AAC_SENTENCE =
  'This Chromium has no AAC encoder, so an mp4 render would have no sound. Render webm, or set options.allowSilentMp4 to render the picture alone.'

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

  // ESCSUITE-312: the no-AAC refusal crosses the same boundary the same way.
  it('throws a coded error for the bundle\'s no-AAC refusal', () => {
    let thrown: unknown
    try {
      unwrapPageRender({ failure: { message: AAC_SENTENCE, code: AUDIO_CODEC_UNAVAILABLE } })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CodedRenderError)
    expect(thrown).toMatchObject({ message: AAC_SENTENCE, code: 'AUDIO_CODEC_UNAVAILABLE' })
  })
})

describe('isPermanentFailure', () => {
  const failed = (extra: Partial<RenderOutcome> = {}): RenderOutcome =>
    ({ jobId: 'job-1', ok: false, error: 'x', durationMs: 1, ...extra })

  it('is true for an output size H.264 refuses — the input, not the run, has to change', () => {
    expect(isPermanentFailure(failed({ code: 'OUTPUT_SIZE_UNSUPPORTED' }))).toBe(true)
  })

  // ESCSUITE-312: the image's Chromium will have no AAC encoder on every retry, so a sounded
  // mp4 job is the job's problem: render webm, or say `allowSilentMp4`.
  it('is true for a sounded mp4 refused for want of an AAC encoder', () => {
    expect(isPermanentFailure(failed({ code: 'AUDIO_CODEC_UNAVAILABLE' }))).toBe(true)
  })

  // ESCSUITE-305: a source whose seeks never complete in this browser fails the
  // same way on every retry; the job has to re-save the source or use another engine.
  it('is true for a source the browser cannot seek frame by frame', () => {
    expect(isPermanentFailure(failed({ code: SOURCE_NOT_SEEKABLE }))).toBe(true)
  })

  it('is false for a code it does not know', () => {
    expect(isPermanentFailure(failed({ code: 'SOMETHING_ELSE' }))).toBe(false)
  })

  it('is false for a failure that carries no code, which may succeed on a retry', () => {
    expect(isPermanentFailure(failed())).toBe(false)
  })
})
