import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RenderFileInput } from './types'

export interface LoadedJob {
  project: RenderFileInput['project']
  sourceVideos: RenderFileInput['sourceVideos']
  /** id → absolute local path handed to Playwright setInputFiles */
  sourceFiles: Record<string, string>
  /** Removes any temp files the loader created (bundle loader only). Safe to call twice. */
  cleanup(): Promise<void>
}

type Project = RenderFileInput['project']
type SourceVideoInput = RenderFileInput['sourceVideos'][number]

/** Extension (no dot, lowercase) → MIME type, for manifest sources that omit "mimeType". */
const EXTENSION_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
}

/** MIME type → extension (no dot), for naming bundle temp files. */
const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
}

// Base64 chars decoded per chunk. Must be a multiple of 4 so each slice decodes cleanly on its own.
const BASE64_CHUNK_CHARS = 4 * 1024 * 1024

// Safe as a file-name component: no path separators, no leading/trailing traversal.
const SAFE_FILE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Guards against a source id becoming an unsafe or path-traversing file name. */
function assertSafeFileId(id: unknown, context: string): asserts id is string {
  if (
    typeof id !== 'string' ||
    id === '.' ||
    id === '..' ||
    !SAFE_FILE_ID_RE.test(id)
  ) {
    throw new Error(`${context} id "${String(id)}" is not a safe file name`)
  }
}

/** The four fields a bundle video must carry as strings before anything is written to disk. */
const VEDITOR_VIDEO_FIELDS = ['id', 'name', 'mimeType', 'data'] as const

/**
 * Validates one `videos[i]` entry. Without this a malformed bundle reaches the write loop as
 * `undefined`s — a `null` entry crashes on the property read, and a missing `mimeType` or
 * `name` quietly produces a `.bin` temp file the editor cannot decode.
 */
function assertVeditorVideo(value: unknown, index: number): asserts value is VeditorVideo {
  if (!isRecord(value)) {
    throw new Error(`bundle video #${index} must be an object`)
  }
  for (const field of VEDITOR_VIDEO_FIELDS) {
    if (value[field] === undefined) {
      throw new Error(`bundle video #${index} is missing "${field}"`)
    }
    if (typeof value[field] !== 'string') {
      throw new Error(`bundle video #${index} field "${field}" must be a string`)
    }
  }
}

/** Two sources under one id means one silently shadows the other — always a mistake. */
function assertUniqueSourceId(id: string, seen: Set<string>): void {
  if (seen.has(id)) {
    throw new Error(`duplicate source id "${id}"`)
  }
  seen.add(id)
}

function extensionOf(name: string | undefined): string | undefined {
  if (!name) return undefined
  const ext = path.extname(name).slice(1).toLowerCase()
  return ext.length > 0 ? ext : undefined
}

/** Fails fast (before Chromium) when a media clip references a source id that isn't loaded. */
function validateClipReferences(project: Project, sourceIds: Set<string>): void {
  for (const clip of project.timeline.clips) {
    // Overlay clips (and any clip with no source, defensively) carry no source reference.
    if (clip.overlayType || !clip.sourceVideoId) continue
    if (!sourceIds.has(clip.sourceVideoId)) {
      throw new Error(`clip "${clip.id}" references unknown source "${clip.sourceVideoId}"`)
    }
  }
}

/**
 * Decodes a base64 string to `destPath` in chunks (never as one giant `Buffer.from(wholeString)`),
 * streaming each decoded chunk to disk via `pipeline` so a write failure (ENOSPC, EIO, an
 * unwritable destination, ...) rejects this promise instead of crashing the process.
 * `chunkChars` must stay a multiple of 4 so each slice decodes as a complete, independent base64
 * group.
 */
export async function writeBase64ToFile(
  base64: string,
  destPath: string,
  chunkChars: number = BASE64_CHUNK_CHARS,
): Promise<void> {
  if (!Number.isInteger(chunkChars) || chunkChars <= 0 || chunkChars % 4 !== 0) {
    throw new Error('chunkChars must be a positive multiple of 4')
  }

  async function* chunks(): AsyncGenerator<Buffer> {
    for (let offset = 0; offset < base64.length; offset += chunkChars) {
      yield Buffer.from(base64.slice(offset, offset + chunkChars), 'base64')
    }
  }

  await pipeline(Readable.from(chunks()), createWriteStream(destPath))
}

interface VeditorVideo {
  id: string
  name: string
  mimeType: string
  data: string
  thumbnail?: string
}

interface VeditorBundle {
  version: number
  project: Project
  videos: VeditorVideo[]
}

/**
 * Loads a `.veditor` bundle (the editor's own export format). The whole JSON file is parsed in
 * memory, but each video's base64 `data` is decoded and streamed to a temp file in chunks —
 * never as one giant `Buffer.from(wholeString)`. For large media, prefer `loadManifest`, which
 * references files on disk directly instead of round-tripping through base64.
 */
export async function loadBundle(bundlePath: string, tmpRoot: string = os.tmpdir()): Promise<LoadedJob> {
  let raw: string
  try {
    raw = await fs.readFile(bundlePath, 'utf8')
  } catch {
    throw new Error(`bundle "${bundlePath}" could not be read`)
  }

  let bundle: unknown
  try {
    bundle = JSON.parse(raw)
  } catch {
    throw new Error(`bundle "${bundlePath}" is not valid JSON`)
  }

  if (!isRecord(bundle)) {
    throw new Error(`bundle "${bundlePath}" must be a JSON object`)
  }

  if (bundle.version !== 1) {
    if (typeof bundle.version === 'number' && bundle.version > 1) {
      throw new Error(
        `bundle "${bundlePath}" has version ${bundle.version}, but this build only supports version 1`,
      )
    }
    throw new Error(`bundle "${bundlePath}" must declare "version": 1`)
  }

  const project = (bundle as unknown as VeditorBundle).project
  if (!isRecord(project)) {
    throw new Error(`bundle "${bundlePath}" is missing "project"`)
  }

  const videos = (bundle as unknown as VeditorBundle).videos
  if (!Array.isArray(videos)) {
    throw new Error(`bundle "${bundlePath}" is missing "videos"`)
  }

  const sourceIds = new Set<string>()
  videos.forEach((video: unknown, index: number) => {
    assertVeditorVideo(video, index)
    assertSafeFileId(video.id, 'bundle video')
    assertUniqueSourceId(video.id, sourceIds)
  })
  validateClipReferences(project, sourceIds)

  const dir = await fs.mkdtemp(path.join(tmpRoot, 'headless-artist-'))

  const sourceFiles: Record<string, string> = {}
  const sourceVideos: SourceVideoInput[] = []

  try {
    for (const video of videos) {
      // Every field was validated above, before mkdtemp — nothing here can be undefined.
      const ext = MIME_TO_EXTENSION[video.mimeType] ?? extensionOf(video.name) ?? 'bin'
      const destPath = path.join(dir, `${video.id}.${ext}`)
      await writeBase64ToFile(video.data, destPath)
      sourceFiles[video.id] = destPath
      sourceVideos.push({ id: video.id, name: video.name, mimeType: video.mimeType })
    }
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true })
    throw err
  }

  let cleaned = false
  return {
    project,
    sourceVideos,
    sourceFiles,
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

interface ManifestSource {
  id: string
  file: string
  mimeType?: string
  name?: string
  width?: number
  height?: number
  duration?: number
}

async function resolveProjectRef(
  projectField: unknown,
  manifestDir: string,
  manifestPath: string,
): Promise<Project> {
  if (!isRecord(projectField)) {
    throw new Error(`manifest "${manifestPath}" is missing "project"`)
  }

  if (typeof projectField.$ref !== 'string') {
    return projectField as unknown as Project
  }

  const refPath = path.resolve(manifestDir, projectField.$ref)
  let raw: string
  try {
    raw = await fs.readFile(refPath, 'utf8')
  } catch {
    throw new Error(`manifest "${manifestPath}" references missing project file "${refPath}"`)
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`project file "${refPath}" is not valid JSON`)
  }

  const project = isRecord(data) && isRecord(data.project) ? data.project : data
  if (!isRecord(project)) {
    throw new Error(`project file "${refPath}" does not contain a project object`)
  }
  return project as unknown as Project
}

/**
 * Loads a manifest referencing local files on disk (the recommended route for large media —
 * see README). Resolves `$ref`/`file` relative to the manifest's own directory, infers
 * `mimeType` from the file extension when the manifest omits it, and fails fast (before
 * Chromium launches) on a missing file, an unrecognised extension, a duplicate basename, or a
 * clip referencing an unknown source.
 */
export async function loadManifest(manifestPath: string): Promise<LoadedJob> {
  const manifestDir = path.dirname(manifestPath)

  let raw: string
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch {
    throw new Error(`manifest "${manifestPath}" could not be read`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(raw)
  } catch {
    throw new Error(`manifest "${manifestPath}" is not valid JSON`)
  }

  if (!isRecord(manifest)) {
    throw new Error(`manifest "${manifestPath}" must be a JSON object`)
  }

  const project = await resolveProjectRef(manifest.project, manifestDir, manifestPath)

  const sources = manifest.sources
  if (!Array.isArray(sources)) {
    throw new Error(`manifest "${manifestPath}" is missing "sources"`)
  }

  const sourceIds = new Set<string>()
  const sourceFiles: Record<string, string> = {}
  const sourceVideos: SourceVideoInput[] = []
  const seenBasenames = new Set<string>()

  for (const entry of sources as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.file !== 'string') {
      throw new Error(`manifest "${manifestPath}" has a source entry missing "id" or "file"`)
    }
    const source = entry as unknown as ManifestSource

    assertUniqueSourceId(source.id, sourceIds)

    const absolutePath = path.resolve(manifestDir, source.file)
    // stat, not access: a directory (or a fifo, or a socket) is readable but is not something
    // setInputFiles can stream, and the failure it produces later says nothing useful.
    let stats
    try {
      stats = await fs.stat(absolutePath)
    } catch {
      throw new Error(`manifest source "${source.id}" references missing file "${absolutePath}"`)
    }
    if (!stats.isFile()) {
      throw new Error(`source file "${absolutePath}" is not a regular file`)
    }

    const basename = path.basename(absolutePath)
    if (seenBasenames.has(basename)) {
      throw new Error(`manifest has duplicate source file name "${basename}"; file names must be unique per job`)
    }
    seenBasenames.add(basename)

    let mimeType = source.mimeType
    if (!mimeType) {
      const ext = extensionOf(source.file)
      mimeType = ext ? EXTENSION_TO_MIME[ext] : undefined
      if (!mimeType) {
        throw new Error(
          `could not infer a MIME type for "${source.file}"; add "mimeType" to its entry in the manifest`,
        )
      }
    }

    sourceFiles[source.id] = absolutePath

    const sourceVideo: SourceVideoInput = {
      id: source.id,
      name: source.name ?? path.basename(source.file),
      mimeType,
    }
    if (typeof source.width === 'number') sourceVideo.width = source.width
    if (typeof source.height === 'number') sourceVideo.height = source.height
    if (typeof source.duration === 'number') sourceVideo.duration = source.duration
    sourceVideos.push(sourceVideo)
  }

  validateClipReferences(project, sourceIds)

  return {
    project,
    sourceVideos,
    sourceFiles,
    // Manifest files are the customer's own; nothing was copied, so there's nothing to remove.
    async cleanup() {},
  }
}
