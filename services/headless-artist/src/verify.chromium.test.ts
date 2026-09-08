import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { frameMeanRGB, hasFfmpeg, probe } from '../test/ffprobe'
import { runJob } from './run'
import type { JobSpec, RenderFileInput } from './types'

const execFileAsync = promisify(execFile)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const FIXTURE_DIR = path.join(SERVICE_ROOT, 'test/fixtures/manifest')
const FIXTURE_MANIFEST = path.join(FIXTURE_DIR, 'manifest.json')
const FIXTURE_SOURCE = path.join(FIXTURE_DIR, 'src-0.mp4')

/** Long enough for a Chromium launch plus a real (tiny) encode on a cold machine. */
const RENDER_TIMEOUT_MS = 180_000

const VERSIONS = { engineVersion: 'engine-test', kitVersion: 'kit-test' }

/** Silences the driver's own progress/launch chatter; the assertions cover behaviour, not logs. */
const quiet = () => {}

/**
 * The fixture is a solid red 64x48 clip; the engine encodes the 1 s timeline at 30 fps. Both
 * numbers are golden expectations — a render that drifts off them is a regression, not noise.
 */
const EXPECTED_WIDTH = 64
const EXPECTED_HEIGHT = 48
const EXPECTED_FRAMES = 30
const EXPECTED_DURATION_SEC = 1.0
/** Container durations round; the assertion is "the right length", not "to the microsecond". */
const DURATION_TOLERANCE_SEC = 0.1
/** Two clips, the second offset by 0.5 s, so the timeline is 1.5 s → 45 frames at 30 fps. */
const EXPECTED_TWO_CLIP_FRAMES = 45

const FFMPEG = hasFfmpeg()
if (!FFMPEG) {
  // Visible in CI logs: a silently skipped verification suite looks exactly like a passing one.
  console.warn(
    '[verify.chromium.test] SKIPPED: ffmpeg and ffprobe must both be on PATH to verify rendered output',
  )
}

type Project = RenderFileInput['project']

/** The single video stream, with the fields `probe` was asked for narrowed to what we assert on. */
function videoStream(result: Awaited<ReturnType<typeof probe>>) {
  const stream = result.streams.find((s) => s.codec_type === 'video')
  if (!stream) throw new Error('probed file has no video stream')
  return stream
}

function frameCount(result: Awaited<ReturnType<typeof probe>>): number {
  return Number(videoStream(result).nb_read_frames)
}

async function sha256Of(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

describe.skipIf(!FFMPEG)('output verification (needs ffmpeg)', () => {
  let tmpRoot: string
  let workDir: string
  let outDir: string
  let twoClipManifest: string
  /** Generated in beforeAll; undefined when ffmpeg could not produce it. */
  let bluePath: string | undefined

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-verify-'))
    workDir = path.join(tmpRoot, 'work')
    outDir = path.join(tmpRoot, 'out')
    await fs.mkdir(workDir, { recursive: true })

    // A second manifest dir (project.json + a copy of the source next to it) so the two-clip
    // case goes through loadManifest exactly as a customer's job would.
    const twoClipDir = path.join(tmpRoot, 'two-clip')
    await fs.mkdir(twoClipDir, { recursive: true })
    twoClipManifest = path.join(twoClipDir, 'manifest.json')

    const { project } = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'project.json'), 'utf8'),
    ) as { project: Project }
    const [track0] = project.timeline.tracks
    const [clip0] = project.timeline.clips
    project.timeline.tracks.push({ ...track0, id: 'track-1', name: 'V2', index: 1 })
    project.timeline.clips.push({
      ...clip0,
      id: 'clip-1',
      trackId: 'track-1',
      timelinePosition: 0.5,
      transform: { ...clip0.transform, opacity: 0.5 },
    })
    project.timeline.duration = 1.5

    await fs.writeFile(path.join(twoClipDir, 'project.json'), JSON.stringify({ project }))
    await fs.copyFile(FIXTURE_SOURCE, path.join(twoClipDir, 'src-0.mp4'))
    await fs.writeFile(
      twoClipManifest,
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [
          {
            id: 'src-0',
            file: 'src-0.mp4',
            mimeType: 'video/mp4',
            name: 'clip.mp4',
            width: EXPECTED_WIDTH,
            height: EXPECTED_HEIGHT,
            duration: 1,
          },
        ],
      }),
    )

    // Negative control for the golden-colour check: a clip that is definitively NOT red.
    // Generated rather than committed so the repo carries one fixture, not two.
    const candidate = path.join(tmpRoot, 'blue.mp4')
    try {
      await execFileAsync('ffmpeg', [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', `color=c=blue:s=${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}:d=1:r=25`,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        candidate,
      ])
      bluePath = candidate
    } catch (err) {
      console.warn(`[verify.chromium.test] could not generate the blue control clip: ${String(err)}`)
    }
  }, RENDER_TIMEOUT_MS)

  afterAll(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  function makeSpec(jobId: string, format: 'mp4' | 'webm', manifestPath: string): JobSpec {
    return {
      jobId,
      input: { manifest: { path: manifestPath } },
      options: { format, quality: 'medium' },
      output: { sink: 'volume', config: { dir: outDir } },
    }
  }

  /** Renders one job through the volume sink and returns the two delivered paths. */
  async function render(jobId: string, format: 'mp4' | 'webm', manifestPath = FIXTURE_MANIFEST) {
    const outcome = await runJob(makeSpec(jobId, format, manifestPath), {
      bundlePath: BUNDLE,
      workDir,
      versions: VERSIONS,
      log: quiet,
    })
    expect(outcome.error).toBeUndefined()
    expect(outcome.ok).toBe(true)
    return {
      outputPath: path.join(outDir, `${jobId}.${format}`),
      manifestPath: path.join(outDir, `${jobId}.manifest.json`),
    }
  }

  /** The manifest is only useful if it describes the bytes that were actually delivered. */
  async function expectManifestMatchesFile(manifestFile: string, outputFile: string) {
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      sha256: string
      byteLength: number
    }
    expect(manifest.sha256).toBe(await sha256Of(outputFile))
    expect(manifest.byteLength).toBe((await fs.stat(outputFile)).size)
  }

  it('renders the red fixture to a verifiable H.264 MP4', async () => {
    const { outputPath, manifestPath } = await render('verify-mp4', 'mp4')

    const probed = await probe(outputPath)
    const video = videoStream(probed)
    expect(video.codec_name).toBe('h264')
    expect(video.width).toBe(EXPECTED_WIDTH)
    expect(video.height).toBe(EXPECTED_HEIGHT)
    expect(frameCount(probed)).toBeGreaterThanOrEqual(EXPECTED_FRAMES - 1)
    expect(frameCount(probed)).toBeLessThanOrEqual(EXPECTED_FRAMES + 1)
    expect(Number(probed.format.duration)).toBeGreaterThan(EXPECTED_DURATION_SEC - DURATION_TOLERANCE_SEC)
    expect(Number(probed.format.duration)).toBeLessThan(EXPECTED_DURATION_SEC + DURATION_TOLERANCE_SEC)

    // Golden frame: the middle of a solid red source must still be red after the round trip.
    const [r, g, b] = await frameMeanRGB(outputPath, Math.floor(EXPECTED_FRAMES / 2))
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(40)
    expect(b).toBeLessThan(40)

    await expectManifestMatchesFile(manifestPath, outputPath)
  }, RENDER_TIMEOUT_MS)

  it('renders the red fixture to a verifiable VP9 WebM', async () => {
    const { outputPath, manifestPath } = await render('verify-webm', 'webm')

    const probed = await probe(outputPath)
    const video = videoStream(probed)
    expect(video.codec_name).toBe('vp9')
    expect(video.width).toBe(EXPECTED_WIDTH)
    expect(video.height).toBe(EXPECTED_HEIGHT)
    expect(frameCount(probed)).toBeGreaterThanOrEqual(EXPECTED_FRAMES - 1)
    expect(frameCount(probed)).toBeLessThanOrEqual(EXPECTED_FRAMES + 1)
    expect(Number(probed.format.duration)).toBeGreaterThan(EXPECTED_DURATION_SEC - DURATION_TOLERANCE_SEC)
    expect(Number(probed.format.duration)).toBeLessThan(EXPECTED_DURATION_SEC + DURATION_TOLERANCE_SEC)

    const [r, g, b] = await frameMeanRGB(outputPath, Math.floor(EXPECTED_FRAMES / 2))
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(40)
    expect(b).toBeLessThan(40)

    await expectManifestMatchesFile(manifestPath, outputPath)
  }, RENDER_TIMEOUT_MS)

  it('renders a two-clip timeline for its full composited duration', async () => {
    const { outputPath } = await render('verify-two-clip', 'mp4', twoClipManifest)

    const probed = await probe(outputPath)
    const video = videoStream(probed)
    expect(video.width).toBe(EXPECTED_WIDTH)
    expect(video.height).toBe(EXPECTED_HEIGHT)
    // 45, not 30: the second clip extends the timeline to 1.5 s. A passthrough of clip one
    // would produce 30 here.
    expect(frameCount(probed)).toBeGreaterThanOrEqual(EXPECTED_TWO_CLIP_FRAMES - 1)
    expect(frameCount(probed)).toBeLessThanOrEqual(EXPECTED_TWO_CLIP_FRAMES + 1)
  }, RENDER_TIMEOUT_MS)

  it('reads red from the red fixture and not from a blue control clip', async () => {
    if (!bluePath) {
      console.warn('[verify.chromium.test] blue control clip unavailable; skipping the colour control')
      return
    }

    const [rr, rg, rb] = await frameMeanRGB(FIXTURE_SOURCE, 12)
    expect(rr).toBeGreaterThan(200)
    expect(rg).toBeLessThan(40)
    expect(rb).toBeLessThan(40)

    // Same predicate, opposite verdict — proof the golden-frame assertion above can fail.
    const [br, bg, bb] = await frameMeanRGB(bluePath, 12)
    expect(br > 200 && bg < 40 && bb < 40).toBe(false)
    expect(bb).toBeGreaterThan(200)
  })
})
