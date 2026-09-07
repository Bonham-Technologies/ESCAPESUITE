// apps/artist/src/headless/types.ts
import type { Project, SourceVideo, ExportOptions } from '../store/types'

/**
 * Source metadata as a caller may supply it: identity is required, everything
 * else is probed from the bytes when missing.
 */
export type SourceVideoInput = Pick<SourceVideo, 'id' | 'name' | 'mimeType'> & Partial<SourceVideo>

/** Everything the headless renderer needs to produce a video, with no browser storage preloaded. */
export interface RenderInput {
  project: Project
  /** Source metadata exactly as the editor store holds it (state.sourceVideos). */
  sourceVideos: SourceVideo[]
  /** Raw bytes per source id. A Blob (e.g. a File) is stored as-is — no copy. */
  sourceBlobs: Record<string, ArrayBuffer | Blob>
  /** Export options. `resolution` defaults to 'project' when omitted. */
  options: Omit<ExportOptions, 'resolution'> & { resolution?: ExportOptions['resolution'] }
}

/** File-based variant used by the runner: sources come from the hidden <input type=file>. */
export interface RenderFileInput {
  project: Project
  /** Optional per-source metadata; missing width/height/duration/mediaType are probed from the bytes. */
  sourceVideos: SourceVideoInput[]
  /** Maps source id → file name as it appears in the input element's FileList. */
  sourceFiles: Record<string, string>
  options: RenderInput['options']
  /** Download file name (without extension); the runner passes the job id. */
  outputName: string
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
