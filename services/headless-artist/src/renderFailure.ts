import type { RenderMeta, RenderOutcome } from './types'

/**
 * The bundle's `ExportError.code` for an output size the H.264 encoder refuses in a browser
 * that encodes H.264 at 1280x720 (ESCSUITE-237): 64x8, 2x2, 3840x2 — sizes the job spec is
 * free to ask for, and that will be refused identically every time it is retried.
 */
export const OUTPUT_SIZE_UNSUPPORTED = 'OUTPUT_SIZE_UNSUPPORTED'

/**
 * The bundle's `ExportError.code` for an mp4 job whose sources carry an audio track, in a Chromium with
 * no AAC encoder (ESCSUITE-312) — Linux Chromium, the reference image's. Retrying on the same
 * image fails identically: the job has to render webm, or set `options.allowSilentMp4`.
 */
export const AUDIO_CODEC_UNAVAILABLE = 'AUDIO_CODEC_UNAVAILABLE'

/** Every code that names a failure of the job's input rather than of this run. */
const PERMANENT_CODES: ReadonlySet<string> = new Set([OUTPUT_SIZE_UNSUPPORTED, AUDIO_CODEC_UNAVAILABLE])

/**
 * What the in-page render hands back across the Playwright evaluate boundary. Playwright
 * carries a rejected in-page error's message across and nothing else — not its `code` — so a
 * coded failure is returned as data instead, and turned back into an error on this side.
 */
export type PageRenderResult =
  | { meta: RenderMeta }
  | { failure: { message: string; code: string } }

/** A render failure the bundle reported with a machine-readable cause. */
export class CodedRenderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'CodedRenderError'
  }
}

/** The meta of a render that finished, or the coded failure the page reported, thrown. */
export function unwrapPageRender(result: PageRenderResult): RenderMeta {
  if ('failure' in result) throw new CodedRenderError(result.failure.message, result.failure.code)
  return result.meta
}

/**
 * Whether a failed job failed because of its input — retrying it identically will fail
 * identically — rather than because of this run. The CLI exits 2 for one, as it does for a
 * job-spec error, and `serve` answers 400; every other failure stays exit 1 / a 200 `ok: false`.
 */
export function isPermanentFailure(outcome: RenderOutcome): boolean {
  return outcome.code !== undefined && PERMANENT_CODES.has(outcome.code)
}
