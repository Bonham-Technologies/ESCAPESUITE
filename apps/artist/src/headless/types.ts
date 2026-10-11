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
  format: 'mp4' | 'webm' | 'gif'
  byteLength: number
  /**
   * Encoded VIDEO length in seconds: the frames the exporter encoded times one
   * frame period (1/30 s for MP4 and WebM, the stored delay for a GIF) — not the
   * timeRange it was asked for (ESCSUITE-238). It matches the file's video
   * stream to within a millisecond. The container (`format.duration`) of an MP4
   * or WebM with sound runs a few milliseconds longer, because the last AAC or
   * Opus frame is padded past the last video frame, so a consumer compares this
   * with the video stream, not the container.
   */
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
