import type { RenderFileInput, RenderMeta, RenderInput } from '../../../apps/artist/src/headless/types'

export type { RenderFileInput, RenderMeta, RenderInput }

export interface JobSpec {
  jobId: string
  input: { bundle: { path: string } } | { manifest: { path: string } }
  options: RenderFileInput['options']
  output: { sink: 'volume' | 's3' | 'webhook' | 'command'; config: Record<string, unknown> }
}

export interface RenderOutcome {
  jobId: string
  ok: boolean
  meta?: RenderMeta
  outputLocation?: string
  manifestLocation?: string
  error?: string
  /**
   * Set on a failure whose cause the bundle could name. Two codes, both permanent input errors
   * — exit 2 from `render`, 400 from `serve`: `OUTPUT_SIZE_UNSUPPORTED`, an output size the
   * H.264 encoder refuses (ESCSUITE-237), and `AUDIO_CODEC_UNAVAILABLE`, an mp4 job whose sources
   * carry an audio track, in a Chromium with no AAC encoder (ESCSUITE-312). Absent on every other outcome.
   */
  code?: string
  durationMs: number
}
