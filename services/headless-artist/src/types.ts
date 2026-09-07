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
  durationMs: number
}
