// apps/artist/src/headless/renderProject.ts
import { exportToGIF, exportToMP4, exportToWebM } from '../core/exporter'
import {
  calculateTimelineDuration,
  getBaseDimensions,
  getResolution,
  gifFrameDelayMs,
  gifFrameRate,
} from '../core/exportTypes'
import { parseProject } from '../store/projectMigration'
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
 * How long a GIF of `seconds` of timeline actually plays, which is not `seconds`:
 * the encoder writes `ceil(seconds x rate)` frames and gives each the same delay,
 * so the total is a whole number of those delays. Both rules come from the
 * exporter's own helpers rather than being derived a second time here — the frame
 * count mirrors `exportGIF.ts`, and `gifFrameDelayMs` owns the two roundings a
 * frame's on-screen time goes through on the way into the file (67 ms asked for at
 * 15 fps, 70 ms stored).
 */
function gifDurationSec(seconds: number, fps: number | undefined): number {
  return (Math.ceil(seconds * gifFrameRate(fps)) * gifFrameDelayMs(fps)) / 1000
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
  // `parseProject` is the editor's own door for an unvalidated project (a
  // dropped `.veditor`, a host `LOAD_PROJECT` payload) — shape checks (clip
  // ids, trackIds, resolution, crop, transform) BEFORE `ensureTimelineHasTracks`'s
  // migration, which is also what folds legacy overlay arrays into ordinary
  // clips, so a headless render includes them exactly as the editor does.
  // Before this, only `validateInput` below ran, which checks sources against
  // `project.timeline.clips` and nothing about the project's own shape — a
  // malformed `crop` reached `croppedSourceRect` as NaN and the clip silently
  // vanished from an unattended render instead of failing the job
  // (ESCSUITE-173).
  const parsed = parseProject(request.project)
  if (!parsed.ok) {
    throw new Error(`Invalid project: ${parsed.reason}`)
  }
  const project: Project = parsed.project
  validateInput({ ...request, project })
  const options: ExportOptions = { resolution: 'project', ...request.options }
  // The seeded list is the completed one (probed width/height/duration); the
  // engine and the meta below both need those fields.
  const sourceVideos = await seedSources(request.sourceVideos, request.sourceBlobs)

  const clips = project.timeline.clips
  const tracks = project.timeline.tracks
  // `ensureTimelineHasTracks`'s migration (inside `parseProject`) fills a
  // MISSING `resolution` in with 1920x1080 — the editor's own default, meant
  // for a human opening a blank project. The headless path never ran that
  // migration before this ticket, and a job spec without its own `resolution`
  // relied on `getResolution('project', …)`'s OTHER fallback instead: the
  // bottom-most media clip's own native size (documented in the kit's
  // README). Every other migration default below — `trackId`,
  // `timelinePosition`, `transform`, `effects`, `transition`, and
  // `timeline.duration` — is deliberately adopted here: a trackless headless
  // project rendered nothing at all before this ticket (`getClipsAtTime`
  // drops a clip whose `trackId` names no track) and now renders correctly.
  // `resolution` is the one exception, read from the RAW input rather than
  // the migrated `project`, so an absent one stays `undefined` all the way to
  // `getResolution` and the exporters, instead of silently becoming 1080p.
  const resolution =
    (request.project as Partial<Project>).resolution === undefined ? undefined : project.resolution
  // Clamp a requested range to the timeline BEFORE the exporter ever sees it: an
  // `end` past the timeline's own duration (or a `start` before 0) used to reach
  // the exporter and the manifest untouched, so a one-second project asked for
  // `{start: 0, end: 600}` encoded ~599 seconds of black and the signed manifest
  // agreed with the REQUEST rather than with the bytes (ESCSUITE-191 / hunt-j
  // J-9). `options.timeRange` is replaced in place with the clamped range, so
  // the exporter call below — unchanged — and the duration derived from it
  // after that call both read the clamped values, never the raw request. An
  // intersection that clamps to nothing (both bounds past the end, or both
  // before 0) is a field-naming failure rather than a render of zero frames.
  const fullDuration = calculateTimelineDuration(clips)
  if (options.timeRange) {
    const { start, end } = options.timeRange
    const clampedStart = Math.min(Math.max(start, 0), fullDuration)
    const clampedEnd = Math.min(Math.max(end, 0), fullDuration)
    if (!(clampedStart < clampedEnd)) {
      throw new Error(
        `options.timeRange {start: ${start}, end: ${end}} does not overlap the timeline (0s-${fullDuration}s)`,
      )
    }
    options.timeRange = { start: clampedStart, end: clampedEnd }
  }
  const progress = onProgress
    ? (ep: { progress: number }) => onProgress(ep.progress)
    : () => {}

  // One branch per format, in the same shape the export dialog uses. 'mp4' is
  // the fallback for an unrecognised value, which is what it has always been.
  const format: RenderMeta['format'] =
    options.format === 'webm' ? 'webm' : options.format === 'gif' ? 'gif' : 'mp4'
  // The exporters hand back `{ blob, audio }` since ESCSUITE-175; the kit's
  // manifest describes the bytes, so only the blob is read here.
  const { blob } = format === 'webm'
    ? await exportToWebM(clips, sourceVideos, options, progress, tracks, undefined, resolution)
    : format === 'gif'
      ? await exportToGIF(clips, sourceVideos, options, progress, tracks, undefined, resolution)
      : await exportToMP4(clips, sourceVideos, options, progress, tracks, undefined, resolution)

  // Describe the OUTPUT, not the project: honour the resolution option and timeRange
  // the same way the engine does, so the manifest (Plan 2) matches the bytes.
  const base = getBaseDimensions(clips, tracks, sourceVideos)
  const out = getResolution(options.resolution, base.width, base.height, resolution)
  // `options.timeRange`, if present, was already clamped to the timeline above —
  // this reads the clamped values, never the caller's raw request.
  const rangeStart = options.timeRange?.start ?? 0
  const rangeEnd = options.timeRange?.end ?? fullDuration
  // A GIF plays for as long as its frame delays say, and the format stores those
  // in centiseconds: `exportToGIF` encodes `ceil(seconds x rate)` frames, each
  // asked for at `round(1000 / rate)` ms and written as `round(that / 10)` cs, so
  // a 15 fps GIF of a one-second range is 15 frames of 70 ms — 1.05 s of GIF, not
  // 1. The manifest describes the bytes, so it reports those stored delays rather
  // than the requested range; the two video formats encode the range itself and
  // are unchanged. `gifFrameRate` and `gifFrameDelayMs` own the rate, its default
  // and the rounding, the same way the exporter and `gifenc` do.
  const rangeSeconds = rangeEnd - rangeStart
  const durationSec = format === 'gif'
    ? gifDurationSec(rangeSeconds, options.fps)
    : rangeSeconds

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
