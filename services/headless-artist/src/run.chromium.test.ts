import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runJob } from './run'
import type { JobSpec } from './types'

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
  // the nearest generic instead of whatever the machine picks. Fonts differ per machine, so
  // nothing is hashed: each offered non-monospace family must measure differently from the
  // same text in `monospace`, which proves the stack — and not a bare 'monospace'-like
  // default — reached the canvas. (Courier New is monospace and is the control's own family.)
  it('draws each offered family through its own stack, not the monospace default', async () => {
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

    const control = await measure('monospace', 'e2e-font-monospace')
    expect(control.width).toBeGreaterThan(0)

    for (const family of ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Impact']) {
      const box = await measure(family, `e2e-font-${family.replace(/\s/g, '-')}`)
      expect(box.width, `${family} should not measure like monospace`).not.toBe(control.width)
    }
  }, RENDER_TIMEOUT_MS * 4)
})
