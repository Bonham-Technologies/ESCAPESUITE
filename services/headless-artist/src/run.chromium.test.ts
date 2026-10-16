import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { loadBundle } from './loaders'
import { runJob } from './run'
import type { JobSpec } from './types'
import { hasFfmpeg, integratedLoudness, probe, writePinkNoiseWav } from '../test/ffprobe'
import { assembleV2, v2IndexAndPayload } from '../test/veditorV2'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const MANIFEST = path.join(SERVICE_ROOT, 'test/fixtures/manifest/manifest.json')

/** Long enough for a Chromium launch plus a real (tiny) encode on a cold machine. */
const RENDER_TIMEOUT_MS = 180_000

const VERSIONS = { engineVersion: 'engine-test', kitVersion: 'kit-test' }

/** Silences the driver's own progress/launch chatter; the assertions cover behaviour, not logs. */
const quiet = () => {}

/** The rate both video exporters encode at (`VIDEO_EXPORT_FRAME_RATE` in the artist bundle). */
const VIDEO_FPS = 30

/**
 * The frame-count cross-check needs `ffprobe`, which the CI `e2e` job's runner is not
 * guaranteed to have: the case asserts the integer-frames property unconditionally and
 * asks `ffprobe` only when it is there, saying so when it is not.
 */
const FFPROBE = hasFfmpeg()
if (!FFPROBE) {
  console.warn(
    '[run.chromium.test] ffprobe not on PATH: the encoded-duration case checks whole frames only, not the file',
  )
}

let tmpRoot: string
let workDir: string
let outDir: string

// The headless bundle is built once for the whole chromium suite by test/globalSetup.ts.
beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-run-e2e-'))
  workDir = path.join(tmpRoot, 'work')
  outDir = path.join(tmpRoot, 'out')
  await fs.mkdir(workDir, { recursive: true })
})

afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

function makeSpec(jobId: string, manifestPath = MANIFEST): JobSpec {
  return {
    jobId,
    input: { manifest: { path: manifestPath } },
    options: { format: 'mp4', quality: 'medium' },
    output: { sink: 'volume', config: { dir: outDir } },
  }
}


/**
 * Decodes the first frame of a GIF to colour indices (global or local palette, the index is
 * all the bounding box needs). Only what gifenc emits: no interlacing, no transparency tricks.
 */
function firstGifFrame(bytes: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const width = bytes.readUInt16LE(6)
  const height = bytes.readUInt16LE(8)
  let pos = 13
  if (bytes[10] & 0x80) pos += 3 * (1 << ((bytes[10] & 7) + 1))
  const skipBlocks = () => {
    while (bytes[pos] !== 0) pos += bytes[pos] + 1
    pos += 1
  }
  while (bytes[pos] !== 0x2c) {
    // 0x21 is an extension: a label byte, then sub-blocks.
    if (bytes[pos] !== 0x21) throw new Error(`unexpected GIF block 0x${bytes[pos].toString(16)}`)
    pos += 2
    skipBlocks()
  }
  pos += 1
  const packed = bytes[pos + 8]
  pos += 9
  if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1))
  const minCode = bytes[pos++]
  const data: number[] = []
  while (bytes[pos] !== 0) {
    for (let i = 1; i <= bytes[pos]; i++) data.push(bytes[pos + i])
    pos += bytes[pos] + 1
  }
  const clear = 1 << minCode
  const end = clear + 1
  const out = new Uint8Array(width * height)
  let outPos = 0
  let table: number[][] = []
  const reset = () => {
    table = []
    for (let i = 0; i < clear; i++) table.push([i])
    table.push([], [])
  }
  reset()
  let size = minCode + 1
  let bitBuf = 0
  let bitCount = 0
  let previous: number[] | null = null
  for (const byte of data) {
    bitBuf |= byte << bitCount
    bitCount += 8
    while (bitCount >= size) {
      const code = bitBuf & ((1 << size) - 1)
      bitBuf >>= size
      bitCount -= size
      if (code === clear) {
        reset()
        size = minCode + 1
        previous = null
        continue
      }
      if (code === end) return { width, height, pixels: out }
      const entry: number[] | undefined = table[code] ?? (previous ? [...previous, previous[0]] : undefined)
      if (!entry) throw new Error('corrupt GIF stream')
      for (const index of entry) if (outPos < out.length) out[outPos++] = index
      if (previous && table.length < 4096) table.push([...previous, entry[0]])
      if (table.length === 1 << size && size < 12) size++
      previous = entry
    }
  }
  return { width, height, pixels: out }
}

/** The extent of everything that is not the background colour, taken from the corner pixel. */
function ink(frame: { width: number; height: number; pixels: Uint8Array }) {
  const background = frame.pixels[0]
  let minX = frame.width
  let maxX = -1
  let minY = frame.height
  let maxY = -1
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.pixels[y * frame.width + x] === background) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 }
}

describe('runJob (real Chromium)', () => {
  it('renders a manifest job and delivers it through the volume sink', async () => {
    const progress: number[] = []

    const outcome = await runJob(makeSpec('e2e-1'), {
      bundlePath: BUNDLE,
      workDir,
      versions: VERSIONS,
      onProgress: (p) => progress.push(p),
      log: quiet,
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    expect(outcome.jobId).toBe('e2e-1')
    expect(outcome.durationMs).toBeGreaterThan(0)
    expect(outcome.meta).toMatchObject({ format: 'mp4', width: 64, height: 48, gpu: false })
    expect(progress.length).toBeGreaterThanOrEqual(1)

    const outputPath = path.join(outDir, 'e2e-1.mp4')
    expect(outcome.outputLocation).toBe(outputPath)
    const bytes = await fs.readFile(outputPath)
    // Every ISO-BMFF file starts with an ftyp box within its first 12 bytes.
    expect(bytes.subarray(0, 12).toString('latin1')).toContain('ftyp')

    const manifestPath = path.join(outDir, 'e2e-1.manifest.json')
    expect(outcome.manifestLocation).toBe(manifestPath)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    expect(manifest.jobId).toBe('e2e-1')
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.byteLength).toBe(bytes.byteLength)
    expect(manifest.chromiumVersion.length).toBeGreaterThan(0)
    expect(manifest.engineVersion).toBe('engine-test')
    expect(manifest.kitVersion).toBe('kit-test')

    // The scratch dir this job rendered into is gone.
    expect(await fs.readdir(workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)

  // ESCSUITE-260: the same project from a v1 JSON bundle and from a v2 container renders alike.
  // The v2 bundle is built here over test/fixtures/manifest/src-0.mp4, exactly the bytes the v1
  // fixture embeds, so the media is identical and only the container differs.
  it('renders the same project from a v1 and a v2 .veditor bundle alike', async () => {
    const v1Path = path.join(SERVICE_ROOT, 'test/fixtures/project.veditor')
    const v1 = JSON.parse(await fs.readFile(v1Path, 'utf8'))
    const source = await fs.readFile(path.join(SERVICE_ROOT, 'test/fixtures/manifest/src-0.mp4'))
    const { index, payload } = v2IndexAndPayload(v1.project, [
      { id: v1.videos[0].id, name: v1.videos[0].name, mimeType: v1.videos[0].mimeType, bytes: source },
    ])
    const v2Path = path.join(tmpRoot, 'project-v2.veditor')
    await fs.writeFile(v2Path, assembleV2(index, payload))

    const render = async (jobId: string, bundle: string) => {
      const outcome = await runJob(
        {
          jobId,
          input: { bundle: { path: bundle } },
          options: { format: 'mp4', quality: 'medium' },
          output: { sink: 'volume', config: { dir: outDir } },
        },
        { bundlePath: BUNDLE, workDir, versions: VERSIONS, log: quiet },
      )
      expect(outcome.ok).toBe(true)
      return JSON.parse(await fs.readFile(path.join(outDir, `${jobId}.manifest.json`), 'utf8')) as {
        width: number
        height: number
        durationSec: number
      }
    }

    const fromV1 = await render('e2e-veditor-v1', v1Path)
    const fromV2 = await render('e2e-veditor-v2', v2Path)

    expect(fromV1).toMatchObject({ width: 64, height: 48 })
    expect({ width: fromV2.width, height: fromV2.height, durationSec: fromV2.durationSec }).toEqual({
      width: fromV1.width,
      height: fromV1.height,
      durationSec: fromV1.durationSec,
    })
    // Both renders' scratch dirs, and their bundle temp files, are gone.
    expect(await fs.readdir(workDir)).toEqual([])
  }, 2 * RENDER_TIMEOUT_MS)

  // ESCSUITE-290: the parity case above proves the v2 index is read right; this one proves each
  // source's bytes were copied from the right range. Two sources of different lengths and
  // contents, so two ranges swapped (the right number of bytes from the wrong offset) cannot pass.
  // `loadBundle` needs no browser: the same bundle, as v1 base64 JSON and as a v2 container, is
  // loaded and the temp files compared byte for byte (a straight comparison, so no ffprobe).
  it('copies every source of a v2 .veditor bundle byte for byte as a v1 bundle does', async () => {
    const v1Fixture = JSON.parse(await fs.readFile(path.join(SERVICE_ROOT, 'test/fixtures/project.veditor'), 'utf8'))
    const first = await fs.readFile(path.join(SERVICE_ROOT, 'test/fixtures/manifest/src-0.mp4'))
    // Distinct length and distinct bytes from `first`; never decoded, only copied.
    const second = Buffer.from(Array.from({ length: 777 }, (_, i) => (i * 31 + 7) % 256))
    expect(second.length).not.toBe(first.length)
    const sources = [
      { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes: first },
      { id: 'src-1', name: 'src-1.mp4', mimeType: 'video/mp4', bytes: second },
    ]

    const v1Path = path.join(tmpRoot, 'bytes-v1.veditor')
    await fs.writeFile(
      v1Path,
      JSON.stringify({
        version: 1,
        project: v1Fixture.project,
        videos: sources.map(({ bytes, ...rest }) => ({ ...rest, data: bytes.toString('base64') })),
      }),
    )
    const { index, payload } = v2IndexAndPayload(v1Fixture.project, sources)
    const v2Path = path.join(tmpRoot, 'bytes-v2.veditor')
    await fs.writeFile(v2Path, assembleV2(index, payload))

    const fromV1 = await loadBundle(v1Path, tmpRoot)
    const fromV2 = await loadBundle(v2Path, tmpRoot)
    try {
      expect(fromV2.project).toEqual(fromV1.project)
      const videos = index.videos as Array<{ id: string; data: { length: number } }>
      expect(videos.map((v) => v.id)).toEqual(['src-0', 'src-1'])
      for (const video of videos) {
        const v1Bytes = await fs.readFile(fromV1.sourceFiles[video.id])
        const v2Bytes = await fs.readFile(fromV2.sourceFiles[video.id])
        expect(v2Bytes.length, `${video.id}: v2 length vs index`).toBe(video.data.length)
        expect(v2Bytes.equals(v1Bytes), `${video.id}: v2 bytes equal v1 bytes`).toBe(true)
      }
    } finally {
      await fromV1.cleanup()
      await fromV2.cleanup()
    }
  })

  // ESCSUITE-292: the mix's loudness, measured inside the bundle by `core/loudness.ts`, against
  // ffmpeg's own `ebur128` on the same audio. The source is seeded stereo pink noise as 48 kHz
  // PCM, which Chromium decodes sample for sample as ffmpeg reads it, so the mix ESCAPEARTIST
  // meters is the file ffmpeg meters (one clip, track volume 1, no resampling); the two
  // integrated loudnesses must agree within ±0.3 LU. The same render asks for −23 LUFS, so the
  // delivered WebM's own loudness, read by ffmpeg through the Opus decode, must land on the target
  // within ±0.5 LU — the codec's share of the tolerance. Needs ffmpeg; the CI `e2e` runner has it.
  it.skipIf(!FFPROBE)('measures the mix as ffmpeg\'s ebur128 does, and normalises the file onto the target', async () => {
    const dir = path.join(tmpRoot, 'loudness')
    await fs.mkdir(dir, { recursive: true })
    const seconds = 3
    await writePinkNoiseWav(path.join(dir, 'noise.wav'), seconds, 0.1)
    const project = JSON.parse(
      await fs.readFile(path.join(SERVICE_ROOT, 'test/fixtures/manifest/project.json'), 'utf8'),
    ).project
    project.timeline.clips[0] = {
      ...project.timeline.clips[0],
      sourceVideoId: 'noise',
      name: 'noise.wav',
      endTime: seconds,
      duration: seconds,
    }
    project.timeline.duration = seconds
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ project }))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{
          id: 'noise', file: 'noise.wav', mimeType: 'audio/wav', name: 'noise.wav',
          meta: { mediaType: 'audio', duration: seconds },
        }],
      }),
    )
    const spec: JobSpec = {
      ...makeSpec('e2e-loudness', path.join(dir, 'manifest.json')),
      options: { format: 'webm', quality: 'high', loudnessTarget: -23 },
    }

    const outcome = await runJob(spec, { bundlePath: BUNDLE, workDir, versions: VERSIONS, log: quiet })

    expect(outcome.error).toBeUndefined()
    expect(outcome.ok).toBe(true)
    const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'e2e-loudness.manifest.json'), 'utf8'))
    const reference = await integratedLoudness(path.join(dir, 'noise.wav'))
    expect(Math.abs(manifest.loudness.measuredLufs - reference)).toBeLessThanOrEqual(0.3)
    expect(manifest.loudness.targetLufs).toBe(-23)
    expect(manifest.loudness.gainDb).toBeCloseTo(-23 - manifest.loudness.measuredLufs, 6)
    const delivered = await integratedLoudness(path.join(outDir, 'e2e-loudness.webm'))
    expect(Math.abs(delivered - -23)).toBeLessThanOrEqual(0.5)
  }, RENDER_TIMEOUT_MS)

  it('renders the same job as a GIF', async () => {
    const spec: JobSpec = {
      ...makeSpec('e2e-gif'),
      options: { format: 'gif', quality: 'medium', fps: 10, resolution: '360p' },
    }

    const outcome = await runJob(spec, {
      bundlePath: BUNDLE,
      workDir,
      versions: VERSIONS,
      log: quiet,
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    // 360p of the fixture's 64x48 (4:3) project is 480x360, through the same
    // `getResolution` the two video formats use. The duration is the GIF's own:
    // 10 frames of 100 ms, which at this rate is exactly the one-second timeline.
    expect(outcome.meta).toMatchObject({
      format: 'gif',
      width: 480,
      height: 360,
      durationSec: 1,
      gpu: false,
    })

    const outputPath = path.join(outDir, 'e2e-gif.gif')
    expect(outcome.outputLocation).toBe(outputPath)
    const bytes = await fs.readFile(outputPath)
    // Every GIF starts with the signature and version; this one must be 89a,
    // because an animated GIF needs the Graphic Control Extension that 87a
    // does not have.
    expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
    // And it ends with the trailer, which is how we know it was finished rather
    // than truncated.
    expect(bytes[bytes.byteLength - 1]).toBe(0x3b)

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'e2e-gif.manifest.json'), 'utf8'),
    )
    expect(manifest.format).toBe('gif')
    expect(manifest.byteLength).toBe(bytes.byteLength)
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
  }, RENDER_TIMEOUT_MS)

  // ESCSUITE-238: the video exporters encode whole frames at 30 fps, so a 0.75 s range is
  // 23 frames — 0.766667 s of file. The manifest used to report the requested 0.75, and a
  // consumer checking `durationSec` against the file within a millisecond rejected a valid
  // render. It now reports the frames encoded times the frame period.
  it.each(['mp4', 'webm'] as const)(
    'reports the encoded duration of a %s render in whole frames, matching the file',
    async (format) => {
      const jobId = `e2e-frames-${format}`
      const spec: JobSpec = {
        ...makeSpec(jobId),
        options: { format, quality: 'medium', timeRange: { start: 0, end: 0.75 } },
      }

      const outcome = await runJob(spec, { bundlePath: BUNDLE, workDir, versions: VERSIONS, log: quiet })

      expect(outcome.ok).toBe(true)
      const manifest = JSON.parse(
        await fs.readFile(path.join(outDir, `${jobId}.manifest.json`), 'utf8'),
      ) as { durationSec: number }
      // A whole number of frame periods, and the right number: ceil(0.75 x 30) = 23.
      const frames = manifest.durationSec * VIDEO_FPS
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-9)
      expect(Math.round(frames)).toBe(23)
      expect(manifest.durationSec).toBeCloseTo(23 / VIDEO_FPS, 9)

      if (FFPROBE) {
        const result = await probe(path.join(outDir, `${jobId}.${format}`))
        const video = result.streams.find((s) => s.codec_type === 'video')
        expect(Number(video?.nb_read_frames)).toBe(Math.round(frames))
        // The README's contract: the manifest matches the file's VIDEO stream within one
        // millisecond. Compared with the video stream's own duration where ffprobe reports one
        // (MP4); a WebM stream has none, so that falls back to the container's — which holds
        // only because the fixture is silent. A file with sound pads its container past the
        // last video frame by up to one AAC (21.3 ms) or Opus (20 ms) frame.
        const videoDuration = Number(video?.duration ?? result.format.duration)
        expect(Math.abs(videoDuration - manifest.durationSec)).toBeLessThanOrEqual(0.001)
      }
    },
    RENDER_TIMEOUT_MS,
  )

  // ESCSUITE-237: Chromium's H.264 encoder refuses 64x8 while encoding 1280x720, so the bundle
  // throws an ExportError with `code: 'OUTPUT_SIZE_UNSUPPORTED'`. Playwright carries only an
  // in-page error's message across the evaluate boundary; this pins that the code survives it
  // too, which the CLI and the server map to exit 2 / 400.
  it('carries an output size H.264 refuses across the page boundary as a coded failure', async () => {
    const fixtureDir = path.dirname(MANIFEST)
    const sizedDir = path.join(tmpRoot, 'fixture-64x8')
    await fs.mkdir(sizedDir, { recursive: true })
    for (const name of ['manifest.json', 'src-0.mp4']) {
      await fs.copyFile(path.join(fixtureDir, name), path.join(sizedDir, name))
    }
    const project = JSON.parse(await fs.readFile(path.join(fixtureDir, 'project.json'), 'utf8'))
    project.project.resolution = { width: 64, height: 8 }
    await fs.writeFile(path.join(sizedDir, 'project.json'), JSON.stringify(project))

    const outcome = await runJob(makeSpec('e2e-64x8', path.join(sizedDir, 'manifest.json')), {
      bundlePath: BUNDLE,
      workDir,
      versions: VERSIONS,
      log: quiet,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('OUTPUT_SIZE_UNSUPPORTED')
    expect(outcome.error).toBe(
      'The output size 64×8 is too small for H.264 — MP4 needs at least 16×16; WebM and GIF are unaffected.',
    )
    expect(await fs.readdir(workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)

  it('returns ok:false and cleans up when the headless bundle is missing', async () => {
    const missing = path.join(tmpRoot, 'no-such-bundle.html')

    const outcome = await runJob(makeSpec('e2e-no-bundle'), {
      bundlePath: missing,
      workDir,
      versions: VERSIONS,
      log: quiet,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe(`headless bundle not found at ${missing}`)
    expect(await fs.readdir(workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)

  // ESCSUITE-253: a text overlay names a fallback family, so a font the image lacks lands on
  // the generic its stack ends in. The oracle is equality with that generic, not a difference
  // from some other family: Impact, Georgia and Verdana cannot be satisfied by name on the
  // image, so with the stack each must measure exactly like its generic and unlike the other
  // one. Red on the old wiring: a bare `Impact` resolves to Chromium's default standard font
  // (serif-shaped), which is not the width of `sans-serif`, and the same for a bare `Verdana`.
  // Georgia's stack is `Georgia, 'Times New Roman', serif`, and fontconfig maps Times New Roman
  // to Liberation Serif, which may not be the image's default `serif`; so Georgia is compared
  // with the stack minus Georgia, which is what it must fall back to. Arial is the metric-clone
  // case: it must measure like `Liberation Sans`, which fonts-liberation installs and Chromium
  // resolves by name, so no assumption is made about the image's default sans.
  //
  // Linux only: the oracle needs an image without Impact, Georgia and Verdana. macOS and
  // Windows install them natively, so there width(Impact) differs from width(sans-serif)
  // whatever the stack says. CI's `e2e` job runs this on ubuntu.
  it.skipIf(process.platform !== 'linux')('draws each offered family through its own stack', async () => {
    const manifestDir = path.join(tmpRoot, 'font-manifest')
    await fs.cp(path.dirname(MANIFEST), manifestDir, { recursive: true })
    const project = JSON.parse(await fs.readFile(path.join(manifestDir, 'project.json'), 'utf8'))
    project.project.resolution = { width: 640, height: 360 }
    // The video clip is drawn at zero opacity, so the frame is the background and the text.
    project.project.timeline.clips[0].transform.opacity = 0
    project.project.timeline.tracks.push({
      id: 'track-1', name: 'T1', index: 1, visible: true, locked: false, muted: false, volume: 1, height: 64,
    })

    const measure = async (family: string, jobId: string) => {
      const withText = structuredClone(project)
      withText.project.timeline.clips.push({
        id: 'text-0',
        sourceVideoId: '',
        name: 'Text',
        startTime: 0,
        endTime: 1,
        duration: 1,
        trackId: 'track-1',
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, scaleLocked: true },
        effects: { blur: 0 },
        transition: { type: 'none', duration: 0.5 },
        overlayType: 'text',
        textData: {
          text: 'Wigglemost Illmmm',
          x: 0.5,
          y: 0.5,
          fontFamily: family,
          fontSize: 56,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#ffffff',
          backgroundColor: '#00000000',
          textAlign: 'center',
        },
      })
      await fs.writeFile(path.join(manifestDir, 'project.json'), JSON.stringify(withText))
      const outcome = await runJob(
        {
          ...makeSpec(jobId, path.join(manifestDir, 'manifest.json')),
          options: { format: 'gif', quality: 'medium', fps: 10, resolution: '360p' },
        },
        { bundlePath: BUNDLE, workDir, versions: VERSIONS, log: quiet },
      )
      expect(outcome.error).toBeUndefined()
      expect(outcome.ok).toBe(true)
      return ink(firstGifFrame(await fs.readFile(path.join(outDir, `${jobId}.gif`))))
    }

    const width = async (family: string) =>
      (await measure(family, `e2e-font-${family.replace(/[^A-Za-z]/g, '-')}`)).width
    const sans = await width('sans-serif')
    const serif = await width('serif')
    expect(sans, 'the generic families must differ for the oracle to mean anything').not.toBe(serif)

    expect(await width('Impact')).toBe(sans)
    expect(await width('Verdana')).toBe(sans)
    expect(await width('Georgia')).toBe(await width("'Times New Roman', serif"))
    expect(await width('Georgia')).not.toBe(sans)
    // The metric-clone check needs fonts-liberation; without it, say so rather than fail.
    const browser = await chromium.launch()
    let hasLiberation: boolean
    try {
      const page = await browser.newPage()
      hasLiberation = await page.evaluate(() => document.fonts.check('12px "Liberation Sans"'))
    } finally {
      await browser.close()
    }
    if (hasLiberation) {
      expect(await width('Arial')).toBe(await width('Liberation Sans'))
    } else {
      console.warn('skipping the Arial / Liberation Sans assertion: Liberation Sans is not installed')
    }
  }, RENDER_TIMEOUT_MS * 4)
})
