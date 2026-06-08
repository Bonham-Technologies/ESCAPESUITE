// apps/artist/src/headless/renderProject.ts
import { exportToMP4, exportToWebM } from '../core/exporter'
import { seedSources } from './seedSources'
import type { RenderInput, RenderResult } from './types'

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
 * Headless render entry. Seeds sources, then calls the SAME engine the editor
 * uses (identical arg order to ExportDialog), and returns base64 bytes + meta.
 */
export async function renderProject(
  input: RenderInput,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  const { project, sourceVideos, sourceBlobs, options } = input
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

  const durationSec = clips.reduce((max, c) => Math.max(max, (c.startTime ?? 0) + ((c.endTime ?? 0) - (c.startTime ?? 0))), 0)

  return {
    base64: await blobToBase64(blob),
    meta: {
      format,
      byteLength: blob.size,
      durationSec,
      width: resolution.width,
      height: resolution.height,
      gpu: false, // set by the runner based on launch flags (Plan 2)
    },
  }
}
