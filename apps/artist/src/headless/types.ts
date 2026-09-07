// apps/artist/src/headless/types.ts
import type { Project, SourceVideo, ExportOptions } from '../store/types'

/** Everything the headless renderer needs to produce a video, with no browser storage preloaded. */
export interface RenderInput {
  project: Project
  /** Source metadata exactly as the editor store holds it (state.sourceVideos). */
  sourceVideos: SourceVideo[]
  /** Raw bytes for each source, keyed by SourceVideo.id. Seeded into IndexedDB before render. */
  sourceBlobs: Record<string, ArrayBuffer>
  /** Export options. `resolution` defaults to 'project' when omitted. */
  options: Omit<ExportOptions, 'resolution'> & { resolution?: ExportOptions['resolution'] }
}

/** Describes the encoded OUTPUT (after resolution/timeRange options), for the verification manifest (Plan 2). */
export interface RenderMeta {
  format: 'mp4' | 'webm'
  byteLength: number
  /** Encoded duration in seconds — the timeRange length when one is given, else the full timeline. */
  durationSec: number
  /** Encoded frame size — honours options.resolution, not simply project.resolution. */
  width: number
  height: number
  gpu: boolean
}

export interface RenderResult {
  meta: RenderMeta
  /** base64 of the encoded video — transferred across the Chromium boundary. */
  base64: string
}
