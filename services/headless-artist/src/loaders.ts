import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
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
  'audio/webm': 'webm',
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

/** `SourceVideo['mediaType']` (`packages/shared/src/types`), spelled out since nothing here imports it. */
const MEDIA_TYPES = ['video', 'image', 'audio'] as const

/** The two dimension fields `meta` may carry — one check covers both. */
const META_DIMENSION_FIELDS = ['width', 'height'] as const

/** A width/height a `meta` can be trusted for: `projectManager.ts`'s `isUsableDimension` (ESCSUITE-97). */
function isUsableDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** A duration a `meta` can be trusted for: `videoProcessor.ts`'s `isUsableDuration`. */
function isUsableDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Validates an optional `meta` block — a bundle video's or a manifest source's — exactly the
 * same way, so a malformed one is rejected identically regardless of which loader it came
 * through. Fields it does not know about (e.g. `frameRate`, `thumbnailUrl`) are forwarded
 * unchecked, same as before this validation existed.
 */
function assertSourceMeta(value: unknown, context: string): asserts value is VeditorVideoMeta {
  if (!isRecord(value)) {
    throw new Error(`${context} field "meta" must be an object`)
  }
  if (value.mediaType !== undefined && !MEDIA_TYPES.includes(value.mediaType as (typeof MEDIA_TYPES)[number])) {
    throw new Error(`${context} field "meta.mediaType" must be one of ${MEDIA_TYPES.join(', ')}`)
  }
  for (const field of META_DIMENSION_FIELDS) {
    if (value[field] !== undefined && !isUsableDimension(value[field])) {
      throw new Error(`${context} field "meta.${field}" must be a finite number >= 0`)
    }
  }
  if (value.duration !== undefined && !isUsableDuration(value.duration)) {
    throw new Error(`${context} field "meta.duration" must be a finite positive number`)
  }
}

/** A v2 entry's string fields: `data` is a byte range there, not a base64 string. */
const VEDITOR_V2_VIDEO_FIELDS = ['id', 'name', 'mimeType'] as const

/**
 * Validates what a `videos[i]` entry of either version shares: an object, `fields` present as
 * strings, and an optional `meta`. Without this a malformed bundle reaches the write loop as
 * `undefined`s. A `null` entry crashes on the property read, and a missing `mimeType` or `name`
 * quietly produces a `.bin` temp file the editor cannot decode.
 */
function assertVeditorEntry(
  value: unknown,
  index: number,
  fields: readonly string[],
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`bundle video #${index} must be an object`)
  }
  for (const field of fields) {
    if (value[field] === undefined) {
      throw new Error(`bundle video #${index} is missing "${field}"`)
    }
    if (typeof value[field] !== 'string') {
      throw new Error(`bundle video #${index} field "${field}" must be a string`)
    }
  }
  if (value.meta !== undefined) {
    assertSourceMeta(value.meta, `bundle video #${index}`)
  }
}

/** One version 1 entry: `data` (and `thumbnail`, which the kit ignores) are base64 strings. */
function assertVeditorVideo(value: unknown, index: number): asserts value is VeditorVideo {
  assertVeditorEntry(value, index, VEDITOR_VIDEO_FIELDS)
}

/** A non-negative whole number JavaScript holds exactly. */
function isByteCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function assertByteRange(value: unknown, context: string): asserts value is ByteRange {
  if (!isRecord(value) || !isByteCount(value.offset) || !isByteCount(value.length)) {
    throw new Error(`${context} must be {"offset", "length"}, each a whole number of bytes >= 0`)
  }
}

/** One version 2 entry: `data` and the optional `thumbnail` are ranges of the payload. */
function assertVeditorVideoV2(value: unknown, index: number): asserts value is VeditorVideoV2 {
  assertVeditorEntry(value, index, VEDITOR_V2_VIDEO_FIELDS)
  assertByteRange(value.data, `bundle video #${index} field "data"`)
  if (value.thumbnail !== undefined) {
    assertByteRange(value.thumbnail, `bundle video #${index} field "thumbnail"`)
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

/** Fails fast (before Chromium) when a project has no `timeline` at all, or one whose `clips`
 * is not an array -- naming the field rather than letting the walk below leak a bare
 * `Cannot read properties of undefined (reading 'clips')`. */
function assertTimelineShape(project: Project): void {
  const timeline = (project as { timeline?: unknown }).timeline
  if (!isRecord(timeline) || !Array.isArray((timeline as { clips?: unknown }).clips)) {
    throw new Error('project.timeline must be an object with an array "clips"')
  }
}

/** Fails fast (before Chromium) when a media clip references a source id that isn't loaded. */
function validateClipReferences(project: Project, sourceIds: Set<string>): void {
  assertTimelineShape(project)
  project.timeline.clips.forEach((clip, index) => {
    // ESCSUITE-294: a null clip leaked a bare TypeError from the property read below.
    if (!isRecord(clip)) {
      throw new Error(`project.timeline.clips[${index}] must be an object`)
    }
    // Overlay clips (and any clip with no source, defensively) carry no source reference.
    if (clip.overlayType || !clip.sourceVideoId) return
    if (!sourceIds.has(clip.sourceVideoId)) {
      throw new Error(`clip "${clip.id}" references unknown source "${clip.sourceVideoId}"`)
    }
  })
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

/**
 * The `SourceVideo` fields a bundle video's optional `meta` may carry — `projectManager.ts`'s
 * `SourceVideoMeta` (ESCSUITE-97), as the kit sees it through `SourceVideoInput`: everything but
 * the three the entry already states at its own top level.
 */
type VeditorVideoMeta = Omit<SourceVideoInput, 'id' | 'name' | 'mimeType'>

interface VeditorVideo {
  id: string
  name: string
  mimeType: string
  data: string
  thumbnail?: string
  /**
   * The live `SourceVideo`'s own fields, exactly as `saveProject` writes them. Notably
   * `mediaType`: an ESCAPECRAFT audio-only take (mic alone, screen and webcam both off) is
   * typed `video/webm;codecs=vp9,opus` even though it has no picture in it, and `meta.mediaType`
   * is the only thing that says it is audio (ESCSUITE-150). Without forwarding it, `seedSources`
   * re-derives `mediaType` from the MIME type alone, sees `video/`, and both exporters build a
   * frame source over a file with nothing to show — disagreeing with the editor, which trusts
   * `meta` on the same file.
   */
  meta?: VeditorVideoMeta
}

/**
 * The v2 `.veditor` container (ESCSUITE-260): 16 header bytes (this magic, then the container
 * version and the index length as little-endian u32s), the UTF-8 JSON index, then every source's
 * (and thumbnail's) raw bytes back to back, in index order, with offsets counted from the
 * payload's first byte. Spelled out here rather than imported from apps/artist. Nothing in this
 * package imports the apps, the same reason the validators above are copies. Both packages'
 * tests pin the same header bytes literally, so the two readers cannot drift apart unnoticed.
 */
const V2_MAGIC = Buffer.from([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
const V2_HEADER_BYTES = 16
const V2_VERSION = 2
/** ESCAPEARTIST's `MAX_INDEX_BYTES`: a corrupt header must not make the loader read gigabytes as text. */
const V2_MAX_INDEX_BYTES = 64 * 1024 * 1024

interface ByteRange {
  offset: number
  length: number
}

/** What both versions' entries share once validated. */
interface VeditorEntry {
  id: string
  name: string
  mimeType: string
  meta?: VeditorVideoMeta
}

interface VeditorVideoV2 extends VeditorEntry {
  data: ByteRange
  thumbnail?: ByteRange
}

/** Up to `length` bytes of the file from `position`; fewer only at the end of the file. */
async function readBytes(filePath: string, position: number, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** The project and the entries list both versions carry, before the entries are validated. */
function readBundleBody(
  bundle: Record<string, unknown>,
  bundlePath: string,
): { project: Project; videos: unknown[] } {
  if (!isRecord(bundle.project)) {
    throw new Error(`bundle "${bundlePath}" is missing "project"`)
  }
  if (!Array.isArray(bundle.videos)) {
    throw new Error(`bundle "${bundlePath}" is missing "videos"`)
  }
  return { project: bundle.project as unknown as Project, videos: bundle.videos }
}

/** Each entry valid, its id a safe and unique file name, every clip's source present. Before mkdtemp. */
function checkVideos<V extends VeditorEntry>(
  videos: unknown[],
  project: Project,
  assertVideo: (value: unknown, index: number) => asserts value is V,
): V[] {
  const sourceIds = new Set<string>()
  videos.forEach((video, index) => {
    assertVideo(video, index)
    assertSafeFileId(video.id, 'bundle video')
    assertUniqueSourceId(video.id, sourceIds)
  })
  validateClipReferences(project, sourceIds)
  return videos as V[]
}

/**
 * Writes each source to a temp file through `writeSource`, and builds the job. The temp
 * directory is removed if any write fails.
 */
async function materialiseSources<V extends VeditorEntry>(
  project: Project,
  videos: V[],
  tmpRoot: string,
  writeSource: (video: V, destPath: string) => Promise<void>,
): Promise<LoadedJob> {
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'headless-artist-'))

  const sourceFiles: Record<string, string> = {}
  const sourceVideos: SourceVideoInput[] = []

  try {
    for (const video of videos) {
      // Every field was validated before mkdtemp, so nothing here can be undefined.
      // Strip a `;codecs=...` parameter before the lookup, so "video/webm;codecs=vp9,opus"
      // still resolves to "webm" rather than falling through to the name or ".bin", and
      // lower-case it first so "Video/WebM" does too.
      const mimeBase = video.mimeType.split(';')[0].trim().toLowerCase()
      const ext = MIME_TO_EXTENSION[mimeBase] ?? extensionOf(video.name) ?? 'bin'
      const destPath = path.join(dir, `${video.id}.${ext}`)
      await writeSource(video, destPath)
      sourceFiles[video.id] = destPath
      // `meta` first, so the entry's own id/name/mimeType (the source of truth) always win,
      // the same order `projectManager.ts`'s `loadProject` applies to the identical `meta`.
      sourceVideos.push({ ...video.meta, id: video.id, name: video.name, mimeType: video.mimeType })
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

/**
 * The entries' ranges, in order (each source, then its thumbnail), must tile the payload
 * exactly: no gap, no overlap, nothing missing, nothing after the last source. A thumbnail is
 * checked here and never copied; the engine does not use it.
 */
function assertRangesTile(videos: VeditorVideoV2[], payloadBytes: number, bundlePath: string): void {
  let expected = 0
  videos.forEach((video, index) => {
    const ranges: Array<[string, ByteRange]> = [['data', video.data]]
    if (video.thumbnail) ranges.push(['thumbnail', video.thumbnail])
    for (const [field, range] of ranges) {
      if (range.offset !== expected) {
        throw new Error(
          `bundle "${bundlePath}" video #${index} field "${field}" starts at byte ${range.offset} of the media, expected ${expected}`,
        )
      }
      expected += range.length
    }
  })
  if (expected > payloadBytes) {
    throw new Error(`bundle "${bundlePath}" is truncated: it declares ${expected} bytes of media but holds ${payloadBytes}`)
  }
  if (expected < payloadBytes) {
    throw new Error(`bundle "${bundlePath}" has ${payloadBytes - expected} bytes after its last source`)
  }
}

/**
 * Copies source `id`'s `length` bytes from `start` to `destPath`. A ranged read stream, not a
 * buffer: the source never has to fit in memory. A zero-length range writes an empty file,
 * because `createReadStream` rejects `end < start`. A ranged read stops quietly at the end of the
 * file, so a bundle cut short after `loadBundle`'s stat would otherwise yield a short source: the
 * copy is measured and refused by name instead.
 */
async function copyRange(
  bundlePath: string,
  id: string,
  start: number,
  length: number,
  destPath: string,
): Promise<void> {
  if (length === 0) {
    await fs.writeFile(destPath, '')
    return
  }
  await pipeline(createReadStream(bundlePath, { start, end: start + length - 1 }), createWriteStream(destPath))
  const copied = (await fs.stat(destPath)).size
  if (copied < length) {
    throw new Error(`bundle "${bundlePath}" source "${id}" ended early: expected ${length} bytes, copied ${copied}`)
  }
}

/**
 * A version 1 bundle: one JSON document with each source base64-encoded inside it. The whole
 * document is parsed in memory, but each source's base64 is decoded and streamed to a temp file
 * in chunks, never as one giant `Buffer.from(wholeString)`.
 */
async function loadBundleV1(bundlePath: string, tmpRoot: string): Promise<LoadedJob> {
  // `loadBundle` has already read this file's first bytes, so a read failure here is a race,
  // not a case to name.
  const raw = await fs.readFile(bundlePath, 'utf8')

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
        `bundle "${bundlePath}" has version ${bundle.version}, but this build supports versions 1 and 2 (version 2 is the binary container, not JSON)`,
      )
    }
    throw new Error(`bundle "${bundlePath}" must declare "version": 1`)
  }

  const { project, videos: entries } = readBundleBody(bundle, bundlePath)
  const videos = checkVideos(entries, project, assertVeditorVideo)
  return materialiseSources(project, videos, tmpRoot, (video, destPath) => writeBase64ToFile(video.data, destPath))
}

/**
 * A version 2 bundle (ESCSUITE-260). Only the header and the index are read into memory. The
 * ranges are checked to tile the payload before any temp file exists, then each source is copied
 * with a ranged read, so a bundle of any size needs no more heap than a manifest does.
 */
async function loadBundleV2(bundlePath: string, head: Buffer, size: number, tmpRoot: string): Promise<LoadedJob> {
  const version = head.readUInt32LE(8)
  if (version !== V2_VERSION) {
    throw new Error(
      version > V2_VERSION
        ? `bundle "${bundlePath}" has version ${version}, but this build supports versions 1 and 2`
        : `bundle "${bundlePath}" has a binary header naming version ${version}, which no ESCAPEARTIST writes`,
    )
  }
  const indexLength = head.readUInt32LE(12)
  if (indexLength > V2_MAX_INDEX_BYTES) {
    throw new Error(
      `bundle "${bundlePath}" declares a ${indexLength}-byte index, over the ${V2_MAX_INDEX_BYTES}-byte limit`,
    )
  }
  const payloadStart = V2_HEADER_BYTES + indexLength
  if (payloadStart > size) {
    throw new Error(`bundle "${bundlePath}" ends before its index does`)
  }

  const raw = await readBytes(bundlePath, V2_HEADER_BYTES, indexLength)
  let index: unknown
  try {
    index = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error(`bundle "${bundlePath}" has an index that is not valid JSON`)
  }
  if (!isRecord(index) || index.version !== V2_VERSION) {
    throw new Error(`bundle "${bundlePath}" has an index that does not declare "version": 2`)
  }

  const { project, videos: entries } = readBundleBody(index, bundlePath)
  const videos = checkVideos(entries, project, assertVeditorVideoV2)
  assertRangesTile(videos, size - payloadStart, bundlePath)
  return materialiseSources(project, videos, tmpRoot, (video, destPath) =>
    copyRange(bundlePath, video.id, payloadStart + video.data.offset, video.data.length, destPath),
  )
}

/**
 * Loads a `.veditor` bundle, the editor's own save format, of either version. The first bytes
 * decide: a file opening with the v2 magic takes the ranged path (and is refused if it ends before
 * its 16-byte header does), and anything else is read as version 1 JSON. For
 * large media saved by an older editor (version 1), prefer `loadManifest`, or open the project in
 * a current ESCAPEARTIST and save it again.
 */
export async function loadBundle(bundlePath: string, tmpRoot: string = os.tmpdir()): Promise<LoadedJob> {
  let size: number
  let head: Buffer
  try {
    size = (await fs.stat(bundlePath)).size
    head = await readBytes(bundlePath, 0, V2_HEADER_BYTES)
  } catch {
    throw new Error(`bundle "${bundlePath}" could not be read`)
  }

  // The magic alone decides the version: a file that opens with it but stops short of a whole
  // header is a broken version 2 file, not a version 1 file that happens to fail to parse.
  if (head.subarray(0, V2_MAGIC.length).equals(V2_MAGIC)) {
    if (head.length < V2_HEADER_BYTES) {
      throw new Error(`bundle "${bundlePath}" ends before its header does`)
    }
    return loadBundleV2(bundlePath, head, size, tmpRoot)
  }
  return loadBundleV1(bundlePath, tmpRoot)
}

interface ManifestSource {
  id: string
  file: string
  mimeType?: string
  name?: string
  width?: number
  height?: number
  duration?: number
  /**
   * Mirrors a bundle video's optional `meta` (ESCSUITE-158): `mediaType`, and `width`/
   * `height`/`duration` as an alternative to the top-level fields above. Validated by the same
   * `assertSourceMeta` and forwarded the same way — spread onto the built `SourceVideoInput`
   * ahead of the top-level fields, so an explicit `width`/`height`/`duration` here still wins
   * when both are given.
   */
  meta?: VeditorVideoMeta
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
    // Both optional (the file's basename and extension stand in, for null as for absent), but
    // one that is present must be a usable string, as a bundle entry's are (ESCSUITE-294).
    for (const field of ['name', 'mimeType'] as const) {
      const value = entry[field]
      if (value != null && (typeof value !== 'string' || value.length === 0)) {
        throw new Error(`manifest source "${source.id}" field "${field}" must be a non-empty string`)
      }
    }
    if (source.meta !== undefined) {
      assertSourceMeta(source.meta, `manifest source "${source.id}"`)
    }

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

    // "meta" first so the entry's own top-level width/height/duration -- more specific,
    // and there since before "meta" existed -- always win, the same order loadBundle applies
    // to its identical "meta".
    const sourceVideo: SourceVideoInput = {
      ...source.meta,
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
