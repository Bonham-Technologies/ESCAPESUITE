// apps/artist/src/headless/renderProject.ts
import { exportToMP4, exportToWebM } from '../core/exporter'
import { calculateTimelineDuration, getBaseDimensions, getResolution } from '../core/exportTypes'
import { seedSources } from './seedSources'
import type { RenderInput, RenderResult } from './types'
import type { ExportOptions } from '../store/types'

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Fail loudly on inconsistent input. The export engine silently skips clips
 * whose source is unknown (rendering black), which is acceptable interactively
 * but not for an unattended render — a missing source must be an error.
 */
function validateInput(input: RenderInput): void {
  const { project, sourceVideos, sourceBlobs } = input
  const known = new Set(sourceVideos.map((s) => s.id))
  for (const clip of project.timeline.clips) {
    if (clip.overlayType || !clip.sourceVideoId) continue
    if (!known.has(clip.sourceVideoId)) {
      throw new Error(`Clip "${clip.id}" references unknown source "${clip.sourceVideoId}" (not in sourceVideos)`)
    }
    if (!(clip.sourceVideoId in sourceBlobs)) {
      throw new Error(`Clip "${clip.id}" references source "${clip.sourceVideoId}" with no bytes in sourceBlobs`)
    }
  }
}

/**
 * Headless render entry. Seeds sources, then calls the SAME engine the editor
 * uses (identical arg order to ExportDialog), and returns base64 bytes + meta.
 *
 * `options.resolution` defaults to 'project' — a RenderInput always carries the
 * project resolution, so that is the natural target when the caller is silent.
 */
export async function renderProject(
  input: RenderInput,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  validateInput(input)
  const { project, sourceVideos, sourceBlobs } = input
  const options: ExportOptions = { resolution: 'project', ...input.options }
  await seedSources(sourceVideos, sourceBlobs)

  const clips = project.timeline.clips
  const tracks = project.timeline.tracks
  const resolution = project.resolution
  const progress = onProgress
    ? (ep: { progress: number }) => onProgress(ep.progress)
    : () => {}

  const format = options.format === 'webm' ? 'webm' : 'mp4'
  const blob = format === 'webm'
    ? await exportToWebM(clips, sourceVideos, options, progress, tracks, undefined, resolution)
    : await exportToMP4(clips, sourceVideos, options, progress, tracks, undefined, resolution)

  // Describe the OUTPUT, not the project: honour the resolution option and timeRange
  // the same way the engine does, so the manifest (Plan 2) matches the bytes.
  const base = getBaseDimensions(clips, tracks, sourceVideos)
  const out = getResolution(options.resolution, base.width, base.height, resolution)
  const fullDuration = calculateTimelineDuration(clips)
  const rangeStart = options.timeRange?.start ?? 0
  const rangeEnd = options.timeRange?.end ?? fullDuration
  const durationSec = rangeEnd - rangeStart

  return {
    base64: await blobToBase64(blob),
    meta: {
      format,
      byteLength: blob.size,
      durationSec,
      width: out.width,
      height: out.height,
      gpu: false, // set by the runner based on launch flags (Plan 2)
    },
  }
}
