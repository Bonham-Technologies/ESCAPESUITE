// apps/artist/src/headless/renderProject.ts
import { exportToMP4, exportToWebM } from '../core/exporter'
import { calculateTimelineDuration, getBaseDimensions, getResolution } from '../core/exportTypes'
import { seedSources } from './seedSources'
import type { RenderFileInput, RenderInput, RenderMeta, RenderResult, SourceVideoInput } from './types'
import type { ExportOptions, Project } from '../store/types'

/** The id of the hidden file input the runner streams sources through. */
const SOURCE_INPUT_ID = '__sources'

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** The shape both entry points reduce to before rendering. */
interface RenderRequest {
  project: Project
  sourceVideos: SourceVideoInput[]
  sourceBlobs: Record<string, ArrayBuffer | Blob>
  options: RenderInput['options']
}

/**
 * Fail loudly on inconsistent input. The export engine silently skips clips
 * whose source is unknown (rendering black), which is acceptable interactively
 * but not for an unattended render — a missing source must be an error.
 */
function validateInput(request: RenderRequest): void {
  const { project, sourceVideos, sourceBlobs } = request
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
 * The one render path: validate, seed, run the SAME engine the editor uses
 * (identical arg order to ExportDialog), and describe the encoded output.
 * Both entry points differ only in how bytes arrive and how they leave.
 *
 * `options.resolution` defaults to 'project' — a render request always carries
 * the project resolution, so that is the natural target when the caller is silent.
 */
async function render(
  request: RenderRequest,
  onProgress?: (p: number) => void,
): Promise<{ blob: Blob; meta: RenderMeta }> {
  validateInput(request)
  const { project } = request
  const options: ExportOptions = { resolution: 'project', ...request.options }
  // The seeded list is the completed one (probed width/height/duration); the
  // engine and the meta below both need those fields.
  const sourceVideos = await seedSources(request.sourceVideos, request.sourceBlobs)

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
    blob,
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

/**
 * Headless render entry for small jobs: returns the encoded bytes as base64,
 * transferred back across the Chromium boundary.
 */
export async function renderProject(
  input: RenderInput,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  const { blob, meta } = await render(input, onProgress)
  return { base64: await blobToBase64(blob), meta }
}

/** Pick each source's File out of the hidden input's FileList, by exact name. */
function resolveSourceFiles(sourceFiles: Record<string, string>): Record<string, Blob> {
  const element = document.getElementById(SOURCE_INPUT_ID)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`No file input "#${SOURCE_INPUT_ID}" on the page — sources cannot be streamed in`)
  }
  const files = Array.from(element.files ?? [])
  const resolved: Record<string, Blob> = {}
  for (const [id, name] of Object.entries(sourceFiles)) {
    const matches = files.filter((file) => file.name === name)
    if (matches.length === 0) {
      const available = files.map((f) => f.name).join(', ') || '(none)'
      throw new Error(`Source "${id}": no file named "${name}" in #${SOURCE_INPUT_ID} — has ${available}`)
    }
    if (matches.length > 1) {
      throw new Error(`Source "${id}": more than one file named "${name}" in #${SOURCE_INPUT_ID} — names must be unique`)
    }
    resolved[id] = matches[0]
  }
  return resolved
}

/** Hand the bytes to the browser's download machinery, where Playwright collects them. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  // The click has handed the URL to the download machinery, which no longer needs the
  // element; taking it straight back out keeps the page as we found it.
  anchor.remove()
  // The object URL is deliberately never revoked: Chromium reads the Blob for as long as the download
  // runs, and a render can outlast any timer we would pick — revoking early truncates
  // the file. One page renders one job and the runner closes the browser context
  // straight after, which frees the Blob with the whole document.
}

/**
 * Streaming render entry: sources arrive as Files in the hidden input (set by
 * the runner) and the result leaves as a browser download, so neither the bytes
 * in nor the bytes out cross the Chromium evaluate boundary.
 *
 * Resolves with the output meta once the download has been triggered.
 */
export async function renderProjectToFile(
  input: RenderFileInput,
  onProgress?: (p: number) => void,
): Promise<RenderMeta> {
  const sourceBlobs = resolveSourceFiles(input.sourceFiles)
  const { blob, meta } = await render(
    { project: input.project, sourceVideos: input.sourceVideos, sourceBlobs, options: input.options },
    onProgress,
  )
  downloadBlob(blob, `${input.outputName}.${meta.format}`)
  return meta
}
