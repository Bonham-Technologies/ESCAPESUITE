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
  options: Omit<ExportOptions, 'resolution'> & {
    resolution?: ExportOptions['resolution']
    /**
     * Render an mp4 of a project with sound even though this Chromium has no AAC
     * encoder, as the picture alone (ESCSUITE-312). Without it such a render is
     * refused with `AUDIO_CODEC_UNAVAILABLE`. A switch for the headless entry, not
     * an export option: it is never handed to the exporter.
     */
    allowSilentMp4?: boolean
  }
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
  /**
   * Whether the encoded file carries an audio track (ESCSUITE-312): the
   * exporter's own `ExportResult.audio`. `false` for every GIF, and for an mp4
   * rendered by a Chromium with no AAC encoder under `options.allowSilentMp4`.
   * Read it as "this file has no audio track", not "sound was lost": a silent
   * project rendered by such a Chromium is `false` too.
   */
  audio: boolean
  /**
   * The mix's ITU-R BS.1770-4 loudness as measured before any gain, and the gain
   * applied to reach `options.loudnessTarget` (ESCSUITE-292). Absent when the
   * render had no sound to measure: a GIF, a project with no audio, a mix too
   * quiet or too short to gate, or a browser that cannot encode the sound.
   */
  loudness?: RenderLoudness
}

/** The verification manifest's loudness record. */
export interface RenderLoudness {
  /** Integrated loudness of the mix as mixed, LUFS. */
  measuredLufs: number
  /** True peak of the mix as mixed, dBTP. */
  truePeakDbtp: number
  /** Gain applied, dB: 0 when no target was set. */
  gainDb: number
  /** The target normalised to, or null when none was set. */
  targetLufs: -14 | -16 | -23 | null
}

export interface RenderResult {
  meta: RenderMeta
  /** base64 of the encoded video — transferred across the Chromium boundary. */
  base64: string
}
