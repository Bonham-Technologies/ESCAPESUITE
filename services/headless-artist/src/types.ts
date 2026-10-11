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
   * Set on a failure whose cause the bundle could name (ESCSUITE-237). The one code today is
   * `OUTPUT_SIZE_UNSUPPORTED`: the output size is one the H.264 encoder refuses, a permanent
   * input error — exit 2 from `render`, 400 from `serve`. Absent on every other outcome.
   */
  code?: string
  durationMs: number
}
