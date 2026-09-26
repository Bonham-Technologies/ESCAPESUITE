import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { frameCornerRGB, frameEdgeRGB, frameMeanRGB, frameRegionRGB, hasFfmpeg, probe } from '../test/ffprobe'
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
/**
 * t ≈ 1.25 s on the two-clip timeline: clip one has ended, so the only thing on screen is the
 * half-opacity clip composited over black. Red at 0.5 alpha lands near 128, but the exact value
 * depends on the encoder's colour conversion, so the band is wide enough to survive that and
 * still fail both regressions it is here for — a clip drawn opaque (r ≈ 255) and one not drawn
 * at all (r ≈ 0).
 */
const TWO_CLIP_ALPHA_FRAME = 37
/**
 * The masked case's stroke width, as a fraction of the frame width — 8 px on
 * this 64-wide fixture.
 *
 * Deliberately not ESCAPECRAFT's 3/1280, which is 0.15 px here: no encoder would
 * keep it and no probe could read it. What this case verifies is the *path* — the
 * bundle's engine masking the picture and then stroking the outline outside the
 * clip region — not the handoff's own weight, which is
 * `apps/artist/src/utils/overlayPlacement.test.ts`' job and the take-import
 * e2e's. So it is sized to be measurable.
 */
const MASKED_STROKE_WIDTH_FRACTION = 0.125
/** The middle of the 1 s, 30 fps timeline: a frame with the clip fully drawn. */
const MASKED_FRAME = 15
/**
 * A point on the mask's own outline, where the stroke is.
 *
 * The source is 64x48 and the clip is drawn at `scaleX: 1` — `core/canvasRenderer.ts`
 * reads scale 1 as native pixels — so the drawn box is the whole 64x48 frame and
 * `core/clipMask.ts` inscribes `min(64, 48) / 2 = 24` centred on (32, 24). The
 * circle's left extreme is therefore (8, 24), and an 8 px stroke centred on the
 * path spans x 4 to 12 there: a 4x4 sample centred on the point is all band, with
 * black outside it and red inside.
 */
const CIRCLE_EDGE_X = 8
const CIRCLE_EDGE_Y = 24
/** A block wholly inside the circle and wholly inside the stroke's inner edge. */
const CIRCLE_INSIDE = { x: 28, y: 20, width: 8, height: 8 }
/**
 * A point in the **outer** half of the stroke's band: outside the circle, inside
 * the line.
 *
 * The band spans x 4 to 12 at y 24 and the circle's own edge is at x 8, so x 5-6
 * is band and nothing else — a 2x2 sample centred on 6 covers exactly those two
 * columns. This is the sample that can only be white if the stroke escaped the
 * clip region; the one centred *on* the outline cannot say so on its own, because
 * half of it is inside the circle either way.
 */
const CIRCLE_OUTER_X = 6
const CIRCLE_OUTER_SAMPLE = 2

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
  let maskedManifest: string
  /** Generated in beforeAll; undefined when ffmpeg could not produce it. */
  let bluePath: string | undefined

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-verify-'))
    workDir = path.join(tmpRoot, 'work')
    outDir = path.join(tmpRoot, 'out')
    await fs.mkdir(workDir, { recursive: true })

    // Two manifest dirs of their own (project.json + a copy of the source beside
    // it), so each variant goes through loadManifest exactly as a customer's job
    // would.
    twoClipManifest = await writeManifestDir('two-clip', (project) => {
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
    })

    maskedManifest = await writeManifestDir('masked', (project) => {
      const [clip0] = project.timeline.clips
      clip0.mask = { kind: 'circle' }
      clip0.stroke = { color: '#ffffff', width: MASKED_STROKE_WIDTH_FRACTION }
    })

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

  /**
   * A manifest dir of its own, from the fixture project with `patch` applied.
   *
   * The fixture on disk is never edited. `test/fixtures/manifest/project.json`
   * backs the two golden single-clip cases above and this service's manifest
   * tests, and its twin `apps/e2e/fixtures/headless/project.json` backs five
   * Playwright consumers — so every variant is built by patching the *loaded*
   * copy, the way `apps/e2e/tests/headless/render-bundle.spec.ts:86` patches the
   * resolution. Extracted from the two-clip setup rather than copied for the
   * masked one: the boilerplate is thirty lines and the only interesting part is
   * the patch.
   */
  async function writeManifestDir(
    name: string,
    patch: (project: Project) => void,
  ): Promise<string> {
    const dir = path.join(tmpRoot, name)
    await fs.mkdir(dir, { recursive: true })

    const { project } = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'project.json'), 'utf8'),
    ) as { project: Project }
    patch(project)

    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ project }))
    await fs.copyFile(FIXTURE_SOURCE, path.join(dir, 'src-0.mp4'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
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
    return path.join(dir, 'manifest.json')
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

    // Frame count alone cannot tell a real composite from a black tail spliced on the end.
    // This frame is the 0.5-opacity clip over black: still red, at roughly half strength.
    const [r, g, b] = await frameMeanRGB(outputPath, TWO_CLIP_ALPHA_FRAME)
    expect(r).toBeGreaterThan(90)
    expect(r).toBeLessThan(170)
    expect(g).toBeLessThan(40)
    expect(b).toBeLessThan(40)
  }, RENDER_TIMEOUT_MS)

  it('renders a masked and stroked clip through the real engine (ESCSUITE-65)', async () => {
    const { outputPath } = await render('verify-masked', 'mp4', maskedManifest)

    const probed = await probe(outputPath)
    expect(videoStream(probed).width).toBe(EXPECTED_WIDTH)
    expect(videoStream(probed).height).toBe(EXPECTED_HEIGHT)

    // The corner is outside the inscribed circle — the nearest point of this 8x8
    // block to the centre (32, 24) is (7, 7), 30 px away against a radius of 24 —
    // so a masked frame draws nothing there and the export's black background
    // shows through. Unmasked it is the fixture's red, which is precisely what
    // the two golden cases above render from this same project.json: they assert
    // the whole frame at r > 200, g < 40, b < 40, which a circle-masked frame
    // with a white ring cannot produce. That is why the mask is patched in here
    // rather than written to the fixture, and it is this case's control.
    const [cornerR, cornerG, cornerB] = await frameCornerRGB(outputPath, MASKED_FRAME)
    expect(cornerR).toBeLessThan(60)
    expect(cornerG).toBeLessThan(60)
    expect(cornerB).toBeLessThan(60)

    // ...and the middle is still the clip. Without this, the assertion above
    // would pass just as well for a render that drew nothing at all.
    const [insideR, insideG, insideB] = await frameRegionRGB(
      outputPath,
      MASKED_FRAME,
      CIRCLE_INSIDE.x,
      CIRCLE_INSIDE.y,
      CIRCLE_INSIDE.width,
      CIRCLE_INSIDE.height,
    )
    expect(insideR).toBeGreaterThan(200)
    expect(insideG).toBeLessThan(40)
    expect(insideB).toBeLessThan(40)

    // The stroke: white, on the mask's own outline, drawn after the picture and
    // after the clip region was dropped (`core/clipMask.ts`'s inner restore) —
    // which is the whole reason that inner save/restore pair exists. Inside the
    // clip region, half of every line would have been eaten. This sample is the
    // middle of the band, so it is the line and nothing else.
    const [edgeR, edgeG, edgeB] = await frameEdgeRGB(
      outputPath,
      MASKED_FRAME,
      CIRCLE_EDGE_X,
      CIRCLE_EDGE_Y,
    )
    expect(edgeR).toBeGreaterThan(150)
    expect(edgeG).toBeGreaterThan(150)
    expect(edgeB).toBeGreaterThan(150)

    // And the sample that proves the stroke is drawn **outside** the clip region
    // — the inner `restore()` in `core/clipMask.ts`'s `drawWithMaskAndStroke`.
    // The assertion above cannot prove it alone: centred on the outline, half of
    // that sample is inside the circle whatever happens to the other half, so a
    // stroke drawn *inside* the clip region (outer half eaten, inner half kept)
    // still averages near white-over-red — nominally ~127 per channel against a
    // 150 floor, and mutation B showed this encode can lift a nominally-127
    // channel over that line. This 2x2 block is in the band's outer half only:
    // white if the line escaped the mask, the export's black background if it
    // did not. Nothing in between.
    const [outerR, outerG, outerB] = await frameEdgeRGB(
      outputPath,
      MASKED_FRAME,
      CIRCLE_OUTER_X,
      CIRCLE_EDGE_Y,
      CIRCLE_OUTER_SAMPLE,
    )
    expect(outerR).toBeGreaterThan(150)
    expect(outerG).toBeGreaterThan(150)
    expect(outerB).toBeGreaterThan(150)
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
